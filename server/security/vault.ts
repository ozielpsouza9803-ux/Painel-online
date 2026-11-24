import crypto from 'node:crypto';
import type {
  EncryptedVaultBackupBundle,
  ProviderId,
  VaultEnvironment,
  VaultKeySummary,
  VaultKeyVerificationStatus,
  VaultSecurityStatus,
} from '../../shared/contracts.ts';
import { hasTenantId } from '../core/tenantRegistry.ts';
import { deriveScryptAsync } from './cryptoAsync.ts';
import {
  hasVaultFile,
  readVaultFile,
  VaultCorruptionError,
  withVaultLock,
  writeVaultFile,
} from './storage.ts';

interface EncryptedVaultRecord {
  id: string;
  providerId: ProviderId;
  label: string;
  maskedPreview: string;
  hasSecondaryCredential: boolean;
  scopeAppId: string;
  environment: VaultEnvironment;
  status: VaultKeyVerificationStatus;
  statusNote: string;
  lastHttpStatus?: number | null;
  lastTestedAt?: string | null;
  lastModelTested?: string | null;
  kdfVersion?: 1 | 2;
  aadVersion?: 2;
  createdAt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface VaultMetaRecord {
  version: 1;
  kdf: 'scrypt';
  saltMode: 'hex' | 'legacy_v2';
  salt: string;
  verifierAadVersion?: 2;
  verifier: {
    iv: string;
    authTag: string;
    ciphertext: string;
  };
  createdAt: string;
  rotatedAt?: string;
}

interface BackupPlainRecord {
  id: string;
  providerId: ProviderId;
  label: string;
  maskedPreview: string;
  hasSecondaryCredential: boolean;
  scopeAppId: string;
  environment: VaultEnvironment;
  status: VaultKeyVerificationStatus;
  statusNote: string;
  lastHttpStatus?: number | null;
  lastTestedAt?: string | null;
  lastModelTested?: string | null;
  createdAt: string;
  apiKey: string;
  secondaryCredential?: string;
}

export interface DecryptedVaultCredential {
  id: string;
  providerId: ProviderId;
  label: string;
  scopeAppId: string;
  environment: VaultEnvironment;
  apiKey: string;
  secondaryCredential?: string;
}

const VAULT_FILE = 'keys-vault.enc.json';
const VAULT_META_FILE = 'vault-meta.json';
const VERIFIER_PLAINTEXT = 'AURIX_VAULT_VERIFIED_V1';
const VERIFIER_AAD_V2 = Buffer.from('aurix:vault-meta:v2', 'utf8');
const BACKUP_AAD_V1 = Buffer.from('aurix-vault-backup-v1', 'utf8');
const KDF_SALT = 'aurix-ai-vault-kdf-v2';
const AUTO_LOCK_MINUTES = 15;
const AUTO_LOCK_MS = AUTO_LOCK_MINUTES * 60 * 1000;

const VALID_PROVIDERS: ReadonlySet<ProviderId> = new Set([
  'gemini',
  'groq',
  'cloudflare',
  'openrouter',
  'mistral',
]);
const VALID_ENVS: ReadonlySet<VaultEnvironment> = new Set([
  'development',
  'staging',
  'production',
]);

const EPHEMERAL_MASTER_KEY = crypto.randomBytes(32);
let memoryRecords: EncryptedVaultRecord[] = [];

// Derived 32-byte key kept strictly in backend process memory (never written to disk or sent to frontend).
let runtimeDerivedKey: Buffer | null = null;
let runtimeUnlockedAt: string | null = null;
let lastActivityAtMs = 0;

let cachedEnvSecret: string | null = null;
let cachedEnvKey: Buffer | null = null;

function clearRuntimeMasterKey(): void {
  if (runtimeDerivedKey) {
    runtimeDerivedKey.fill(0);
    runtimeDerivedKey = null;
  }
  runtimeUnlockedAt = null;
  lastActivityAtMs = 0;
}

function enforceAutoLockIfExpired(now = Date.now()): void {
  if (!runtimeDerivedKey || getConfiguredEnvSecret()) {
    return;
  }
  if (lastActivityAtMs > 0 && now - lastActivityAtMs >= AUTO_LOCK_MS) {
    clearRuntimeMasterKey();
  }
}

function touchVaultActivity(now = Date.now()): void {
  if (runtimeDerivedKey && !getConfiguredEnvSecret()) {
    lastActivityAtMs = now;
  }
}

const autoLockSweepTimer = setInterval(() => {
  enforceAutoLockIfExpired();
}, 30_000);
autoLockSweepTimer.unref();

function getConfiguredEnvSecret(): string | null {
  const secret = process.env.AURIX_VAULT_SECRET;
  if (!secret || secret.trim().length < 16) return null;
  return secret;
}

function getEnvMasterKey(): Buffer | null {
  const secret = getConfiguredEnvSecret();
  if (!secret) return null;
  if (cachedEnvSecret === secret && cachedEnvKey) {
    return cachedEnvKey;
  }
  const derived = crypto.scryptSync(secret, KDF_SALT, 32, { N: 16384, r: 8, p: 1 });
  cachedEnvSecret = secret;
  cachedEnvKey = derived;
  return derived;
}

function getLegacySha256Key(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

function validateNewMasterKeyStrength(
  rawKey: unknown,
  fieldLabel = 'A chave mestra',
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof rawKey !== 'string' || rawKey.length < 16 || rawKey.length > 256) {
    return {
      ok: false,
      error: `${fieldLabel} deve possuir entre 16 e 256 caracteres.`,
    };
  }
  if (rawKey.trim().length < 12) {
    return {
      ok: false,
      error: `${fieldLabel} não pode ser composta apenas por espaços.`,
    };
  }
  if (new Set(rawKey).size < 6) {
    return {
      ok: false,
      error: `${fieldLabel} precisa conter pelo menos 6 caracteres distintos.`,
    };
  }
  return { ok: true, value: rawKey };
}

function hasDiskVaultFile(): boolean {
  return hasVaultFile(VAULT_FILE);
}

function readVaultMetaStrict(): VaultMetaRecord | null {
  const raw = readVaultFile(VAULT_META_FILE);
  if (raw === null) return null;
  let parsed: Partial<VaultMetaRecord>;
  try {
    parsed = JSON.parse(raw) as Partial<VaultMetaRecord>;
  } catch {
    throw new VaultCorruptionError(
      VAULT_META_FILE,
      'Metadados do cofre (vault-meta.json) estão corrompidos. Escrita bloqueada para preservar integridade.',
    );
  }
  if (
    parsed.version === 1 &&
    parsed.kdf === 'scrypt' &&
    typeof parsed.salt === 'string' &&
    (parsed.saltMode === 'hex' || parsed.saltMode === 'legacy_v2') &&
    parsed.verifier &&
    typeof parsed.verifier.iv === 'string' &&
    typeof parsed.verifier.authTag === 'string' &&
    typeof parsed.verifier.ciphertext === 'string'
  ) {
    return parsed as VaultMetaRecord;
  }
  throw new VaultCorruptionError(
    VAULT_META_FILE,
    'Estrutura de vault-meta.json inválida ou adulterada.',
  );
}

function buildRecordAad(record: {
  id: string;
  providerId: ProviderId;
  scopeAppId: string;
  environment: VaultEnvironment;
}): Buffer {
  return Buffer.from(
    `aurix:v2:${record.id}:${record.providerId}:${record.scopeAppId}:${record.environment}`,
    'utf8',
  );
}

function encryptTextWithKey(
  text: string,
  key: Buffer,
  aad?: Buffer,
): {
  iv: string;
  authTag: string;
  ciphertext: string;
} {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) {
    cipher.setAAD(aad);
  }
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

function decryptTextWithKey(
  payload: { iv: string; authTag: string; ciphertext: string },
  key: Buffer,
  aad?: Buffer,
): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'hex'),
  );
  if (aad) {
    decipher.setAAD(aad);
  }
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

