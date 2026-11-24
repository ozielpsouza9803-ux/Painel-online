import {
  checkSharedBurstLimit,
  clearDiskSecurityStateForTests,
  deleteFailureRecord,
  getFailureRecord,
  saveFailureRecord,
  type PersistedFailureRecord,
} from './sharedStore.ts';

export interface RateLimitPolicy {
  bucket: string;
  windowMs: number;
  maxAttemptsBeforeLock: number;
  lockDurationMs: number;
  backoffScheduleMs: number[];
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  reason?: string;
}

const requestBurstStore = new Map<string, { count: number; windowStart: number }>();
const MAX_TRACKED_ENTRIES = 5_000;

function pruneBurstMap(now: number): void {
  if (requestBurstStore.size > MAX_TRACKED_ENTRIES) {
    for (const [k, rec] of requestBurstStore.entries()) {
      if (now - rec.windowStart > 120_000) {
        requestBurstStore.delete(k);
      }
    }
  }
}

export const AUTH_LOGIN_POLICY: RateLimitPolicy = {
  bucket: 'auth_login',
  windowMs: 15 * 60_000,
  maxAttemptsBeforeLock: 5,
  lockDurationMs: 15 * 60_000,
  backoffScheduleMs: [0, 1_000, 3_000, 7_000, 15_000],
};

export const AUTH_SETUP_POLICY: RateLimitPolicy = {
  bucket: 'auth_setup',
  windowMs: 15 * 60_000,
  maxAttemptsBeforeLock: 5,
  lockDurationMs: 15 * 60_000,
  backoffScheduleMs: [0, 1_000, 3_000, 8_000, 15_000],
};

export const VAULT_UNLOCK_POLICY: RateLimitPolicy = {
  bucket: 'vault_unlock',
  windowMs: 15 * 60_000,
  maxAttemptsBeforeLock: 5,
  lockDurationMs: 15 * 60_000,
  backoffScheduleMs: [0, 1_500, 4_000, 10_000, 20_000],
};

export const VAULT_ROTATE_POLICY: RateLimitPolicy = {
  bucket: 'vault_rotate',
  windowMs: 15 * 60_000,
  maxAttemptsBeforeLock: 5,
  lockDurationMs: 15 * 60_000,
  backoffScheduleMs: [0, 2_000, 5_000, 10_000, 20_000],
};

function makeKey(bucket: string, subject: string): string {
  return `${bucket}:${subject}`;
}

export async function checkRateLimit(
  policy: RateLimitPolicy,
  subject: string,
  now = Date.now(),
): Promise<RateLimitCheckResult> {
  const key = makeKey(policy.bucket, subject);
  const rec = await getFailureRecord(key);
  if (!rec) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (now - rec.windowStart > policy.windowMs && rec.blockedUntil <= now) {
    await deleteFailureRecord(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (rec.blockedUntil > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rec.blockedUntil - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `Muitas tentativas inválidas. Aguarde ${retryAfterSeconds}s antes de tentar novamente.`,
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordRateLimitFailure(
  policy: RateLimitPolicy,
  subject: string,
  now = Date.now(),
): Promise<{ blockedUntil: number; retryAfterSeconds: number; failures: number }> {
  const key = makeKey(policy.bucket, subject);
  const existing = await getFailureRecord(key);

  let rec: PersistedFailureRecord;
  if (!existing || now - existing.windowStart > policy.windowMs) {
    rec = {
      failures: 1,
      windowStart: now,
      blockedUntil: 0,
      lastAttemptAt: now,
    };
  } else {
    rec = {
      failures: existing.failures + 1,
      windowStart: existing.windowStart,
      blockedUntil: existing.blockedUntil,
      lastAttemptAt: now,
    };
  }

  if (rec.failures >= policy.maxAttemptsBeforeLock) {
    rec.blockedUntil = now + policy.lockDurationMs;
  } else {
    const idx = Math.min(rec.failures - 1, policy.backoffScheduleMs.length - 1);
    const delayMs = policy.backoffScheduleMs[idx] ?? 0;
    if (delayMs > 0) {
      rec.blockedUntil = Math.max(rec.blockedUntil, now + delayMs);
    }
  }

  const ttlMs = Math.max(policy.windowMs, policy.lockDurationMs) + 60_000;
  await saveFailureRecord(key, rec, ttlMs);

  const retryAfterSeconds =
    rec.blockedUntil > now ? Math.max(1, Math.ceil((rec.blockedUntil - now) / 1000)) : 0;

  return {
    blockedUntil: rec.blockedUntil,
    retryAfterSeconds,
    failures: rec.failures,
  };
}

export async function resetRateLimit(policy: RateLimitPolicy, subject: string): Promise<void> {
  await deleteFailureRecord(makeKey(policy.bucket, subject));
}

export async function checkGeneralApiBurst(
  subject: string,
  limitPerMinute = 240,
  now = Date.now(),
): Promise<RateLimitCheckResult> {
  const sharedRes = await checkSharedBurstLimit(subject, limitPerMinute);
  if (!sharedRes.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: sharedRes.retryAfterSeconds,
      reason: 'Limite de requisições por minuto excedido.',
    };
  }

  pruneBurstMap(now);
  const rec = requestBurstStore.get(subject);
  if (!rec || now - rec.windowStart >= 60_000) {
    requestBurstStore.set(subject, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  rec.count += 1;
  if (rec.count > limitPerMinute) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((60_000 - (now - rec.windowStart)) / 1000),
    );
    return {
      allowed: false,
      retryAfterSeconds,
      reason: 'Limite de requisições por minuto excedido.',
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function clearRateLimitStateForTests(): Promise<void> {
  requestBurstStore.clear();
  await clearDiskSecurityStateForTests();
}
