import fs from 'node:fs';
import path from 'node:path';
import type {
  ProductionReadinessReport,
  ReadinessCheckItem,
} from '../../shared/contracts.ts';
import {
  hasConfiguredSessionSecret,
  hasMinimumSessionSecret,
} from './auth.ts';
import { checkSharedStoreHealth } from './sharedStore.ts';
import {
  detectVaultStorageDiagnostics,
  runStartupVaultIntegrityAudit,
} from './storage.ts';

function validateAllowedOriginsConfig(): { ok: boolean; detail: string } {
  const raw = process.env.AURIX_ALLOWED_ORIGINS?.trim();
  if (!raw) {
    return {
      ok: true,
      detail: 'AURIX_ALLOWED_ORIGINS não definida (aceita apenas APP_URL e origem do host atual).',
    };
  }
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed === '*') {
      return {
        ok: false,
        detail: 'AURIX_ALLOWED_ORIGINS contém wildcard "*" proibido.',
      };
    }
    try {
      const parsed = new URL(trimmed);
      if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        return {
          ok: false,
          detail: `Origem ${parsed.origin} deve usar https:// em produção.`,
        };
      }
    } catch {
      return {
        ok: false,
        detail: 'AURIX_ALLOWED_ORIGINS contém URL malformada.',
      };
    }
  }
  return {
    ok: true,
    detail: 'AURIX_ALLOWED_ORIGINS validada sem wildcards.',
  };
}

function validateVaultSecretConfig(): { status: 'ok' | 'warning' | 'blocker'; detail: string } {
  const raw = process.env.AURIX_VAULT_SECRET;
  if (!raw || raw.trim().length === 0) {
    return {
      status: 'warning',
      detail:
        'AURIX_VAULT_SECRET não definida no ambiente (cofre inicia bloqueado após reinício até desbloqueio manual na UI).',
    };
  }
  if (raw.trim().length < 16 || raw.trim().startsWith('MY_')) {
    return {
      status: 'blocker',
      detail:
        'AURIX_VAULT_SECRET está abaixo de 16 caracteres ou usa valor placeholder.',
    };
  }
  return {
    status: 'ok',
    detail: 'AURIX_VAULT_SECRET configurada no servidor (>= 16 caracteres, sem exibição em logs).',
  };
}

export async function evaluateProductionReadiness(): Promise<ProductionReadinessReport> {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const storage = detectVaultStorageDiagnostics();
  const integrity = runStartupVaultIntegrityAudit();
  const sharedStore = await checkSharedStoreHealth();
  const originsCheck = validateAllowedOriginsConfig();
  const vaultSecretCheck = validateVaultSecretConfig();

  const distIndexExists = fs.existsSync(
    path.resolve(process.cwd(), 'dist', 'index.html'),
  );

  const checks: ReadinessCheckItem[] = [];

  // 1. Node environment & Vite/HMR absence
  checks.push({
    id: 'runtime_mode',
    label: 'Modo de execução sem Vite/HMR',
    status: isProduction && distIndexExists ? 'ok' : isProduction ? 'blocker' : 'warning',
    detail: isProduction
      ? distIndexExists
        ? 'NODE_ENV=production ativo; bundle estático dist/ presente e Vite/HMR desativados.'
        : 'NODE_ENV=production ativo, porém dist/index.html não existe (execute npm run build).'
      : 'Execução atual em desenvolvimento (Vite middleware e HMR ativos; produção requer NODE_ENV=production + dist/).',
  });

  // 2. Session secret
  checks.push({
    id: 'session_secret',
    label: 'AURIX_SESSION_SECRET',
    status: hasConfiguredSessionSecret()
      ? 'ok'
      : hasMinimumSessionSecret()
        ? 'warning'
        : isProduction
          ? 'blocker'
          : 'warning',
    detail: hasConfiguredSessionSecret()
      ? 'AURIX_SESSION_SECRET configurada (>= 32 caracteres).'
      : hasMinimumSessionSecret()
        ? 'AURIX_SESSION_SECRET possui entre 16 e 31 caracteres; recomenda-se >= 32 caracteres.'
        : 'AURIX_SESSION_SECRET ausente: tokens de sessão são invalidados a cada reinício e não compartilham entre réplicas.',
  });

  // 3. Vault storage & persistence
  checks.push({
    id: 'vault_storage',
    label: 'Persistência de .aurix-vault/',
    status: !storage.writable
      ? 'blocker'
      : storage.storageBackend === 'mounted_persistent_volume'
        ? 'ok'
        : 'warning',
    detail: !storage.writable
      ? `Diretório ${storage.vaultDirPath} sem permissão de escrita.`
      : storage.storageBackend === 'mounted_persistent_volume'
        ? `Volume persistente detectado (${storage.filesystemType}) em ${storage.vaultDirPath}.`
        : `Disco em overlay efêmero (${storage.filesystemType}) em ${storage.vaultDirPath}. Monte volume externo e defina AURIX_VAULT_DIR para sobreviver a recriações de container.`,
  });

  // 4. Integrity check
  checks.push({
    id: 'vault_integrity',
    label: 'Integridade do cofre e registros',
    status: integrity.ok ? 'ok' : 'blocker',
    detail: integrity.ok
      ? `${integrity.checkedFiles.length} arquivo(s) verificados com permissão 0600 e JSON íntegro.`
      : integrity.errors.join(' '),
  });

  // 5. Shared store (Redis vs single-instance disk)
  checks.push({
    id: 'shared_store',
    label: 'Revogação & Rate Limit compartilhados',
    status: !sharedStore.healthy
      ? 'blocker'
      : sharedStore.mode === 'redis'
        ? 'ok'
        : 'warning',
    detail: sharedStore.detail,
  });

  // 6. CORS / Allowed origins
  checks.push({
    id: 'allowed_origins',
    label: 'Política de origens (CORS/CSRF)',
    status: originsCheck.ok ? 'ok' : 'blocker',
    detail: originsCheck.detail,
  });

  // 7. Vault secret config
  checks.push({
    id: 'vault_secret_env',
    label: 'Chave mestra de ambiente (AURIX_VAULT_SECRET)',
    status: vaultSecretCheck.status,
    detail: vaultSecretCheck.detail,
  });

  const hasBlocker = checks.some((c) => c.status === 'blocker');
  const readyForSingleInstanceProduction =
    isProduction &&
    distIndexExists &&
    integrity.ok &&
    storage.writable &&
    originsCheck.ok &&
    hasMinimumSessionSecret() &&
    sharedStore.healthy &&
    vaultSecretCheck.status !== 'blocker';

  const readyForMultiInstanceProduction =
    readyForSingleInstanceProduction &&
    !hasBlocker &&
    sharedStore.mode === 'redis' &&
    storage.storageBackend === 'mounted_persistent_volume' &&
    hasConfiguredSessionSecret();

  return {
    readyForMultiInstanceProduction,
    readyForSingleInstanceProduction,
    nodeEnv,
    viteHmrActive: !isProduction,
    sharedStoreMode: sharedStore.mode,
    storage,
    checks,
  };
}