function getActivePersistenceKind(): 'persistent' | 'ephemeral_memory' {
  if (getConfiguredEnvSecret()) return 'persistent';
  if (hasVaultFile(VAULT_META_FILE) || hasDiskVaultFile() || runtimeDerivedKey) {
    return 'persistent';
  }
  return 'ephemeral_memory';
}

function getActiveMasterKey(): Buffer | null {
  enforceAutoLockIfExpired();
  const envKey = getEnvMasterKey();
  if (envKey) return envKey;
  if (runtimeDerivedKey) return runtimeDerivedKey;
  if (getActivePersistenceKind() === 'ephemeral_memory') {
    return EPHEMERAL_MASTER_KEY;
  }
  return null;
}

function isValidEncryptedRecordShape(item: unknown): item is EncryptedVaultRecord {
  if (!item || typeof item !== 'object') return false;
  const r = item as Partial<EncryptedVaultRecord>;
  return (
    typeof r.id === 'string' &&
    typeof r.providerId === 'string' &&
    VALID_PROVIDERS.has(r.providerId as ProviderId) &&
    typeof r.label === 'string' &&
    typeof r.scopeAppId === 'string' &&
    typeof r.environment === 'string' &&
    VALID_ENVS.has(r.environment as VaultEnvironment) &&
    typeof r.iv === 'string' &&
    typeof r.authTag === 'string' &&
    typeof r.ciphertext === 'string'
  );
}

function loadRecordsStrict(): EncryptedVaultRecord[] {
  if (getActivePersistenceKind() === 'ephemeral_memory') {
    return memoryRecords;
  }
  const raw = readVaultFile(VAULT_FILE);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VaultCorruptionError(
      VAULT_FILE,
      'Arquivo cifrado do cofre (keys-vault.enc.json) está corrompido. Escrita bloqueada para evitar perda de chaves.',
    );
  }
  if (!Array.isArray(parsed) || !parsed.every(isValidEncryptedRecordShape)) {
    throw new VaultCorruptionError(
      VAULT_FILE,
      'Estrutura do cofre cifrado (keys-vault.enc.json) inválida.',
    );
  }
  return parsed;
}

function saveRecords(records: EncryptedVaultRecord[]): void {
  if (getActivePersistenceKind() === 'ephemeral_memory') {
    memoryRecords = records;
    return;
  }
  writeVaultFile(VAULT_FILE, JSON.stringify(records));
}

function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 4) {
    return '••••';
  }
  return `••••${trimmed.slice(-4)}`;
}

function encryptPayloadWithKey(
  payload: { apiKey: string; secondaryCredential?: string },
  key: Buffer,
  aad?: Buffer,
): { iv: string; authTag: string; ciphertext: string } {
  return encryptTextWithKey(JSON.stringify(payload), key, aad);
}

function decryptPayloadWithKey(
  record: EncryptedVaultRecord,
  key: Buffer,
): { apiKey: string; secondaryCredential?: string } {
  const aad = record.aadVersion === 2 ? buildRecordAad(record) : undefined;
  const plaintext = decryptTextWithKey(record, key, aad);
  return JSON.parse(plaintext) as { apiKey: string; secondaryCredential?: string };
}

