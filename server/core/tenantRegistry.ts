import crypto from 'node:crypto';
import type {
  ModuleId,
  PermissionScope,
  ProviderId,
  TenantApplication,
} from '../../shared/contracts.ts';
import {
  readVaultFile,
  VaultCorruptionError,
  withVaultLock,
  writeVaultFile,
} from '../security/storage.ts';

const TENANTS_FILE = 'tenants-registry.json';

const VALID_PROVIDERS: ReadonlySet<ProviderId> = new Set([
  'gemini',
  'groq',
  'cloudflare',
  'openrouter',
  'mistral',
]);

const VALID_MODULES: ReadonlySet<ModuleId> = new Set([
  'atendimento',
  'produtos',
  'monitoramento_precos',
  'agendamentos',
  'contingencia',
]);

const VALID_PERMISSIONS: ReadonlySet<PermissionScope> = new Set([
  'agents:invoke',
  'agents:configure',
  'vault:read_meta',
  'module:atendimento',
  'module:produtos',
  'module:monitoramento_precos',
  'module:agendamentos',
  'module:contingencia',
]);

function loadTenantsStrict(): TenantApplication[] {
  const raw = readVaultFile(TENANTS_FILE);
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VaultCorruptionError(
      TENANTS_FILE,
      'Registro de aplicativos (tenants-registry.json) corrompido. Escrita bloqueada.',
    );
  }
  if (!Array.isArray(parsed)) {
    throw new VaultCorruptionError(
      TENANTS_FILE,
      'Estrutura do registro de aplicativos inválida.',
    );
  }
  return parsed as TenantApplication[];
}

function saveTenants(tenants: TenantApplication[]): void {
  writeVaultFile(TENANTS_FILE, JSON.stringify(tenants));
}

function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function listTenants(): TenantApplication[] {
  return loadTenantsStrict();
}

export function getTenantById(id: string): TenantApplication | null {
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id)) {
    return null;
  }
  return loadTenantsStrict().find((t) => t.id === id) ?? null;
}

export function hasTenantId(id: string): boolean {
  return getTenantById(id) !== null;
}

export async function createTenantApplication(input: {
  name: unknown;
  description: unknown;
  allowedProviders?: unknown;
  enabledModules?: unknown;
  permissions?: unknown;
}): Promise<{ ok: true; tenant: TenantApplication } | { ok: false; error: string }> {
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 60) {
    return { ok: false, error: 'Informe um nome entre 2 e 60 caracteres.' };
  }
  if (typeof input.description !== 'string' || input.description.trim().length < 4 || input.description.trim().length > 200) {
    return { ok: false, error: 'Informe uma descrição entre 4 e 200 caracteres.' };
  }

  const trimmedName = input.name.trim();
  const trimmedDescription = input.description.trim();

  const slug = normalizeSlug(trimmedName);
  if (!slug || slug.length < 2) {
    return { ok: false, error: 'Não foi possível gerar um identificador válido para o aplicativo.' };
  }

  return withVaultLock(() => {
    const existing = loadTenantsStrict();
    if (existing.some((t) => t.slug === slug)) {
      return { ok: false, error: 'Já existe um aplicativo registrado com esse identificador.' };
    }

    const allowedProviders: ProviderId[] = Array.isArray(input.allowedProviders)
      ? input.allowedProviders.filter(
          (p): p is ProviderId => typeof p === 'string' && VALID_PROVIDERS.has(p as ProviderId),
        )
      : ['gemini'];

    const enabledModules: ModuleId[] = Array.isArray(input.enabledModules)
      ? input.enabledModules.filter(
          (m): m is ModuleId => typeof m === 'string' && VALID_MODULES.has(m as ModuleId),
        )
      : ['atendimento', 'contingencia'];

    const permissions: PermissionScope[] = Array.isArray(input.permissions)
      ? input.permissions.filter(
          (perm): perm is PermissionScope =>
            typeof perm === 'string' && VALID_PERMISSIONS.has(perm as PermissionScope),
        )
      : ['agents:invoke', 'module:atendimento', 'module:contingencia'];

    const idSuffix = crypto.randomBytes(4).toString('hex');
    const now = new Date().toISOString();

    const tenant: TenantApplication = {
      id: `app_${idSuffix}`,
      name: trimmedName,
      slug,
      description: trimmedDescription,
      isolationNamespace: `ns_${slug}_${idSuffix}`,
      dataPartitionKey: `part_${crypto.randomBytes(6).toString('hex')}`,
      status: 'isolated_ready',
      allowedProviders,
      enabledModules,
      permissions,
      createdAt: now,
      updatedAt: now,
    };

    existing.unshift(tenant);
    saveTenants(existing);

    return { ok: true, tenant };
  });
}

export async function updateTenantApplication(
  id: string,
  patch: {
    status?: unknown;
    allowedProviders?: unknown;
    enabledModules?: unknown;
    permissions?: unknown;
  },
): Promise<{ ok: true; tenant: TenantApplication } | { ok: false; error: string }> {
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
    return { ok: false, error: 'Identificador de aplicativo inválido.' };
  }

  return withVaultLock(() => {
    const tenants = loadTenantsStrict();
    const idx = tenants.findIndex((t) => t.id === id);
    if (idx === -1) {
      return { ok: false, error: 'Aplicativo não encontrado.' };
    }

    const current = tenants[idx];
    let status = current.status;
    if (patch.status !== undefined) {
      if (patch.status !== 'isolated_ready' && patch.status !== 'suspended') {
        return { ok: false, error: 'Status inválido.' };
      }
      status = patch.status;
    }

    const allowedProviders = Array.isArray(patch.allowedProviders)
      ? patch.allowedProviders.filter(
          (p): p is ProviderId => typeof p === 'string' && VALID_PROVIDERS.has(p as ProviderId),
        )
      : current.allowedProviders;

    const enabledModules = Array.isArray(patch.enabledModules)
      ? patch.enabledModules.filter(
          (m): m is ModuleId => typeof m === 'string' && VALID_MODULES.has(m as ModuleId),
        )
      : current.enabledModules;

    const permissions = Array.isArray(patch.permissions)
      ? patch.permissions.filter(
          (perm): perm is PermissionScope =>
            typeof perm === 'string' && VALID_PERMISSIONS.has(perm as PermissionScope),
        )
      : current.permissions;

    const updated: TenantApplication = {
      ...current,
      status,
      allowedProviders,
      enabledModules,
      permissions,
      updatedAt: new Date().toISOString(),
    };

    tenants[idx] = updated;
    saveTenants(tenants);
    return { ok: true, tenant: updated };
  });
}

export async function deleteTenantApplication(id: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
    return false;
  }
  return withVaultLock(() => {
    const tenants = loadTenantsStrict();
    const next = tenants.filter((t) => t.id !== id);
    if (next.length === tenants.length) {
      return false;
    }
    saveTenants(next);
    return true;
  });
}
