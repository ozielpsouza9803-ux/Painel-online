import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { deriveScryptAsync } from './cryptoAsync.ts';
import { isSessionJtiRevoked, revokeSessionJti } from './sharedStore.ts';
import { readVaultFile, VaultCorruptionError, withVaultLock, writeVaultFile } from './storage.ts';

interface StoredAdminRecord {
  salt: string;
  hash: string;
  createdAt: string;
}

const ADMIN_FILE = 'admin-credential.json';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_SIGNING_SECRET =
  process.env.AURIX_SESSION_SECRET && process.env.AURIX_SESSION_SECRET.trim().length >= 16
    ? process.env.AURIX_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

let cachedEnvPasscodeValue: string | null = null;
let cachedEnvPasscodeSalt: string | null = null;
let cachedEnvPasscodeHashHex: string | null = null;

export function hasConfiguredSessionSecret(): boolean {
  const s = process.env.AURIX_SESSION_SECRET?.trim();
  return Boolean(s && s.length >= 32);
}

export function hasMinimumSessionSecret(): boolean {
  const s = process.env.AURIX_SESSION_SECRET?.trim();
  return Boolean(s && s.length >= 16);
}

function getEnvAdminPasscode(): string | null {
  const value = process.env.AURIX_ADMIN_PASSCODE?.trim();
  return value && value.length > 0 ? value : null;
}

async function verifyEnvPasscodeAsync(candidate: string): Promise<boolean> {
  const envPasscode = getEnvAdminPasscode();
  if (!envPasscode) return false;

  if (
    cachedEnvPasscodeValue !== envPasscode ||
    !cachedEnvPasscodeSalt ||
    !cachedEnvPasscodeHashHex
  ) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await deriveScryptAsync(envPasscode, salt, 64);
    cachedEnvPasscodeValue = envPasscode;
    cachedEnvPasscodeSalt = salt;
    cachedEnvPasscodeHashHex = derived.toString('hex');
  }

  const candidateDerived = await deriveScryptAsync(candidate, cachedEnvPasscodeSalt, 64);
  return constantTimeCompareHex(candidateDerived.toString('hex'), cachedEnvPasscodeHashHex);
}

function readClaimedAdmin(): StoredAdminRecord | null {
  const raw = readVaultFile(ADMIN_FILE);
  if (raw === null) return null;
  let parsed: Partial<StoredAdminRecord>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredAdminRecord>;
  } catch {
    throw new VaultCorruptionError(
      ADMIN_FILE,
      'Arquivo de credencial administrativa corrompido.',
    );
  }
  if (
    typeof parsed.salt === 'string' &&
    typeof parsed.hash === 'string' &&
    typeof parsed.createdAt === 'string'
  ) {
    return {
      salt: parsed.salt,
      hash: parsed.hash,
      createdAt: parsed.createdAt,
    };
  }
  throw new VaultCorruptionError(
    ADMIN_FILE,
    'Estrutura da credencial administrativa inválida.',
  );
}

async function hashPasscodeAsync(passcode: string, salt: string): Promise<string> {
  const derived = await deriveScryptAsync(passcode, salt, 64);
  return derived.toString('hex');
}