function decryptPayload(record: EncryptedVaultRecord): {
  apiKey: string;
  secondaryCredential?: string;
} {
  const key = getActiveMasterKey();
  if (!key) {
    throw new Error('Cofre bloqueado.');
  }
  try {
    return decryptPayloadWithKey(record, key);
  } catch (primaryErr) {
    const envSecret = getConfiguredEnvSecret();
    if (
      envSecret &&
      record.aadVersion !== 2 &&
      (record.kdfVersion === undefined || record.kdfVersion === 1)
    ) {
      return decryptPayloadWithKey(record, getLegacySha256Key(envSecret));
    }
    throw primaryErr;
  }
}

function canDecryptRecord(record: EncryptedVaultRecord): boolean {
  if (!getActiveMasterKey()) return false;
  try {
    decryptPayload(record);
    return true;
  } catch {
    return false;
  }
}

function toSummary(record: EncryptedVaultRecord): VaultKeySummary {
  const activeKey = getActiveMasterKey();
  const decryptable = canDecryptRecord(record);
  let statusNote = record.statusNote;
  if (!activeKey) {
    statusNote = 'Cofre bloqueado · Informe a chave mestra para utilizar';
  } else if (!decryptable) {
    statusNote = 'Chave preservada em disco, mas incompatível com a chave mestra ativa ou metadados adulterados';
  }

  return {
    id: record.id,
    providerId: record.providerId,
    label: record.label,
    maskedPreview: record.maskedPreview,
    hasSecondaryCredential: record.hasSecondaryCredential,
    scopeAppId: record.scopeAppId,
    environment: record.environment,
    status: record.status,
    statusNote,
    decryptable,
    lastHttpStatus: record.lastHttpStatus ?? null,
    lastTestedAt: record.lastTestedAt ?? null,
    lastModelTested: record.lastModelTested ?? null,
    createdAt: record.createdAt,
  };
}

export function getVaultPersistenceMode(): 'persistent_encrypted' | 'ephemeral_memory' {
  return getActivePersistenceKind() === 'persistent'
    ? 'persistent_encrypted'
    : 'ephemeral_memory';
}

export function getVaultSecurityStatus(): VaultSecurityStatus {
  enforceAutoLockIfExpired();

  const persistenceKind = getActivePersistenceKind();
  const hasDiskFile = hasDiskVaultFile();
  const envConfigured = Boolean(getConfiguredEnvSecret());

  let meta: VaultMetaRecord | null = null;
  let records: EncryptedVaultRecord[] = [];
  let integrityStatus: 'ok' | 'corrupted' = 'ok';
  let integrityError: string | null = null;

  try {
    meta = readVaultMetaStrict();
    records = loadRecordsStrict();
  } catch (err) {
    integrityStatus = 'corrupted';
    integrityError =
      err instanceof Error ? err.message : 'Falha de integridade nos arquivos do cofre.';
  }

  let masterKeySource: VaultSecurityStatus['masterKeySource'] = 'none';
  if (envConfigured) {
    masterKeySource = 'env';
  } else if (runtimeDerivedKey) {
    masterKeySource = 'runtime_master_key';
  }

  const lockState: VaultSecurityStatus['lockState'] =
    integrityStatus === 'corrupted'
      ? 'locked'
      : persistenceKind === 'ephemeral_memory' || masterKeySource !== 'none'
        ? 'unlocked'
        : 'locked';

  const decryptableKeysCount =
    lockState === 'unlocked' ? records.filter(canDecryptRecord).length : 0;

  const autoLockExpiresAt =
    masterKeySource === 'runtime_master_key' && lastActivityAtMs > 0
      ? new Date(lastActivityAtMs + AUTO_LOCK_MS).toISOString()
      : null;

  let statusSummary = '';
  if (integrityStatus === 'corrupted') {
    statusSummary =
      'Bloqueado · Falha de integridade detectada em disco (nenhum dado foi sobrescrito)';
  } else if (lockState === 'locked') {
    statusSummary =
      'Bloqueado · Persistente em disco (informe a chave mestra para desbloquear)';
  } else if (masterKeySource === 'env') {
    statusSummary =
      'Desbloqueado · Persistente via variável de ambiente AURIX_VAULT_SECRET';
  } else if (masterKeySource === 'runtime_master_key') {
    statusSummary = `Desbloqueado · Persistente em disco (bloqueio automático após ${AUTO_LOCK_MINUTES} min de inatividade)`;
  } else {
    statusSummary =
      'Desbloqueado · Memória temporária (defina uma chave mestra para persistir em disco)';
  }

  return {
    lockState,
    persistenceKind,
    masterKeySource,
    hasDiskVaultFile: hasDiskFile,
    hasMasterKeyVerifier: Boolean(meta),
    storedKeysCount: records.length,
    decryptableKeysCount,
    lastUnlockedAt: runtimeUnlockedAt,
    autoLockMinutes: AUTO_LOCK_MINUTES,
    autoLockExpiresAt,
    integrityStatus,
    integrityError,
    statusSummary,
  };
}

export async function unlockVaultWithMasterKey(
  rawMasterKey: unknown,
): Promise<
  | { ok: true; status: VaultSecurityStatus; migratedCount: number }
  | { ok: false; error: string; httpCode: number }
