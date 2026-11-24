import net from 'node:net';
import tls from 'node:tls';
import {
  readVaultFile,
  VaultCorruptionError,
  withVaultLock,
  writeVaultFile,
} from './storage.ts';

const REVOKED_SESSIONS_FILE = 'revoked-sessions.json';
const RATE_LIMITS_FILE = 'rate-limits.json';

export class SharedStoreUnavailableError extends Error {
  readonly httpCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'SharedStoreUnavailableError';
  }
}

export interface PersistedFailureRecord {
  failures: number;
  windowStart: number;
  blockedUntil: number;
  lastAttemptAt: number;
}

interface ParsedRedisUrl {
  useTls: boolean;
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
}

function parseRedisUrl(rawUrl: string): ParsedRedisUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SharedStoreUnavailableError('AURIX_REDIS_URL inválida.');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new SharedStoreUnavailableError('AURIX_REDIS_URL deve usar redis:// ou rediss://.');
  }
  const dbStr = parsed.pathname.replace(/^\//, '').trim();
  const db = dbStr ? Number(dbStr) : 0;
  if (!Number.isInteger(db) || db < 0) {
    throw new SharedStoreUnavailableError('Índice de banco Redis inválido.');
  }
  return {
    useTls: parsed.protocol === 'rediss:',
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db,
  };
}

function encodeRespCommand(args: string[]): Buffer {
  const parts: string[] = [`*${args.length}\r\n`];
  for (const arg of args) {
    const byteLen = Buffer.byteLength(arg, 'utf8');
    parts.push(`$${byteLen}\r\n${arg}\r\n`);
  }
  return Buffer.from(parts.join(''), 'utf8');
}

function tryParseRespReply(
  buf: Buffer,
  offset = 0,
): { value: string | number | null; nextOffset: number } | null {
  if (offset >= buf.length) return null;
  const lineEnd = buf.indexOf('\r\n', offset);
  if (lineEnd === -1) return null;

  const prefix = String.fromCharCode(buf[offset]);
  const header = buf.subarray(offset + 1, lineEnd).toString('utf8');

  if (prefix === '+') {
    return { value: header, nextOffset: lineEnd + 2 };
  }
  if (prefix === '-') {
    throw new SharedStoreUnavailableError(`Erro do Redis: ${header}`);
  }
  if (prefix === ':') {
    return { value: Number(header), nextOffset: lineEnd + 2 };
  }
  if (prefix === '$') {
    const len = Number(header);
    if (len === -1) {
      return { value: null, nextOffset: lineEnd + 2 };
    }
    const bodyStart = lineEnd + 2;
    const bodyEnd = bodyStart + len;
    if (buf.length < bodyEnd + 2) return null;
    const str = buf.subarray(bodyStart, bodyEnd).toString('utf8');
    return { value: str, nextOffset: bodyEnd + 2 };
  }

  throw new SharedStoreUnavailableError('Resposta RESP inválida do Redis.');
}

async function execRedisCommands(
  cfg: ParsedRedisUrl,
  commands: string[][],
  timeoutMs = 2000,
): Promise<Array<string | number | null>> {
  const allCommands: string[][] = [];
  if (cfg.password) {
    if (cfg.username) {
      allCommands.push(['AUTH', cfg.username, cfg.password]);
    } else {
      allCommands.push(['AUTH', cfg.password]);
    }
  }
  if (cfg.db > 0) {
    allCommands.push(['SELECT', String(cfg.db)]);
  }
  const setupCount = allCommands.length;
  allCommands.push(...commands);

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = cfg.useTls
      ? tls.connect({
          host: cfg.host,
          port: cfg.port,
          servername: cfg.host,
          rejectUnauthorized: true,
        })
      : net.createConnection({ host: cfg.host, port: cfg.port });

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(
        err instanceof SharedStoreUnavailableError
          ? err
          : new SharedStoreUnavailableError('Armazenamento compartilhado Redis indisponível.'),
      );
    };

    socket.setTimeout(timeoutMs, () => {
      fail(new SharedStoreUnavailableError('Timeout conectando ao Redis.'));
    });

    socket.on('error', (err) => fail(err));

    const connectEvent = cfg.useTls ? 'secureConnect' : 'connect';
    socket.once(connectEvent, () => {
      const payload = Buffer.concat(allCommands.map((c) => encodeRespCommand(c)));
      socket.write(payload);
    });

    let rx = Buffer.alloc(0);
    const replies: Array<string | number | null> = [];

    socket.on('data', (chunk: Buffer) => {
      rx = Buffer.concat([rx, chunk]);
      try {
        let cursor = 0;
        while (replies.length < allCommands.length) {
          const parsed = tryParseRespReply(rx, cursor);
          if (!parsed) break;
          replies.push(parsed.value);
          cursor = parsed.nextOffset;
        }
        if (cursor > 0) {
          rx = rx.subarray(cursor);
        }
        if (replies.length === allCommands.length && !settled) {
          settled = true;
          socket.end();
          resolve(replies.slice(setupCount));
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error('Erro RESP'));
      }
    });
  });
}

