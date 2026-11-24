import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ArchitectureLayer,
  PlatformOverview,
  ProviderHttpTestResult,
  ProviderId,
} from './shared/contracts.ts';
import {
  authenticateAdminPasscode,
  claimInitialAdminPasscode,
  extractTokenFromRequest,
  getAuthStatus,
  requireAdminAuth,
  revokeSessionToken,
} from './server/security/auth.ts';
import {
  decryptVaultKeySecret,
  deleteVaultKey,
  exportEncryptedVaultBackup,
  getVaultPersistenceMode,
  getVaultSecurityStatus,
  listVaultKeySummaries,
  lockVaultRuntime,
  recordVaultKeyTestResult,
  registerVaultKey,
  restoreEncryptedVaultBackup,
  rotateVaultMasterKey,
  unlockVaultWithMasterKey,
} from './server/security/vault.ts';
import { KdfOverloadError } from './server/security/cryptoAsync.ts';
import { SharedStoreUnavailableError } from './server/security/sharedStore.ts';
import { evaluateProductionReadiness } from './server/security/readiness.ts';
import {
  AUTH_LOGIN_POLICY,
  AUTH_SETUP_POLICY,
  VAULT_ROTATE_POLICY,
  VAULT_UNLOCK_POLICY,
  checkGeneralApiBurst,
  checkRateLimit,
  recordRateLimitFailure,
  resetRateLimit,
} from './server/security/rateLimit.ts';
import {
  listSecurityAuditEvents,
  recordSecurityAuditEvent,
} from './server/security/auditLog.ts';
import {
  runStartupVaultIntegrityAudit,
  VaultCorruptionError,
  VaultStorageSecurityError,
} from './server/security/storage.ts';
import {
  getEnvCredentialsForProvider,
  getProviderDefinition,
  listProviderBlueprints,
} from './server/providers/registry.ts';
import { executeProviderHttpCall } from './server/providers/httpClient.ts';
import {
  createAgentBlueprint,
  listAgentBlueprints,
  updateAgentBlueprint,
} from './server/core/agentRegistry.ts';
import { listOperationalModules } from './server/core/moduleRegistry.ts';
import {
  createTenantApplication,
  deleteTenantApplication,
  listTenants,
  updateTenantApplication,
} from './server/core/tenantRegistry.ts';
import { evaluateExecutionIsolation } from './server/core/isolation.ts';

const PORT = Number(process.env.PORT || 3000);

const ARCHITECTURE_LAYERS: ArchitectureLayer[] = [
  {
    id: 'layer_presentation',
    order: '01',
    title: 'Painel Administrativo & Governança',
    responsibility: 'Interface operacional em preto e dourado sem armazenamento de segredos ou tokens no browser.',
    components: ['Console React', 'Sessão Bearer em Memória', 'Visualização Mascarada'],
    status: 'implemented_foundation',
  },
  {
    id: 'layer_security',
    order: '02',
    title: 'Gateway Autenticado & Cofre Criptografado',
    responsibility: 'Validação administrativa via scrypt/HMAC com revogação, bloqueio por inatividade e cifragem AES-256-GCM + AAD no servidor.',
    components: ['Auth Guard + Lockout', 'Cofre AES-256-GCM + AAD', 'Backup & Rotação'],
    status: 'implemented_foundation',
  },
  {
    id: 'layer_providers',
    order: '03',
    title: 'Central de Provedores Gratuitos & Roteamento',
    responsibility: 'Contratos estruturais preparados para Gemini, Groq, Cloudflare, OpenRouter e Mistral.',
    components: ['Adapter Gemini', 'Adapter Groq', 'Adapter Cloudflare', 'Adapter OpenRouter', 'Adapter Mistral'],
    status: 'implemented_foundation',
  },
  {
    id: 'layer_orchestrator',
    order: '04',
    title: 'Orquestrador Modular de Agentes & Módulos',
    responsibility: 'Blueprints isolados para Atendimento, Produtos, Preços, Agendamentos e Contingência.',
    components: ['Agent Registry', 'Module Contracts', 'Fallback Chain'],
    status: 'implemented_foundation',
  },
  {
    id: 'layer_tenants',
    order: '05',
    title: 'Isolamento Multiaplicativos & Permissões',
    responsibility: 'Particionamento lógico por aplicativo cliente com namespaces dedicados, matriz RBAC e validação cruzada em execução.',
    components: ['Tenant Registry', 'Namespace Isolation', 'Execution Isolation Guard'],
    status: 'implemented_foundation',
  },
  {
    id: 'layer_runtime',
    order: '06',
    title: 'Integrações HTTP Reais de Provedores (Etapa 2)',
    responsibility: 'Chamadas REST reais com chaves do cofre, timeout controlado, leitura de limites HTTP e mascaramento de metadados sensíveis.',
    components: ['Cliente HTTP Unificado', 'Descriptografia Server-Only', 'Auditoria de Eventos'],
    status: 'implemented_foundation',
  },
];