> {
  if (getConfiguredEnvSecret()) {
    return {
      ok: false,
      httpCode: 409,
      error: 'O cofre já está desbloqueado pela variável de ambiente AURIX_VAULT_SECRET.',
    };
  }

  if (typeof rawMasterKey !== 'string' || rawMasterKey.length < 16 || rawMasterKey.length > 256) {
    return {
      ok: false,
      httpCode: 400,
      error: 'A chave mestra deve possuir entre 16 e 256 caracteres.',
    };
  }

  const masterKey = rawMasterKey;

  return withVaultLock(async () => {
    let meta: VaultMetaRecord | null;
    try {
      meta = readVaultMetaStrict();
    } catch (err) {
      return {
        ok: false,
        httpCode: 500,
        error: err instanceof Error ? err.message : 'Metadados do cofre corrompidos.',
      };
    }

    if (meta) {
      const salt =
        meta.saltMode === 'legacy_v2' ? meta.salt : Buffer.from(meta.salt, 'hex');
      const derived = await deriveScryptAsync(masterKey, salt, 32);
      const verifierAad = meta.verifierAadVersion === 2 ? VERIFIER_AAD_V2 : undefined;

      try {
        const check = decryptTextWithKey(meta.verifier, derived, verifierAad);
        if (check !== VERIFIER_PLAINTEXT) {
          derived.fill(0);
          return {
            ok: false,
            httpCode: 401,
            error: 'Chave mestra incorreta. O cofre permanece bloqueado.',
          };
        }
      } catch {
        derived.fill(0);
        return {
          ok: false,
          httpCode: 401,
          error: 'Chave mestra incorreta. O cofre permanece bloqueado.',
        };
      }

      clearRuntimeMasterKey();
      runtimeDerivedKey = derived;
      runtimeUnlockedAt = new Date().toISOString();
      lastActivityAtMs = Date.now();
      return { ok: true, status: getVaultSecurityStatus(), migratedCount: 0 };
    }

    // Legacy vault file on disk without vault-meta.json: decrypt ALL and migrate to random salt + scrypt + AAD v2.
    if (hasDiskVaultFile()) {
      let existingRecords: EncryptedVaultRecord[];
      try {
        existingRecords = loadRecordsStrict();
      } catch (err) {
        return {
          ok: false,
          httpCode: 500,
          error: err instanceof Error ? err.message : 'Arquivo cifrado do cofre corrompido.',
        };
      }

      if (existingRecords.length > 0) {
        const legacyV2Key = await deriveScryptAsync(masterKey, KDF_SALT, 32);
        const legacyShaKey = getLegacySha256Key(masterKey);

        const decryptedAll: Array<{
          record: EncryptedVaultRecord;
          plain: { apiKey: string; secondaryCredential?: string };
        }> = [];

        for (const rec of existingRecords) {
          let plain: { apiKey: string; secondaryCredential?: string } | null = null;
          try {
            plain = decryptPayloadWithKey(rec, legacyV2Key);
          } catch {
            if (rec.aadVersion !== 2 && (rec.kdfVersion === undefined || rec.kdfVersion === 1)) {
              try {
                plain = decryptPayloadWithKey(rec, legacyShaKey);
              } catch {
                plain = null;
              }
            }
          }
          if (!plain) {
            legacyV2Key.fill(0);
            legacyShaKey.fill(0);
            return {
              ok: false,
              httpCode: 401,
              error:
                'A chave mestra informada não corresponde a todos os registros criptografados existentes em disco.',
            };
          }
          decryptedAll.push({ record: rec, plain });
        }

        legacyV2Key.fill(0);
        legacyShaKey.fill(0);

        const freshSalt = crypto.randomBytes(16);
        const freshDerived = await deriveScryptAsync(masterKey, freshSalt, 32);

        const upgradedRecords: EncryptedVaultRecord[] = decryptedAll.map(({ record, plain }) => {
          const aad = buildRecordAad(record);
          const reEncrypted = encryptPayloadWithKey(plain, freshDerived, aad);
          return {
            ...record,
            kdfVersion: 2,
            aadVersion: 2,
            ...reEncrypted,
          };
        });

        const verifier = encryptTextWithKey(VERIFIER_PLAINTEXT, freshDerived, VERIFIER_AAD_V2);
        const newMeta: VaultMetaRecord = {
          version: 1,
          kdf: 'scrypt',
          saltMode: 'hex',
          salt: freshSalt.toString('hex'),
          verifierAadVersion: 2,
          verifier,
          createdAt: new Date().toISOString(),
        };

        writeVaultFile(VAULT_FILE, JSON.stringify(upgradedRecords));
        writeVaultFile(VAULT_META_FILE, JSON.stringify(newMeta));

        clearRuntimeMasterKey();
        runtimeDerivedKey = freshDerived;
        runtimeUnlockedAt = new Date().toISOString();
        lastActivityAtMs = Date.now();
        return {
          ok: true,
          status: getVaultSecurityStatus(),
          migratedCount: upgradedRecords.length,
        };
      }
    }

    // First-time persistent initialization via UI: enforce strong master key & generate random salt.
    const strength = validateNewMasterKeyStrength(masterKey, 'A chave mestra inicial');
    if (!strength.ok) {
      return {
        ok: false,
        httpCode: 400,
        error: strength.error,
      };
    }

    const saltBytes = crypto.randomBytes(16);
    const derived = await deriveScryptAsync(masterKey, saltBytes, 32);
    const verifier = encryptTextWithKey(VERIFIER_PLAINTEXT, derived, VERIFIER_AAD_V2);
    const newMeta: VaultMetaRecord = {
      version: 1,
      kdf: 'scrypt',
      saltMode: 'hex',
      salt: saltBytes.toString('hex'),
      verifierAadVersion: 2,
      verifier,
      createdAt: new Date().toISOString(),
    };

    let migratedCount = 0;
    const migratedRecords: EncryptedVaultRecord[] = [];
    for (const memRec of memoryRecords) {
      const plain = decryptPayloadWithKey(memRec, EPHEMERAL_MASTER_KEY);
      const aad = buildRecordAad(memRec);
      const reEncrypted = encryptPayloadWithKey(plain, derived, aad);
      migratedRecords.push({
        ...memRec,
        kdfVersion: 2,
        aadVersion: 2,
        ...reEncrypted,
      });
      migratedCount += 1;
    }

    writeVaultFile(VAULT_META_FILE, JSON.stringify(newMeta));
    if (migratedRecords.length > 0 || !hasDiskVaultFile()) {
      writeVaultFile(VAULT_FILE, JSON.stringify(migratedRecords));
    }
    memoryRecords = [];

    clearRuntimeMasterKey();
    runtimeDerivedKey = derived;
    runtimeUnlockedAt = new Date().toISOString();
    lastActivityAtMs = Date.now();

    return { ok: true, status: getVaultSecurityStatus(), migratedCount };
  });
}