export function isSharedStoreRequired(): boolean {
  return process.env.AURIX_REQUIRE_SHARED_STORE === 'true';
}

export function getConfiguredRedisUrl(): string | null {
  const val = process.env.AURIX_REDIS_URL?.trim();
  return val && val.length > 0 ? val : null;
}

export async function checkSharedStoreHealth(): Promise<{
  mode: 'redis' | 'single_instance_disk' | 'unavailable_fail_closed';
  healthy: boolean;
  detail: string;
}> {
  const redisUrl = getConfiguredRedisUrl();
  if (redisUrl) {
    try {
      const cfg = parseRedisUrl(redisUrl);
      const [pong] = await execRedisCommands(cfg, [['PING']]);
      if (pong === 'PONG') {
        return {
          mode: 'redis',
          healthy: true,
          detail: 'Redis conectado e respondendo (revogação de sessões e rate limit compartilhados).',
        };
      }
      return {
        mode: 'unavailable_fail_closed',
        healthy: false,
        detail: 'Redis respondeu incorretamente ao PING (modo fail-closed ativo).',
      };
    } catch (err) {
      return {
        mode: 'unavailable_fail_closed',
        healthy: false,
        detail:
          err instanceof Error
            ? err.message
            : 'Falha de conexão com Redis (modo fail-closed ativo).',
      };
    }
  }

  if (isSharedStoreRequired()) {
    return {
      mode: 'unavailable_fail_closed',
      healthy: false,
      detail:
        'AURIX_REQUIRE_SHARED_STORE=true, porém AURIX_REDIS_URL não está configurada.',
    };
  }

  return {
    mode: 'single_instance_disk',
    healthy: true,
    detail:
      'Modo instância única com persistência atômica em disco (.aurix-vault/). Multi-instância exige AURIX_REDIS_URL.',
  };
}

function getActiveBackendOrThrow(): { kind: 'redis'; cfg: ParsedRedisUrl } | { kind: 'disk' } {
  const redisUrl = getConfiguredRedisUrl();
  if (redisUrl) {
    return { kind: 'redis', cfg: parseRedisUrl(redisUrl) };
  }
  if (isSharedStoreRequired()) {
    throw new SharedStoreUnavailableError(
      'Proteção compartilhada obrigatória (AURIX_REQUIRE_SHARED_STORE=true) sem AURIX_REDIS_URL.',
    );
  }
  return { kind: 'disk' };
}

function loadJsonMapFromVault<T>(fileName: string): Record<string, T> {
  const raw = readVaultFile(fileName);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new VaultCorruptionError(fileName, `Arquivo ${fileName} inválido.`);
    }
    return parsed as Record<string, T>;
  } catch (err) {
    if (err instanceof VaultCorruptionError) throw err;
    throw new VaultCorruptionError(fileName, `Arquivo ${fileName} corrompido.`);
  }
}