const PENDING_ROADMAP: string[] = [
  'Implementar a lógica operacional dos 5 módulos (Atendimento, Produtos, Monitoramento de Preços, Agendamentos e Contingência).',
  'Conectar orquestrador de agentes com failover automático usando os adaptadores HTTP reais.',
  'Persistir logs auditáveis de execução e métricas em banco de dados dedicado quando definido.',
  'Habilitar tokens de acesso e webhooks para aplicativos clientes autorizados em etapa posterior.',
];

const recentHttpTests: ProviderHttpTestResult[] = [];

function getClientSubject(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function getRequestForwardedProto(req: Request): string {
  const raw = req.headers['x-forwarded-proto'];
  if (typeof raw === 'string') {
    return raw.split(',')[0].trim().toLowerCase();
  }
  return '';
}

function isRequestHttps(req: Request): boolean {
  return req.secure || getRequestForwardedProto(req) === 'https';
}

function isLoopbackIp(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function getAllowedOriginsSet(req: Request): Set<string> {
  const allowed = new Set<string>([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://localhost:3000',
  ]);

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && /^https?:\/\//i.test(appUrl)) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      // Ignore malformed APP_URL
    }
  }

  const extraOrigins = process.env.AURIX_ALLOWED_ORIGINS?.trim();
  if (extraOrigins) {
    for (const candidate of extraOrigins.split(',')) {
      const trimmed = candidate.trim();
      if (trimmed && /^https?:\/\//i.test(trimmed)) {
        try {
          allowed.add(new URL(trimmed).origin);
        } catch {
          // Ignore malformed entry
        }
      }
    }
  }

  const hostHeader = req.headers.host;
  if (typeof hostHeader === 'string' && /^[a-zA-Z0-9._:-]+$/.test(hostHeader)) {
    const proto = isRequestHttps(req) ? 'https' : 'http';
    allowed.add(`${proto}://${hostHeader}`);
  }

  return allowed;
}

function isBlockedInternalPath(req: Request): boolean {
  let decodedPath = req.path;
  try {
    decodedPath = decodeURIComponent(req.path);
  } catch {
    return true;
  }

  if (req.originalUrl.includes('..') || decodedPath.includes('..')) {
    return true;
  }

  const lower = decodedPath.toLowerCase();
  if (
    lower.includes('/.aurix-vault') ||
    lower.startsWith('/.aurix-vault') ||
    lower.includes('/.env') ||
    lower.startsWith('/.env') ||
    lower.includes('/.git') ||
    lower.startsWith('/server/') ||
    lower === '/server' ||
    lower === '/server.ts' ||
    lower === '/package.json' ||
    lower === '/package-lock.json' ||
    lower === '/tsconfig.json' ||
    lower === '/metadata.json'
  ) {
    return true;
  }

  // Block root-level or nested dotfiles except Vite's own internal cache path under /node_modules/.vite
  if (/\/\.[^/]+/.test(lower) && !lower.startsWith('/node_modules/.vite/')) {
    return true;
  }

  return false;
}