export async function rotateVaultMasterKey(
  rawCurrentKey: unknown,
  rawNewKey: unknown,
): Promise<
  | { ok: true; status: VaultSecurityStatus; rotatedRecordsCount: number }
  | { ok: false; error: string; httpCode: number }
> {
  if (getConfiguredEnvSecret()) {
    return {
      ok: false,
      httpCode: 409,
      error: 'A rotação pela interface não é aplicável quando AURIX_VAULT_SECRET está fixada no ambiente.',
    };
  }
  if (typeof rawCurrentKey !== 'string' || rawCurrentKey.length < 16 || rawCurrentKey.length > 256) {
    return {
      ok: false,
      httpCode: 400,
      error: 'Informe a chave mestra atual válida.',
    };
  }
  const newStrength = validateNewMasterKeyStrength(rawNewKey, 'A nova chave mestra');
  if (!newStrength.ok) {
    return { ok: false, httpCode: 400, error: newStrength.error };
  }
  if (rawCurrentKey === newStrength.value) {
    return {
      ok: false,
      httpCode: 400,
      error: 'A nova chave mestra deve ser diferente da chave atual.',
    };
  }

  return withVaultLock(async () => {
    let meta: VaultMetaRecord | null;
    let existingRecords: EncryptedVaultRecord[];
    try {
      meta = readVaultMetaStrict();
      existingRecords = loadRecordsStrict();
    } catch (err) {
      return {
        ok: false,
        httpCode: 500,
        error: err instanceof Error ? err.message : 'Falha de integridade no cofre.',
      };
    }

    if (!meta) {
      return {
        ok: false,
        httpCode: 409,
        error: 'O cofre ainda está em memória temporária. Ative a persistência antes de rotacionar.',
      };
    }

    const currentSalt =
      meta.saltMode === 'legacy_v2' ? meta.salt : Buffer.from(meta.salt, 'hex');
    const currentDerived = await deriveScryptAsync(rawCurrentKey, currentSalt, 32);
    const verifierAad = meta.verifierAadVersion === 2 ? VERIFIER_AAD_V2 : undefined;

    try {
      const check = decryptTextWithKey(meta.verifier, currentDerived, verifierAad);
      if (check !== VERIFIER_PLAINTEXT) {
        currentDerived.fill(0);
        return {
          ok: false,
          httpCode: 401,
          error: 'A chave mestra atual está incorreta.',
        };
      }
    } catch {
      currentDerived.fill(0);
      return {
        ok: false,
        httpCode: 401,
        error: 'A chave mestra atual está incorreta.',
      };
    }

    const decryptedAll: Array<{
      record: EncryptedVaultRecord;
      plain: { apiKey: string; secondaryCredential?: string };
    }> = [];

    for (const rec of existingRecords) {
      try {
        const plain = decryptPayloadWithKey(rec, currentDerived);
        decryptedAll.push({ record: rec, plain });
      } catch {
        currentDerived.fill(0);
        return {
          ok: false,
          httpCode: 500,
          error: `Não foi possível descriptografar o registro ${rec.id} com a chave atual. Rotação abortada sem alterar o disco.`,
        };
      }
    }
    currentDerived.fill(0);

    const nextSalt = crypto.randomBytes(16);
    const nextDerived = await deriveScryptAsync(newStrength.value, nextSalt, 32);

    const reSealedRecords: EncryptedVaultRecord[] = decryptedAll.map(({ record, plain }) => {
      const aad = buildRecordAad(record);
      const encrypted = encryptPayloadWithKey(plain, nextDerived, aad);
      return {
        ...record,
        kdfVersion: 2,
        aadVersion: 2,
        ...encrypted,
      };
    });

    const nextMeta: VaultMetaRecord = {
      version: 1,
      kdf: 'scrypt',
      saltMode: 'hex',
      salt: nextSalt.toString('hex'),
      verifierAadVersion: 2,
      verifier: encryptTextWithKey(VERIFIER_PLAINTEXT, nextDerived, VERIFIER_AAD_V2),
      createdAt: meta.createdAt,
      rotatedAt: new Date().toISOString(),
    };

    writeVaultFile(VAULT_FILE, JSON.stringify(reSealedRecords));
    writeVaultFile(VAULT_META_FILE, JSON.stringify(nextMeta));

    clearRuntimeMasterKey();
    runtimeDerivedKey = nextDerived;
    runtimeUnlockedAt = new Date().toISOString();
    lastActivityAtMs = Date.now();

    return {
      ok: true,
      status: getVaultSecurityStatus(),
      rotatedRecordsCount: reSealedRecords.length,
    };
  });
}

