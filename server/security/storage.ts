import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { VaultStorageDiagnostics } from '../../shared/contracts.ts';

const EPHEMERAL_FS_TYPES = new Set([
  'overlay',
  'tmpfs',
  'ramfs',
  'rootfs',
  'squashfs',
]);

export function getVaultBaseDir(): string {
  const configured = process.env.AURIX_VAULT_DIR?.trim();
  if (configured) {
    if (!path.isAbsolute(configured) || configured.includes('..')) {
      throw new VaultStorageSecurityError(
        'INVALID_PATH',
        'AURIX_VAULT_DIR deve ser um caminho absoluto sem traversal.',
      );
    }
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), '.aurix-vault');
}

export class VaultStorageSecurityError extends Error {
  readonly code: 'SYMLINK_REJECTED' | 'INVALID_PATH' | 'IO_ERROR';
  constructor(code: 'SYMLINK_REJECTED' | 'INVALID_PATH' | 'IO_ERROR', message: string) {
    super(message);
    this.name = 'VaultStorageSecurityError';
    this.code = code;
  }
}

export class VaultCorruptionError extends Error {
  readonly code = 'VAULT_CORRUPTED';
  readonly fileName: string;
  constructor(fileName: string, message: string) {
    super(message);
    this.name = 'VaultCorruptionError';
    this.fileName = fileName;
  }
}

let vaultLockChain: Promise<void> = Promise.resolve();

export function withVaultLock<T>(operation: () => Promise<T> | T): Promise<T> {
  const run = vaultLockChain.then(() => operation());
  vaultLockChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resolveSafeVaultPath(fileName: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName) || fileName.includes('..')) {
    throw new VaultStorageSecurityError(
      'INVALID_PATH',
      'Nome de arquivo inválido para armazenamento.',
    );
  }
  const baseDir = getVaultBaseDir();
  const resolved = path.resolve(baseDir, fileName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new VaultStorageSecurityError(
      'INVALID_PATH',
      'Caminho fora do diretório permitido.',
    );
  }
  return resolved;
}

function assertNotSymlink(targetPath: string): fs.Stats | null {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      throw new VaultStorageSecurityError(
        'SYMLINK_REJECTED',
        'Link simbólico não permitido dentro do diretório seguro.',
      );
    }
    return stat;
  } catch (err) {
    if (err instanceof VaultStorageSecurityError) {
      throw err;
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export function ensureVaultDir(): string {
  const baseDir = getVaultBaseDir();
  const existing = assertNotSymlink(baseDir);
  if (!existing) {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(baseDir, 0o700);
    return baseDir;
  }
  if (!existing.isDirectory()) {
    throw new VaultStorageSecurityError(
      'IO_ERROR',
      'O caminho do cofre não é um diretório válido.',
    );
  }
  if ((existing.mode & 0o777) !== 0o700) {
    fs.chmodSync(baseDir, 0o700);
  }
  return baseDir;
}

export function hasVaultFile(fileName: string): boolean {
  const target = resolveSafeVaultPath(fileName);
  const stat = assertNotSymlink(target);
  return Boolean(stat && stat.isFile());
}

export function readVaultFile(fileName: string): string | null {
  const baseDir = getVaultBaseDir();
  const dirStat = assertNotSymlink(baseDir);
  if (!dirStat) {
    return null;
  }
  if ((dirStat.mode & 0o777) !== 0o700) {
    fs.chmodSync(baseDir, 0o700);
  }

  const target = resolveSafeVaultPath(fileName);
  const fileStat = assertNotSymlink(target);
  if (!fileStat) {
    return null;
  }
  if (!fileStat.isFile()) {
    throw new VaultStorageSecurityError('IO_ERROR', 'Entrada do cofre inválida.');
  }
  if ((fileStat.mode & 0o777) !== 0o600) {
    fs.chmodSync(target, 0o600);
  }
  return fs.readFileSync(target, 'utf8');
}

export function writeVaultFile(fileName: string, content: string): void {
  ensureVaultDir();
  const target = resolveSafeVaultPath(fileName);
  assertNotSymlink(target);

  const tempName = `${fileName}.tmp.${process.pid}.${crypto.randomBytes(8).toString('hex')}`;
  const tempPath = resolveSafeVaultPath(tempName);
  assertNotSymlink(tempPath);

  const data = Buffer.from(content, 'utf8');
  let fd: number | null = null;
  try {
    fd = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    let offset = 0;
    while (offset < data.length) {
      offset += fs.writeSync(fd, data, offset, data.length - offset);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, target);
    fs.chmodSync(target, 0o600);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close error during cleanup
      }
    }
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore unlink error during cleanup
    }
    throw err;
  }
}

