import crypto from 'node:crypto';
import type { SecurityAuditEntry } from '../../shared/contracts.ts';
import { readVaultFile, withVaultLock, writeVaultFile } from './storage.ts';

const AUDIT_FILE = 'security-audit.log.json';
const MAX_AUDIT_ENTRIES = 200;

function sanitizeDetail(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(AIza[0-9A-Za-z_-]{10,}|gsk_[0-9A-Za-z_-]{10,}|sk-[0-9A-Za-z_-]{10,})/g, '[REDACTED]')
    .slice(0, 220);
}

function readAuditEntries(): SecurityAuditEntry[] {
  try {
    const raw = readVaultFile(AUDIT_FILE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SecurityAuditEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function recordSecurityAuditEvent(
  event: string,
  outcome: SecurityAuditEntry['outcome'],
  detail: string,
): Promise<void> {
  const entry: SecurityAuditEntry = {
    id: `aud_${crypto.randomBytes(5).toString('hex')}`,
    timestamp: new Date().toISOString(),
    event: event.slice(0, 64),
    outcome,
    detail: sanitizeDetail(detail),
  };

  try {
    await withVaultLock(() => {
      const existing = readAuditEntries();
      existing.unshift(entry);
      if (existing.length > MAX_AUDIT_ENTRIES) {
        existing.length = MAX_AUDIT_ENTRIES;
      }
      writeVaultFile(AUDIT_FILE, JSON.stringify(existing));
    });
  } catch {
    // Audit persistence failure must not crash callers or leak details.
  }
}

export function listSecurityAuditEvents(limit = 50): SecurityAuditEntry[] {
  const entries = readAuditEntries();
  return entries.slice(0, Math.min(Math.max(limit, 1), MAX_AUDIT_ENTRIES));
}