export function lockVaultRuntime():
  | { ok: true; status: VaultSecurityStatus }
  | { ok: false; error: string } {
  if (getConfiguredEnvSecret()) {
    return {
      ok: false,
      error: 'O cofre está vinculado à variável AURIX_VAULT_SECRET do ambiente.',
    };
  }
  if (getActivePersistenceKind() === 'ephemeral_memory') {
    return {
      ok: false,
      error: 'Defina uma chave mestra antes de bloquear o cofre.',
    };
  }
  clearRuntimeMasterKey();
  return { ok: true, status: getVaultSecurityStatus() };
}

export function listVaultKeySummaries(): VaultKeySummary[] {
  return loadRecordsStrict().map(toSummary);
}

export function getVaultKeyMetadata(id: string): VaultKeySummary | null {
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
    return null;
  }
  const match = loadRecordsStrict().find((item) => item.id === id);
  return match ? toSummary(match) : null;
}

export function countKeysByProvider(): Record<ProviderId, number> {
  const counts: Record<ProviderId, number> = {
    gemini: 0,
    groq: 0,
    cloudflare: 0,
    openrouter: 0,
    mistral: 0,
  };
  for (const item of loadRecordsStrict()) {
    if (item.providerId in counts) {
      counts[item.providerId] += 1;
    }
  }
  return counts;
}

export async function registerVaultKey(input: {
  providerId: unknown;
  label: unknown;
  apiKey: unknown;
  secondaryCredential?: unknown;
  scopeAppId?: unknown;
  environment?: unknown;
}): Promise<
  | { ok: true; summary: VaultKeySummary }
  | { ok: false; reason: 'locked' | 'corrupted' | 'validation'; error: string }
> {
  return withVaultLock(() => {
    const activeKey = getActiveMasterKey();
    if (!activeKey) {
      return {
        ok: false,
        reason: 'locked',
        error:
          'Cofre bloqueado. Desbloqueie com a chave mestra em "Segurança e Cofre" antes de cadastrar chaves.',
      };
    }

    if (
      typeof input.providerId !== 'string' ||
      !VALID_PROVIDERS.has(input.providerId as ProviderId)
    ) {
      return { ok: false, reason: 'validation', error: 'Provedor não suportado.' };
    }
    if (
      typeof input.label !== 'string' ||
      input.label.trim().length < 2 ||
      input.label.trim().length > 60
    ) {
      return {
        ok: false,
        reason: 'validation',
        error: 'Informe um rótulo identificador entre 2 e 60 caracteres.',
      };
    }
    if (
      typeof input.apiKey !== 'string' ||
      input.apiKey.trim().length < 8 ||
      input.apiKey.trim().length > 512
    ) {
      return {
        ok: false,
        reason: 'validation',
        error: 'A chave API deve ter entre 8 e 512 caracteres.',
      };
    }

    const secondary =
      typeof input.secondaryCredential === 'string' &&
      input.secondaryCredential.trim().length > 0
        ? input.secondaryCredential.trim().slice(0, 256)
        : undefined;

    if (input.providerId === 'cloudflare' && !secondary) {
      return {
        ok: false,
        reason: 'validation',
        error: 'Cloudflare Workers AI requer o Account ID além do API Token.',
      };
    }

    const environment: VaultEnvironment =
      typeof input.environment === 'string' &&
      VALID_ENVS.has(input.environment as VaultEnvironment)
        ? (input.environment as VaultEnvironment)
        : 'development';

    let scopeAppId = 'global';
    if (
      input.scopeAppId !== undefined &&
      input.scopeAppId !== null &&
      input.scopeAppId !== '' &&
      input.scopeAppId !== 'global'
    ) {
      if (
        typeof input.scopeAppId !== 'string' ||
        !/^[a-zA-Z0-9_-]{2,64}$/.test(input.scopeAppId) ||
        !hasTenantId(input.scopeAppId)
      ) {
        return {
          ok: false,
          reason: 'validation',
          error: 'Escopo de aplicativo inválido ou não registrado no Tenant Registry.',
        };
      }
      scopeAppId = input.scopeAppId;
    }

    let records: EncryptedVaultRecord[];
    try {
      records = loadRecordsStrict();
    } catch (err) {
      return {
        ok: false,
        reason: 'corrupted',
        error: err instanceof Error ? err.message : 'Arquivo do cofre corrompido.',
      };
    }

    const id = `key_${crypto.randomBytes(6).toString('hex')}`;
    const providerId = input.providerId as ProviderId;
    const aad = buildRecordAad({ id, providerId, scopeAppId, environment });
    const encrypted = encryptPayloadWithKey(
      {
        apiKey: input.apiKey.trim(),
        secondaryCredential: secondary,
      },
      activeKey,
      aad,
    );

    const record: EncryptedVaultRecord = {
      id,
      providerId,
      label: input.label.trim(),
      maskedPreview: maskApiKey(input.apiKey),
      hasSecondaryCredential: Boolean(secondary),
      scopeAppId,
      environment,
      status: 'stored_unverified',
      statusNote: 'Armazenada com AES-256-GCM + AAD no servidor · Aguardando teste HTTP',
      lastHttpStatus: null,
      lastTestedAt: null,
      lastModelTested: null,
      kdfVersion: 2,
      aadVersion: 2,
      createdAt: new Date().toISOString(),
      ...encrypted,
    };

    records.unshift(record);
    saveRecords(records);
    touchVaultActivity();

    return { ok: true, summary: toSummary(record) };
  });
}