function constantTimeCompareHex(aHex: string, bHex: string): boolean {
  const aBuf = Buffer.from(aHex, 'hex');
  const bBuf = Buffer.from(bHex, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function getAuthStatus(): {
  configured: boolean;
  needsSetup: boolean;
  source: 'env' | 'claimed' | 'unconfigured';
} {
  if (getEnvAdminPasscode()) {
    return { configured: true, needsSetup: false, source: 'env' };
  }
  try {
    if (readClaimedAdmin()) {
      return { configured: true, needsSetup: false, source: 'claimed' };
    }
    return { configured: false, needsSetup: true, source: 'unconfigured' };
  } catch {
    return { configured: true, needsSetup: false, source: 'claimed' };
  }
}

export function issueSessionToken(): { token: string; expiresAt: string } {
  const exp = Date.now() + TOKEN_TTL_MS;
  const jti = crypto.randomBytes(16).toString('hex');
  const payload = Buffer.from(
    JSON.stringify({ role: 'admin', exp, jti }),
    'utf8',
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');

  return {
    token: `${payload}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

function decodeVerifiedPayload(token: string): { role: string; exp: number; jti: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, providedSig] = parts;
  if (!payload || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');

  const sigBufA = Buffer.from(providedSig, 'utf8');
  const sigBufB = Buffer.from(expectedSig, 'utf8');
  if (sigBufA.length !== sigBufB.length) return null;
  if (!crypto.timingSafeEqual(sigBufA, sigBufB)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
      jti?: string;
    };
    if (
      decoded.role === 'admin' &&
      typeof decoded.exp === 'number' &&
      decoded.exp > Date.now() &&
      typeof decoded.jti === 'string' &&
      decoded.jti.length >= 16
    ) {
      return { role: decoded.role, exp: decoded.exp, jti: decoded.jti };
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const decoded = decodeVerifiedPayload(token);
  if (!decoded) return false;
  const revoked = await isSessionJtiRevoked(decoded.jti);
  return !revoked;
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export async function revokeSessionToken(token: string): Promise<boolean> {
  const decoded = decodeVerifiedPayload(token);
  if (!decoded) return false;
  await revokeSessionJti(decoded.jti, decoded.exp);
  return true;
}

export async function claimInitialAdminPasscode(passcode: string): Promise<{
  ok: boolean;
  error?: string;
  token?: string;
  expiresAt?: string;
}> {
  if (
    typeof passcode !== 'string' ||
    passcode.trim().length < 8 ||
    passcode.length > 128 ||
    new Set(passcode).size < 4
  ) {
    return {
      ok: false,
      error: 'Defina uma senha forte com 8 a 128 caracteres e variedade mínima.',
    };
  }

  return withVaultLock(async () => {
    if (getEnvAdminPasscode()) {
      return {
        ok: false,
        error: 'A senha administrativa já foi configurada neste ambiente.',
      };
    }

    try {
      if (readClaimedAdmin()) {
        return {
          ok: false,
          error: 'A senha administrativa já foi configurada neste ambiente.',
        };
      }
    } catch (err) {
      if (err instanceof VaultCorruptionError) {
        return {
          ok: false,
          error: 'Arquivo de credencial administrativa corrompido. Setup inicial bloqueado por segurança.',
        };
      }
      throw err;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await hashPasscodeAsync(passcode, salt);
    const record: StoredAdminRecord = {
      salt,
      hash,
      createdAt: new Date().toISOString(),
    };

    writeVaultFile(ADMIN_FILE, JSON.stringify(record));
    const session = issueSessionToken();
    return { ok: true, token: session.token, expiresAt: session.expiresAt };
  });
}

export async function authenticateAdminPasscode(passcode: string): Promise<{
  ok: boolean;
  error?: string;
  token?: string;
  expiresAt?: string;
}> {
  if (typeof passcode !== 'string' || passcode.length === 0 || passcode.length > 128) {
    return { ok: false, error: 'Informe a senha de acesso.' };
  }

  if (getEnvAdminPasscode()) {
    const valid = await verifyEnvPasscodeAsync(passcode);
    if (!valid) {
      return { ok: false, error: 'Credenciais inválidas.' };
    }
    const session = issueSessionToken();
    return { ok: true, token: session.token, expiresAt: session.expiresAt };
  }

  let claimed: StoredAdminRecord | null;
  try {
    claimed = readClaimedAdmin();
  } catch {
    return {
      ok: false,
      error: 'Falha de integridade na credencial administrativa armazenada.',
    };
  }

  if (!claimed) {
    return {
      ok: false,
      error: 'Acesso administrativo ainda não inicializado.',
    };
  }

  const derived = await hashPasscodeAsync(passcode, claimed.salt);
  if (!constantTimeCompareHex(derived, claimed.hash)) {
    return { ok: false, error: 'Credenciais inválidas.' };
  }

  const session = issueSessionToken();
  return { ok: true, token: session.token, expiresAt: session.expiresAt };
}

export async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ error: 'Autenticação administrativa obrigatória.' });
      return;
    }

    const valid = await verifySessionToken(token);
    if (!valid) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