export async function revokeSessionJti(jti: string, expMs: number): Promise<void> {
  const backend = getActiveBackendOrThrow();
  const ttlMs = Math.max(1000, expMs - Date.now());

  if (backend.kind === 'redis') {
    await execRedisCommands(backend.cfg, [
      ['SET', `aurix:revoked:${jti}`, '1', 'PX', String(ttlMs)],
    ]);
    return;
  }

  await withVaultLock(() => {
    const map = loadJsonMapFromVault<number>(REVOKED_SESSIONS_FILE);
    const now = Date.now();
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== 'number' || v <= now) {
        delete map[k];
      }
    }
    map[jti] = expMs;
    writeVaultFile(REVOKED_SESSIONS_FILE, JSON.stringify(map));
  });
}

export async function isSessionJtiRevoked(jti: string): Promise<boolean> {
  const backend = getActiveBackendOrThrow();

  if (backend.kind === 'redis') {
    const [val] = await execRedisCommands(backend.cfg, [['GET', `aurix:revoked:${jti}`]]);
    return val !== null;
  }

  const map = loadJsonMapFromVault<number>(REVOKED_SESSIONS_FILE);
  const exp = map[jti];
  return typeof exp === 'number' && exp > Date.now();
}

export async function getFailureRecord(key: string): Promise<PersistedFailureRecord | null> {
  const backend = getActiveBackendOrThrow();

  if (backend.kind === 'redis') {
    const [raw] = await execRedisCommands(backend.cfg, [['GET', `aurix:rl:${key}`]]);
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw) as PersistedFailureRecord;
    } catch {
      return null;
    }
  }

  const map = loadJsonMapFromVault<PersistedFailureRecord>(RATE_LIMITS_FILE);
  return map[key] ?? null;
}

export async function saveFailureRecord(
  key: string,
  record: PersistedFailureRecord,
  ttlMs: number,
): Promise<void> {
  const backend = getActiveBackendOrThrow();

  if (backend.kind === 'redis') {
    await execRedisCommands(backend.cfg, [
      ['SET', `aurix:rl:${key}`, JSON.stringify(record), 'PX', String(Math.max(5000, ttlMs))],
    ]);
    return;
  }

  await withVaultLock(() => {
    const map = loadJsonMapFromVault<PersistedFailureRecord>(RATE_LIMITS_FILE);
    const now = Date.now();
    for (const [k, rec] of Object.entries(map)) {
      if (
        !rec ||
        (rec.blockedUntil <= now && now - rec.lastAttemptAt > 30 * 60_000)
      ) {
        delete map[k];
      }
    }
    map[key] = record;
    writeVaultFile(RATE_LIMITS_FILE, JSON.stringify(map));
  });
}

export async function deleteFailureRecord(key: string): Promise<void> {
  const backend = getActiveBackendOrThrow();

  if (backend.kind === 'redis') {
    await execRedisCommands(backend.cfg, [['DEL', `aurix:rl:${key}`]]);
    return;
  }

  await withVaultLock(() => {
    const map = loadJsonMapFromVault<PersistedFailureRecord>(RATE_LIMITS_FILE);
    if (key in map) {
      delete map[key];
      writeVaultFile(RATE_LIMITS_FILE, JSON.stringify(map));
    }
  });
}

export async function checkSharedBurstLimit(
  subject: string,
  limitPerMinute: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const backend = getActiveBackendOrThrow();
  if (backend.kind !== 'redis') {
    // Disk-free fast path for per-minute request burst in single-instance mode (brute force policies still persist on disk).
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const bucketMinute = Math.floor(Date.now() / 60_000);
  const key = `aurix:burst:${subject}:${bucketMinute}`;
  const [count] = await execRedisCommands(backend.cfg, [
    ['INCR', key],
    ['PEXPIRE', key, '65000'],
  ]);
  const numCount = typeof count === 'number' ? count : Number(count ?? 0);
  if (numCount > limitPerMinute) {
    const msLeft = 60_000 - (Date.now() % 60_000);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function clearDiskSecurityStateForTests(): Promise<void> {
  if (getConfiguredRedisUrl() || isSharedStoreRequired()) return;
  await withVaultLock(() => {
    writeVaultFile(REVOKED_SESSIONS_FILE, JSON.stringify({}));
    writeVaultFile(RATE_LIMITS_FILE, JSON.stringify({}));
  });
}