export function decryptVaultKeySecret(id: string): DecryptedVaultCredential | null {
  if (!getActiveMasterKey()) {
    return null;
  }
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
    return null;
  }
  const records = loadRecordsStrict();
  const match = records.find((item) => item.id === id);
  if (!match) {
    return null;
  }
  try {
    const payload = decryptPayload(match);
    touchVaultActivity();
    return {
      id: match.id,
      providerId: match.providerId,
      label: match.label,
      scopeAppId: match.scopeAppId,
      environment: match.environment,
      apiKey: payload.apiKey,
      secondaryCredential: payload.secondaryCredential,
    };
  } catch {
    return null;
  }
}

export async function recordVaultKeyTestResult(
  id: string,
  update: {
    status: VaultKeyVerificationStatus;
    statusNote: string;
    lastHttpStatus: number | null;
    lastTestedAt: string;
    lastModelTested: string;
  },
): Promise<VaultKeySummary | null> {
  return withVaultLock(() => {
    if (!getActiveMasterKey()) {
      return null;
    }
    if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
      return null;
    }
    const records = loadRecordsStrict();
    const idx = records.findIndex((item) => item.id === id);
    if (idx === -1) {
      return null;
    }
    const updated: EncryptedVaultRecord = {
      ...records[idx],
      status: update.status,
      statusNote: update.statusNote,
      lastHttpStatus: update.lastHttpStatus,
      lastTestedAt: update.lastTestedAt,
      lastModelTested: update.lastModelTested,
    };
    records[idx] = updated;
    saveRecords(records);
    touchVaultActivity();
    return toSummary(updated);
  });
}

export async function deleteVaultKey(
  id: string,
): Promise<{ ok: boolean; reason?: 'locked' | 'not_found' | 'corrupted'; error?: string }> {
  return withVaultLock(() => {
    if (!getActiveMasterKey()) {
      return { ok: false, reason: 'locked' };
    }
    if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
      return { ok: false, reason: 'not_found' };
    }
    let records: EncryptedVaultRecord[];
    try {
      records = loadRecordsStrict();
    } catch (err) {
      return {
        ok: false,
        reason: 'corrupted',
        error: err instanceof Error ? err.message : 'Arquivo do cofre corrompido.',
      };
    }
    const next = records.filter((item) => item.id !== id);
    if (next.length === records.length) {
      return { ok: false, reason: 'not_found' };
    }
    saveRecords(next);
    touchVaultActivity();
    return { ok: true };
  });
}

export async function exportEncryptedVaultBackup(
  rawPassphrase: unknown,
): Promise<
  | { ok: true; bundle: EncryptedVaultBackupBundle }
  | { ok: false; error: string; httpCode: number }
> {
  const activeKey = getActiveMasterKey();
  if (!activeKey) {
    return {
      ok: false,
      httpCode: 423,
      error: 'Desbloqueie o cofre antes de exportar um backup cifrado.',
    };
  }

  const strength = validateNewMasterKeyStrength(rawPassphrase, 'A senha do backup');
  if (!strength.ok) {
    return { ok: false, httpCode: 400, error: strength.error };
  }

  let records: EncryptedVaultRecord[];
  try {
    records = loadRecordsStrict();
  } catch (err) {
    return {
      ok: false,
      httpCode: 500,
      error: err instanceof Error ? err.message : 'Arquivo do cofre corrompido.',
    };
  }

  const plainRecords: BackupPlainRecord[] = [];
  for (const rec of records) {
    try {
      const payload = decryptPayload(rec);
      plainRecords.push({
        id: rec.id,
        providerId: rec.providerId,
        label: rec.label,
        maskedPreview: rec.maskedPreview,
        hasSecondaryCredential: rec.hasSecondaryCredential,
        scopeAppId: rec.scopeAppId,
        environment: rec.environment,
        status: rec.status,
        statusNote: rec.statusNote,
        lastHttpStatus: rec.lastHttpStatus ?? null,
        lastTestedAt: rec.lastTestedAt ?? null,
        lastModelTested: rec.lastModelTested ?? null,
        createdAt: rec.createdAt,
        apiKey: payload.apiKey,
        secondaryCredential: payload.secondaryCredential,
      });
    } catch {
      return {
        ok: false,
        httpCode: 500,
        error: `Falha ao descriptografar o registro ${rec.id} para exportação.`,
      };
    }
  }

  const exportedAt = new Date().toISOString();
  const backupSalt = crypto.randomBytes(16);
  const backupKey = await deriveScryptAsync(strength.value, backupSalt, 32);
  const sealed = encryptTextWithKey(
    JSON.stringify({ version: 1, exportedAt, records: plainRecords }),
    backupKey,
    BACKUP_AAD_V1,
  );
  backupKey.fill(0);
  touchVaultActivity();

  return {
    ok: true,
    bundle: {
      format: 'aurix-vault-backup-v1',
      kdf: 'scrypt',
      salt: backupSalt.toString('hex'),
      iv: sealed.iv,
      authTag: sealed.authTag,
      ciphertext: sealed.ciphertext,
      exportedAt,
      recordCount: plainRecords.length,
    },
  };
}

export async function restoreEncryptedVaultBackup(
  rawBundle: unknown,
  rawPassphrase: unknown,
): Promise<
  | { ok: true; restoredCount: number; totalKeys: number; status: VaultSecurityStatus }
  | { ok: false; error: string; httpCode: number }