export async function createAurixApp(options?: {
  serveFrontend?: boolean;
}): Promise<express.Express> {
  const isProduction = process.env.NODE_ENV === 'production';
  const serveFrontend = options?.serveFrontend ?? true;

  const app = express();
  app.disable('x-powered-by');
  if (isProduction) {
    app.set('trust proxy', 1);
  }

  // 1. Security Headers + Production HTTPS Enforcement + Blocked Internal Paths
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

    if (isProduction || isRequestHttps(req)) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }

    if (isBlockedInternalPath(req)) {
      res.status(404).json({ error: 'Recurso não encontrado.' });
      return;
    }

    if (isProduction && !isRequestHttps(req)) {
      const allowLoopbackHealth =
        req.path === '/api/health' && isLoopbackIp(req.ip || req.socket.remoteAddress);
      if (!allowLoopbackHealth) {
        res.status(403).json({
          error: 'Conexão HTTPS obrigatória neste ambiente.',
        });
        return;
      }
    }

    if (req.path.startsWith('/api/')) {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private',
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    next();
  });

  // 2. Strict Allowlisted CORS & Origin/Sec-Fetch-Site CSRF Guard for /api/*
  app.use('/api', async (req, res, next) => {
    try {
      const allowedOrigins = getAllowedOriginsSet(req);
      const originHeader = req.headers.origin;
      const secFetchSite = req.headers['sec-fetch-site'];

      if (typeof originHeader === 'string') {
        if (!allowedOrigins.has(originHeader)) {
          res.status(403).json({
            error: 'Origem HTTP não autorizada pela política de isolamento.',
          });
          return;
        }
        res.setHeader('Access-Control-Allow-Origin', originHeader);
        res.setHeader('Vary', 'Origin');
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET, POST, PATCH, DELETE, OPTIONS',
        );
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization',
        );
      }

      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      const isMutating =
        req.method === 'POST' ||
        req.method === 'PUT' ||
        req.method === 'PATCH' ||
        req.method === 'DELETE';

      if (isMutating) {
        if (typeof secFetchSite === 'string' && secFetchSite.toLowerCase() === 'cross-site') {
          res.status(403).json({
            error: 'Requisição cross-site bloqueada pela política CSRF.',
          });
          return;
        }

        const refererHeader = req.headers.referer;
        if (!originHeader && typeof refererHeader === 'string') {
          try {
            const refOrigin = new URL(refererHeader).origin;
            if (!allowedOrigins.has(refOrigin)) {
              res.status(403).json({
                error: 'Referer não autorizado pela política CSRF.',
              });
              return;
            }
          } catch {
            res.status(403).json({ error: 'Cabeçalho Referer inválido.' });
            return;
          }
        }
      }

      if (req.path !== '/health') {
        const burstCheck = await checkGeneralApiBurst(getClientSubject(req));
        if (!burstCheck.allowed) {
          res.setHeader('Retry-After', String(burstCheck.retryAfterSeconds));
          res.status(429).json({ error: burstCheck.reason });
          return;
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/auth/status', (_req, res) => {
    res.json(getAuthStatus());
  });

  app.post('/api/auth/setup', async (req, res, next) => {
    try {
      const subject = getClientSubject(req);
      const limitCheck = await checkRateLimit(AUTH_SETUP_POLICY, subject);
      if (!limitCheck.allowed) {
        res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds));
        await recordSecurityAuditEvent(
          'auth_setup',
          'blocked',
          `Bloqueado por excesso de tentativas (${subject})`,
        );
        res.status(429).json({ error: limitCheck.reason });
        return;
      }

      const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
      const result = await claimInitialAdminPasscode(passcode);
      if (!result.ok) {
        const failure = await recordRateLimitFailure(AUTH_SETUP_POLICY, subject);
        await recordSecurityAuditEvent(
          'auth_setup',
          'blocked',
          `Tentativa rejeitada no setup inicial (falha #${failure.failures})`,
        );
        res.status(400).json({ error: result.error });
        return;
      }

      await resetRateLimit(AUTH_SETUP_POLICY, subject);
      await recordSecurityAuditEvent(
        'auth_setup',
        'ok',
        'Credencial administrativa inicial configurada.',
      );
      res.status(201).json({ token: result.token, expiresAt: result.expiresAt });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const subject = getClientSubject(req);
      const limitCheck = await checkRateLimit(AUTH_LOGIN_POLICY, subject);
      if (!limitCheck.allowed) {
        res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds));
        await recordSecurityAuditEvent(
          'auth_login',
          'blocked',
          `Login bloqueado temporariamente por força bruta (${subject})`,
        );
        res.status(429).json({ error: limitCheck.reason });
        return;
      }

      const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
      const result = await authenticateAdminPasscode(passcode);
      if (!result.ok) {
        const failure = await recordRateLimitFailure(AUTH_LOGIN_POLICY, subject);
        if (failure.retryAfterSeconds > 0) {
          res.setHeader('Retry-After', String(failure.retryAfterSeconds));
        }
        await recordSecurityAuditEvent(
          'auth_login',
          'blocked',
          `Credenciais inválidas no login (falha #${failure.failures})`,
        );
        res.status(401).json({ error: result.error });
        return;
      }

      await resetRateLimit(AUTH_LOGIN_POLICY, subject);
      await recordSecurityAuditEvent('auth_login', 'ok', 'Sessão administrativa autenticada.');
      res.json({ token: result.token, expiresAt: result.expiresAt });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', requireAdminAuth, async (req, res, next) => {
    try {
      const token = extractTokenFromRequest(req);
      if (token) {
        await revokeSessionToken(token);
      }
      await recordSecurityAuditEvent('auth_logout', 'ok', 'Token de sessão revogado no servidor.');
      res.json({ loggedOut: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/overview', requireAdminAuth, (_req, res, next) => {
    try {
      const providers = listProviderBlueprints();
      const vaultSecurity = getVaultSecurityStatus();
      const keys =
        vaultSecurity.integrityStatus === 'ok' ? listVaultKeySummaries() : [];
      const agents = listAgentBlueprints();
      const modules = listOperationalModules();
      const tenants = listTenants();

      const overview: PlatformOverview = {
        platformName: 'AURIX AI',
        stage: 'Etapa 2 — Integrações HTTP Reais de Provedores',
        vaultPersistenceMode: getVaultPersistenceMode(),
        vaultSecurity,
        counts: {
          providersPrepared: providers.length,
          keysStored: keys.length,
          agentsModular: agents.length,
          modulesPrepared: modules.length,
          isolatedApps: tenants.length,
        },
        architectureLayers: ARCHITECTURE_LAYERS,
        pendingRoadmap: PENDING_ROADMAP,
      };

      res.json(overview);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/security/status', requireAdminAuth, (_req, res) => {
    res.json({ security: getVaultSecurityStatus() });
  });

  app.get('/api/security/readiness', requireAdminAuth, async (_req, res, next) => {
    try {
      const readiness = await evaluateProductionReadiness();
      res.json({ readiness });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/security/audit', requireAdminAuth, (_req, res) => {
    res.json({ entries: listSecurityAuditEvents(60) });
  });

  app.post('/api/security/unlock', requireAdminAuth, async (req, res, next) => {
    try {
      const subject = getClientSubject(req);
      const limitCheck = await checkRateLimit(VAULT_UNLOCK_POLICY, subject);
      if (!limitCheck.allowed) {
        res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds));
        await recordSecurityAuditEvent(
          'vault_unlock',
          'blocked',
          `Desbloqueio do cofre bloqueado temporariamente (${subject})`,
        );
        res.status(429).json({ error: limitCheck.reason });
        return;
      }

      const masterKey = typeof req.body?.masterKey === 'string' ? req.body.masterKey : '';
      const result = await unlockVaultWithMasterKey(masterKey);
      if (!result.ok) {
        if (result.httpCode === 401) {
          const failure = await recordRateLimitFailure(VAULT_UNLOCK_POLICY, subject);
          if (failure.retryAfterSeconds > 0) {
            res.setHeader('Retry-After', String(failure.retryAfterSeconds));
          }
          await recordSecurityAuditEvent(
            'vault_unlock',
            'blocked',
            `Chave mestra incorreta no desbloqueio (falha #${failure.failures})`,
          );
        }
        res.status(result.httpCode).json({ error: result.error });
        return;
      }

      await resetRateLimit(VAULT_UNLOCK_POLICY, subject);
      await recordSecurityAuditEvent(
        'vault_unlock',
        'ok',
        `Cofre desbloqueado (registros migrados: ${result.migratedCount}).`,
      );
      res.json({
        security: result.status,
        migratedCount: result.migratedCount,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/security/lock', requireAdminAuth, async (_req, res) => {
    const result = lockVaultRuntime();
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    recentHttpTests.length = 0;
    await recordSecurityAuditEvent(
      'vault_lock',
      'ok',
      'Cofre bloqueado manualmente e chave em memória zerada.',
    );
    res.json({ security: result.status });
  });

  app.post('/api/security/rotate', requireAdminAuth, async (req, res, next) => {
    try {
      const subject = getClientSubject(req);
      const limitCheck = await checkRateLimit(VAULT_ROTATE_POLICY, subject);
      if (!limitCheck.allowed) {
        res.setHeader('Retry-After', String(limitCheck.retryAfterSeconds));
        res.status(429).json({ error: limitCheck.reason });
        return;
      }

      const result = await rotateVaultMasterKey(
        req.body?.currentMasterKey,
        req.body?.newMasterKey,
      );
      if (!result.ok) {
        if (result.httpCode === 401) {
          const failure = await recordRateLimitFailure(VAULT_ROTATE_POLICY, subject);
          if (failure.retryAfterSeconds > 0) {
            res.setHeader('Retry-After', String(failure.retryAfterSeconds));
          }
          await recordSecurityAuditEvent(
            'vault_rotate',
            'blocked',
            `Falha de autenticação ao rotacionar chave mestra (falha #${failure.failures})`,
          );
        }
        res.status(result.httpCode).json({ error: result.error });
        return;
      }

      await resetRateLimit(VAULT_ROTATE_POLICY, subject);
      await recordSecurityAuditEvent(
        'vault_rotate',
        'ok',
        `Chave mestra rotacionada com re-cifragem de ${result.rotatedRecordsCount} registro(s).`,
      );
      res.json({
        security: result.status,
        rotatedRecordsCount: result.rotatedRecordsCount,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/security/backup/export', requireAdminAuth, async (req, res, next) => {
    try {
      const result = await exportEncryptedVaultBackup(req.body?.passphrase);
      if (!result.ok) {
        res.status(result.httpCode).json({ error: result.error });
        return;
      }
      await recordSecurityAuditEvent(
        'vault_backup_export',
        'ok',
        `Backup cifrado exportado (${result.bundle.recordCount} registro(s)).`,
      );
      res.json({ bundle: result.bundle });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/security/backup/restore', requireAdminAuth, async (req, res, next) => {
    try {
      const result = await restoreEncryptedVaultBackup(
        req.body?.bundle,
        req.body?.passphrase,
      );
      if (!result.ok) {
        await recordSecurityAuditEvent(
          'vault_backup_restore',
          'blocked',
          `Restauração de backup rejeitada: ${result.error}`,
        );
        res.status(result.httpCode).json({ error: result.error });
        return;
      }
      await recordSecurityAuditEvent(
        'vault_backup_restore',
        'ok',
        `Backup restaurado (${result.restoredCount} registro(s) importado(s)).`,
      );
      res.json({
        restoredCount: result.restoredCount,
        totalKeys: result.totalKeys,
        security: result.status,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/security/isolation/verify', requireAdminAuth, (req, res, next) => {
    try {
      const providerId = req.body?.providerId as ProviderId;
      if (!getProviderDefinition(providerId)) {
        res.status(400).json({ error: 'Provedor inválido.' });
        return;
      }
      const evaluation = evaluateExecutionIsolation({
        tenantId: typeof req.body?.tenantId === 'string' ? req.body.tenantId : undefined,
        agentId: typeof req.body?.agentId === 'string' ? req.body.agentId : undefined,
        providerId,
        keyId: typeof req.body?.keyId === 'string' ? req.body.keyId : undefined,
      });
      res.status(evaluation.httpCode).json(evaluation);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/providers', requireAdminAuth, (_req, res, next) => {
    try {
      res.json({
        providers: listProviderBlueprints(),
        vaultPersistenceMode: getVaultPersistenceMode(),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/providers/tests', requireAdminAuth, (_req, res) => {
    const sec = getVaultSecurityStatus();
    if (sec.lockState === 'locked') {
      res.json({ tests: [] });
      return;
    }
    res.json({ tests: recentHttpTests });
  });

  app.post('/api/providers/:providerId/test', requireAdminAuth, async (req, res, next) => {
    try {
      const sec = getVaultSecurityStatus();
      if (sec.integrityStatus === 'corrupted') {
        res.status(500).json({
          error: sec.integrityError || 'Falha de integridade no cofre.',
        });
        return;
      }
      if (sec.lockState === 'locked') {
        await recordSecurityAuditEvent(
          'provider_http_test',
          'blocked',
          `Teste bloqueado porque o cofre está trancado (${req.params.providerId}).`,
        );
        res.status(423).json({
          error:
            'Cofre bloqueado. Desbloqueie com a chave mestra em "Segurança e Cofre" antes de executar testes de provedores.',
        });
        return;
      }

      const providerId = req.params.providerId as ProviderId;
      const providerDef = getProviderDefinition(providerId);
      if (!providerDef) {
        res.status(400).json({ error: 'Provedor não suportado.' });
        return;
      }

      const keyId =
        typeof req.body?.keyId === 'string' && req.body.keyId.trim()
          ? req.body.keyId.trim()
          : null;
      const useEnv = req.body?.useEnv === true;
      const tenantId =
        typeof req.body?.tenantId === 'string' && req.body.tenantId.trim()
          ? req.body.tenantId.trim()
          : undefined;
      const agentId =
        typeof req.body?.agentId === 'string' && req.body.agentId.trim()
          ? req.body.agentId.trim()
          : undefined;

      const isolation = evaluateExecutionIsolation({
        tenantId,
        agentId,
        providerId,
        keyId,
      });
      if (!isolation.allowed) {
        await recordSecurityAuditEvent(
          'isolation_denied',
          'blocked',
          isolation.reason || 'Violação de isolamento multiaplicativo bloqueada.',
        );
        res.status(isolation.httpCode).json({ error: isolation.reason });
        return;
      }

      const requestedModel =
        typeof req.body?.model === 'string' && req.body.model.trim()
          ? req.body.model.trim()
          : providerDef.recommendedModels[0];
      const prompt =
        typeof req.body?.prompt === 'string' && req.body.prompt.trim()
          ? req.body.prompt.trim().slice(0, 400)
          : 'Responda exatamente com: AURIX_HTTP_OK';
      const timeoutMs =
        typeof req.body?.timeoutMs === 'number' && Number.isFinite(req.body.timeoutMs)
          ? req.body.timeoutMs
          : undefined;

      let apiKey = '';
      let secondaryCredential: string | undefined;
      let keyLabel = '';
      let keySource: 'vault' | 'env' = 'vault';

      if (keyId) {
        const decrypted = decryptVaultKeySecret(keyId);
        if (!decrypted) {
          res.status(404).json({
            error: 'Chave não encontrada no cofre ou não pôde ser descriptografada.',
          });
          return;
        }
        if (decrypted.providerId !== providerId) {
          res.status(400).json({ error: 'A chave selecionada pertence a outro provedor.' });
          return;
        }
        apiKey = decrypted.apiKey;
        secondaryCredential = decrypted.secondaryCredential;
        keyLabel = decrypted.label;
        keySource = 'vault';
      } else if (useEnv) {
        const envCreds = getEnvCredentialsForProvider(providerId);
        if (!envCreds) {
          res.status(400).json({
            error: `Variável de servidor ${providerDef.envVarName} não configurada ou inválida.`,
          });
          return;
        }
        apiKey = envCreds.apiKey;
        secondaryCredential = envCreds.secondaryCredential;
        keyLabel = `ENV (${providerDef.envVarName})`;
        keySource = 'env';
      } else {
        res.status(400).json({
          error:
            'Selecione uma chave cadastrada no cofre ou uma variável de ambiente configurada no servidor.',
        });
        return;
      }

      const result = await executeProviderHttpCall({
        providerId,
        apiKey,
        secondaryCredential,
        keyId,
        keyLabel,
        keySource,
        model: requestedModel,
        prompt,
        timeoutMs,
      });

      if (keyId) {
        const nextStatus = result.ok
          ? 'verified_ok'
          : result.errorCategory === 'rate_limit'
            ? 'rate_limited'
            : 'verification_failed';
        const statusNote = result.ok
          ? `HTTP ${result.httpStatus} em ${result.latencyMs}ms (${result.model})`
          : `HTTP ${result.httpStatus ?? 'N/A'} (${result.errorCategory}): ${result.errorDetail ?? 'Falha'}`;

        await recordVaultKeyTestResult(keyId, {
          status: nextStatus,
          statusNote: statusNote.slice(0, 180),
          lastHttpStatus: result.httpStatus,
          lastTestedAt: result.testedAt,
          lastModelTested: result.model,
        });
      }

      recentHttpTests.unshift(result);
      if (recentHttpTests.length > 50) {
        recentHttpTests.length = 50;
      }

      await recordSecurityAuditEvent(
        'provider_http_test',
        result.ok ? 'ok' : 'error',
        `Provedor ${providerId} (${keySource}) respondeu HTTP ${result.httpStatus ?? 'N/A'}.`,
      );

      res.json({ result });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/vault/keys', requireAdminAuth, (_req, res, next) => {
    try {
      const vaultSecurity = getVaultSecurityStatus();
      if (vaultSecurity.integrityStatus === 'corrupted') {
        res.status(500).json({
          error:
            vaultSecurity.integrityError ||
            'Falha de integridade nos arquivos do cofre.',
        });
        return;
      }
      res.json({
        keys: listVaultKeySummaries(),
        vaultPersistenceMode: getVaultPersistenceMode(),
        vaultSecurity,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/vault/keys', requireAdminAuth, async (req, res, next) => {
    try {
      const result = await registerVaultKey({
        providerId: req.body?.providerId,
        label: req.body?.label,
        apiKey: req.body?.apiKey,
        secondaryCredential: req.body?.secondaryCredential,
        scopeAppId: req.body?.scopeAppId,
        environment: req.body?.environment,
      });
      if (!result.ok) {
        const status =
          result.reason === 'locked'
            ? 423
            : result.reason === 'corrupted'
              ? 500
              : 400;
        await recordSecurityAuditEvent(
          'vault_key_register',
          'blocked',
          result.error,
        );
        res.status(status).json({ error: result.error });
        return;
      }

      await recordSecurityAuditEvent(
        'vault_key_register',
        'ok',
        `Credencial ${result.summary.id} (${result.summary.providerId}, escopo ${result.summary.scopeAppId}) armazenada.`,
      );
      res.status(201).json({ key: result.summary });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/vault/keys/:id', requireAdminAuth, async (req, res, next) => {
    try {
      const removed = await deleteVaultKey(req.params.id);
      if (!removed.ok) {
        if (removed.reason === 'locked') {
          res.status(423).json({
            error:
              'Cofre bloqueado. Desbloqueie com a chave mestra antes de remover registros.',
          });
          return;
        }
        if (removed.reason === 'corrupted') {
          res.status(500).json({
            error: removed.error || 'Arquivo do cofre corrompido.',
          });
          return;
        }
        res.status(404).json({ error: 'Chave não encontrada.' });
        return;
      }
      await recordSecurityAuditEvent(
        'vault_key_delete',
        'ok',
        `Credencial ${req.params.id} removida do cofre.`,
      );
      res.json({ removed: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/agents', requireAdminAuth, (_req, res, next) => {
    try {
      res.json({ agents: listAgentBlueprints() });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/agents', requireAdminAuth, async (req, res, next) => {
    try {
      const result = await createAgentBlueprint({
        name: req.body?.name,
        moduleId: req.body?.moduleId,
        roleSummary: req.body?.roleSummary,
        systemPromptTemplate: req.body?.systemPromptTemplate,
        preferredProviderId: req.body?.preferredProviderId,
        fallbackChain: req.body?.fallbackChain,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      await recordSecurityAuditEvent(
        'agent_create',
        'ok',
        `Agente ${result.agent.id} (${result.agent.moduleId}) registrado.`,
      );
      res.status(201).json({ agent: result.agent });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/agents/:id', requireAdminAuth, async (req, res, next) => {
    try {
      const result = await updateAgentBlueprint(req.params.id, {
        preferredProviderId: req.body?.preferredProviderId,
        fallbackChain: req.body?.fallbackChain,
        status: req.body?.status,
        systemPromptTemplate: req.body?.systemPromptTemplate,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      await recordSecurityAuditEvent(
        'agent_update',
        'ok',
        `Agente ${result.agent.id} atualizado (status ${result.agent.status}).`,
      );
      res.json({ agent: result.agent });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/modules', requireAdminAuth, (_req, res) => {
    res.json({ modules: listOperationalModules() });
  });

  app.get('/api/tenants', requireAdminAuth, (_req, res, next) => {
    try {
      res.json({ tenants: listTenants() });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/tenants', requireAdminAuth, async (req, res, next) => {
    try {
      const result = await createTenantApplication({
        name: req.body?.name,
        description: req.body?.description,
        allowedProviders: req.body?.allowedProviders,
        enabledModules: req.body?.enabledModules,
        permissions: req.body?.permissions,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      await recordSecurityAuditEvent(
        'tenant_create',
        'ok',
        `Aplicativo isolado ${result.tenant.id} (${result.tenant.isolationNamespace}) criado.`,
      );
      res.status(201).json({ tenant: result.tenant });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/tenants/:id', requireAdminAuth, async (req, res, next) => {
    try {
      const result = await updateTenantApplication(req.params.id, {
        status: req.body?.status,
        allowedProviders: req.body?.allowedProviders,
        enabledModules: req.body?.enabledModules,
        permissions: req.body?.permissions,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      await recordSecurityAuditEvent(
        'tenant_update',
        'ok',
        `Política do aplicativo ${result.tenant.id} atualizada (${result.tenant.status}).`,
      );
      res.json({ tenant: result.tenant });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/tenants/:id', requireAdminAuth, async (req, res, next) => {
    try {
      const removed = await deleteTenantApplication(req.params.id);
      if (!removed) {
        res.status(404).json({ error: 'Aplicativo não encontrado.' });
        return;
      }
      await recordSecurityAuditEvent(
        'tenant_delete',
        'ok',
        `Aplicativo ${req.params.id} removido do registro.`,
      );
      res.json({ removed: true });
    } catch (err) {
      next(err);
    }
  });

  // Catch unmatched /api/* with clean 404 JSON
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint de API não encontrado.' });
  });

  if (serveFrontend) {
    if (!isProduction) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distDir = path.resolve(process.cwd(), 'dist');
      const distIndex = path.join(distDir, 'index.html');
      if (!fs.existsSync(distIndex)) {
        throw new Error(
          'Bundle de produção dist/index.html ausente. Execute npm run build antes de iniciar em produção.',
        );
      }
      app.use(express.static(distDir, { dotfiles: 'deny' }));
      app.get('*', (_req, res) => {
        res.sendFile(distIndex);
      });
    }
  }

  // Global JSON error handler (prevents HTML stack traces & path leakage)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Payload JSON malformado.' });
      return;
    }
    if (err instanceof KdfOverloadError) {
      res.status(err.httpCode).json({ error: err.message });
      return;
    }
    if (err instanceof SharedStoreUnavailableError) {
      res.status(err.httpCode).json({ error: err.message });
      return;
    }
    if (err instanceof VaultCorruptionError) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (err instanceof VaultStorageSecurityError) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Erro interno ao processar requisição.' });
  });

  // Startup integrity & configuration readiness checks (fail-closed when strict env flags are enabled)
  const startupAudit = runStartupVaultIntegrityAudit();
  const readiness = await evaluateProductionReadiness();

  if (
    process.env.AURIX_REQUIRE_PERSISTENT_VOLUME === 'true' &&
    readiness.storage.storageBackend !== 'mounted_persistent_volume'
  ) {
    throw new Error(
      `AURIX_REQUIRE_PERSISTENT_VOLUME=true, porém ${readiness.storage.vaultDirPath} está em ${readiness.storage.filesystemType}.`,
    );
  }
  if (
    process.env.AURIX_STRICT_PRODUCTION === 'true' &&
    !readiness.readyForSingleInstanceProduction
  ) {
    const blockers = readiness.checks
      .filter((c) => c.status === 'blocker')
      .map((c) => c.id)
      .join(', ');
    throw new Error(
      `AURIX_STRICT_PRODUCTION=true abortado por bloqueadores de prontidão: ${blockers || 'configuração incompleta'}.`,
    );
  }
  if (!startupAudit.ok) {
    console.warn(
      `AURIX AI startup integrity warning: ${startupAudit.errors.length} issue(s) detected; write operations locked fail-closed.`,
    );
  }

  return app;
}

async function startServer(): Promise<void> {
  const app = await createAurixApp({ serveFrontend: true });
  const readiness = await evaluateProductionReadiness();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `AURIX AI server listening on port ${PORT} [env=${readiness.nodeEnv}, store=${readiness.sharedStoreMode}, storage=${readiness.storage.storageBackend}]`,
    );
  });
}

if (process.env.AURIX_SKIP_LISTEN !== '1') {
  startServer().catch((err) => {
    console.error('Failed to start AURIX AI server:', err instanceof Error ? err.message : 'startup error');
    process.exit(1);
  });
}