export function getVaultStoragePermissionsAudit(): {
  dirExists: boolean;
  dirMode: string | null;
  files: Array<{ name: string; mode: string; isSymlink: boolean }>;
} {
  const baseDir = getVaultBaseDir();
  let dirStat: fs.Stats;
  try {
    dirStat = fs.lstatSync(baseDir);
  } catch {
    return { dirExists: false, dirMode: null, files: [] };
  }

  const entries = fs.readdirSync(baseDir);
  const files = entries
    .filter((name) => !name.includes('.tmp.'))
    .map((name) => {
      const full = path.join(baseDir, name);
      const st = fs.lstatSync(full);
      return {
        name,
        mode: (st.mode & 0o777).toString(8).padStart(3, '0'),
        isSymlink: st.isSymbolicLink(),
      };
    });

  return {
    dirExists: true,
    dirMode: (dirStat.mode & 0o777).toString(8).padStart(3, '0'),
    files,
  };
}

function detectMountFilesystemType(targetDir: string): string {
  try {
    const raw = fs.readFileSync('/proc/mounts', 'utf8');
    let bestMount = '';
    let bestFsType = 'unknown';
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split(' ');
      if (parts.length < 3) continue;
      const mountPoint = parts[1];
      const fsType = parts[2];
      const isMatch =
        targetDir === mountPoint ||
        mountPoint === '/' ||
        targetDir.startsWith(mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`);
      if (isMatch && mountPoint.length >= bestMount.length) {
        bestMount = mountPoint;
        bestFsType = fsType;
      }
    }
    return bestFsType;
  } catch {
    return 'unknown';
  }
}

export function detectVaultStorageDiagnostics(): VaultStorageDiagnostics {
  const configured = process.env.AURIX_VAULT_DIR?.trim();
  const vaultDirSource: VaultStorageDiagnostics['vaultDirSource'] = configured
    ? 'AURIX_VAULT_DIR'
    : 'default_local';
  const baseDir = getVaultBaseDir();
  const audit = getVaultStoragePermissionsAudit();
  const filesystemType = detectMountFilesystemType(baseDir);

  let writable = false;
  try {
    const checkPath = audit.dirExists ? baseDir : path.dirname(baseDir);
    fs.accessSync(checkPath, fs.constants.R_OK | fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }

  const isEphemeral =
    filesystemType === 'unknown' || EPHEMERAL_FS_TYPES.has(filesystemType.toLowerCase());

  return {
    vaultDirPath: baseDir,
    vaultDirSource,
    storageBackend: isEphemeral
      ? 'container_overlay_ephemeral'
      : 'mounted_persistent_volume',
    filesystemType,
    dirExists: audit.dirExists,
    dirMode: audit.dirMode,
    writable,
  };
}

export function runStartupVaultIntegrityAudit(): {
  ok: boolean;
  checkedFiles: string[];
  errors: string[];
} {
  const checkedFiles: string[] = [];
  const errors: string[] = [];

  try {
    const baseDir = getVaultBaseDir();
    const dirStat = assertNotSymlink(baseDir);
    if (dirStat && !dirStat.isDirectory()) {
      errors.push('Caminho do cofre não é um diretório.');
      return { ok: false, checkedFiles, errors };
    }
    if (dirStat && (dirStat.mode & 0o777) !== 0o700) {
      fs.chmodSync(baseDir, 0o700);
    }

    const expectedJsonFiles = [
      'admin-credential.json',
      'agents-registry.json',
      'tenants-registry.json',
      'vault-meta.json',
      'keys-vault.enc.json',
      'security-audit.log.json',
      'revoked-sessions.json',
      'rate-limits.json',
    ];

    for (const fileName of expectedJsonFiles) {
      const target = resolveSafeVaultPath(fileName);
      const stat = assertNotSymlink(target);
      if (!stat) continue;
      if (!stat.isFile()) {
        errors.push(`Entrada ${fileName} não é um arquivo regular.`);
        continue;
      }
      if ((stat.mode & 0o777) !== 0o600) {
        fs.chmodSync(target, 0o600);
      }
      const raw = fs.readFileSync(target, 'utf8');
      try {
        JSON.parse(raw);
        checkedFiles.push(fileName);
      } catch {
        errors.push(`Arquivo ${fileName} contém JSON corrompido (preservado sem sobrescrita).`);
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Erro ao auditar armazenamento do cofre.');
  }

  return { ok: errors.length === 0, checkedFiles, errors };
}