> {
  const activeKey = getActiveMasterKey();
  if (!activeKey) {
    return {
      ok: false,
      httpCode: 423,
      error: 'Desbloqueie o cofre com a chave mestra ativa antes de restaurar um backup.',
    };
  }
  if (typeof rawPassphrase !== 'string' || rawPassphrase.length < 16 || rawPassphrase.length > 256) {
    return {
      ok: false,
      httpCode: 400,
      error: 'Informe a senha do backup (16 a 256 caracteres).',
    };
  }
  if (!rawBundle || typeof rawBundle !== 'object') {
    return { ok: false, httpCode: 400, error: 'Pacote de backup inválido.' };
  }

  const b = rawBundle as Partial<EncryptedVaultBackupBundle>;
  if (
    b.format !== 'aurix-vault-backup-v1' ||
    b.kdf !== 'scrypt' ||
    typeof b.salt !== 'string' ||
    !/^[0-9a-f]{32,64}$/i.test(b.salt) ||
    typeof b.iv !== 'string' ||
    !/^[0-9a-f]{24}$/i.test(b.iv) ||
    typeof b.authTag !== 'string' ||
    !/^[0-9a-f]{32}$/i.test(b.authTag) ||
    typeof b.ciphertext !== 'string' ||
    !/^[0-9a-f]+$/i.test(b.ciphertext)
  ) {
    return { ok: false, httpCode: 400, error: 'Formato ou campos criptográficos do backup inválidos.' };
  }

  const backupKey = await deriveScryptAsync(rawPassphrase, Buffer.from(b.salt, 'hex'), 32);
  let decodedPlain: { version?: number; records?: unknown[] };
  try {
    const plaintext = decryptTextWithKey(
      { iv: b.iv, authTag: b.authTag, ciphertext: b.ciphertext },
      backupKey,
      BACKUP_AAD_V1,
    );
    decodedPlain = JSON.parse(plaintext) as { version?: number; records?: unknown[] };
  } catch {
    backupKey.fill(0);
    return {
      ok: false,
      httpCode: 401,
      error: 'Senha do backup incorreta ou arquivo de backup adulterado.',
    };
  }
  backupKey.fill(0);

  if (!decodedPlain || decodedPlain.version !== 1 || !Array.isArray(decodedPlain.records)) {
    return { ok: false, httpCode: 400, error: 'Conteúdo interno do backup inválido.' };
  }

  const validatedPlain: BackupPlainRecord[] = [];
  for (const item of decodedPlain.records) {
    if (!item || typeof item !== 'object') {
      return { ok: false, httpCode: 400, error: 'Registro inválido dentro do backup.' };
    }
    const r = item as Partial<BackupPlainRecord>;
    if (
      typeof r.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{4,40}$/.test(r.id) ||
      typeof r.providerId !== 'string' ||
      !VALID_PROVIDERS.has(r.providerId as ProviderId) ||
      typeof r.label !== 'string' ||
      typeof r.apiKey !== 'string' ||
      r.apiKey.length < 8 ||
      typeof r.scopeAppId !== 'string' ||
      typeof r.environment !== 'string' ||
      !VALID_ENVS.has(r.environment as VaultEnvironment)
    ) {
      return { ok: false, httpCode: 400, error: 'Metadados inválidos em registro do backup.' };
    }
    validatedPlain.push({
      id: r.id,
      providerId: r.providerId as ProviderId,
      label: r.label,
      maskedPreview: typeof r.maskedPreview === 'string' ? r.maskedPreview : maskApiKey(r.apiKey),
      hasSecondaryCredential: Boolean(r.secondaryCredential),
      scopeAppId: r.scopeAppId,
      environment: r.environment as VaultEnvironment,
      status: r.status ?? 'stored_unverified',
      statusNote:
        typeof r.statusNote === 'string'
          ? r.statusNote
          : 'Restaurada de backup cifrado · AES-256-GCM + AAD',
      lastHttpStatus: r.lastHttpStatus ?? null,
      lastTestedAt: r.lastTestedAt ?? null,
      lastModelTested: r.lastModelTested ?? null,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
      apiKey: r.apiKey,
      secondaryCredential:
        typeof r.secondaryCredential === 'string' ? r.secondaryCredential : undefined,
    });
  }

  return withVaultLock(() => {
    const currentActiveKey = getActiveMasterKey();
    if (!currentActiveKey) {
      return {
        ok: false,
        httpCode: 423,
        error: 'Cofre bloqueado durante a restauração.',
      };
    }

    let existingValid: EncryptedVaultRecord[] = [];
    try {
      existingValid = loadRecordsStrict();
    } catch {
      // If disk vault was corrupted, restore replaces the corrupted file with the verified backup.
      existingValid = [];
    }

    const byId = new Map<string, EncryptedVaultRecord>();
    for (const rec of existingValid) {
      byId.set(rec.id, rec);
    }

    for (const plain of validatedPlain) {
      const aad = buildRecordAad(plain);
      const encrypted = encryptPayloadWithKey(
        { apiKey: plain.apiKey, secondaryCredential: plain.secondaryCredential },
        currentActiveKey,
        aad,
      );
      byId.set(plain.id, {
        id: plain.id,
        providerId: plain.providerId,
        label: plain.label,
        maskedPreview: plain.maskedPreview,
        hasSecondaryCredential: Boolean(plain.secondaryCredential),
        scopeAppId: plain.scopeAppId,
        environment: plain.environment,
        status: plain.status,
        statusNote: plain.statusNote,
        lastHttpStatus: plain.lastHttpStatus ?? null,
        lastTestedAt: plain.lastTestedAt ?? null,
        lastModelTested: plain.lastModelTested ?? null,
        kdfVersion: 2,
        aadVersion: 2,
        createdAt: plain.createdAt,
        ...encrypted,
      });
    }

    const merged = Array.from(byId.values());
    saveRecords(merged);
    touchVaultActivity();

    return {
      ok: true,
      restoredCount: validatedPlain.length,
      totalKeys: merged.length,
      status: getVaultSecurityStatus(),
    };
  });
}

export { VaultCorruptionError };
