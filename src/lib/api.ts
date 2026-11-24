import type {
  AgentBlueprint,
  EncryptedVaultBackupBundle,
  ModuleId,
  OperationalModuleContract,
  PermissionScope,
  PlatformOverview,
  ProductionReadinessReport,
  ProviderBlueprint,
  ProviderHttpTestResult,
  ProviderId,
  SecurityAuditEntry,
  TenantApplication,
  VaultEnvironment,
  VaultKeySummary,
  VaultSecurityStatus,
} from '../../shared/contracts.ts';

let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    if (response.status === 401) {
      memoryToken = null;
    }
    throw new Error(payload.error || `Erro HTTP ${response.status}`);
  }
  return payload;
}

export interface AuthStatusResponse {
  configured: boolean;
  needsSetup: boolean;
  source: 'env' | 'claimed' | 'unconfigured';
}

export const aurixApi = {
  getAuthStatus: () => apiRequest<AuthStatusResponse>('/api/auth/status'),
  setupAdmin: (passcode: string) =>
    apiRequest<{ token: string; expiresAt: string }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),
  login: (passcode: string) =>
    apiRequest<{ token: string; expiresAt: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),
  logout: () =>
    apiRequest<{ loggedOut: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),
  getOverview: () => apiRequest<PlatformOverview>('/api/overview'),
  getProviders: () =>
    apiRequest<{
      providers: ProviderBlueprint[];
      vaultPersistenceMode: 'persistent_encrypted' | 'ephemeral_memory';
    }>('/api/providers'),
  getProviderTests: () =>
    apiRequest<{ tests: ProviderHttpTestResult[] }>('/api/providers/tests'),
  testProvider: (
    providerId: ProviderId,
    body: {
      keyId?: string;
      useEnv?: boolean;
      model?: string;
      prompt?: string;
    },
  ) =>
    apiRequest<{ result: ProviderHttpTestResult }>(
      `/api/providers/${encodeURIComponent(providerId)}/test`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  getSecurityStatus: () =>
    apiRequest<{ security: VaultSecurityStatus }>('/api/security/status'),
  unlockVault: (masterKey: string) =>
    apiRequest<{ security: VaultSecurityStatus; migratedCount: number }>(
      '/api/security/unlock',
      {
        method: 'POST',
        body: JSON.stringify({ masterKey }),
      },
    ),
  lockVault: () =>
    apiRequest<{ security: VaultSecurityStatus }>('/api/security/lock', {
      method: 'POST',
    }),
  rotateMasterKey: (currentMasterKey: string, newMasterKey: string) =>
    apiRequest<{ security: VaultSecurityStatus; rotatedRecordsCount: number }>(
      '/api/security/rotate',
      {
        method: 'POST',
        body: JSON.stringify({ currentMasterKey, newMasterKey }),
      },
    ),
  exportVaultBackup: (passphrase: string) =>
    apiRequest<{ bundle: EncryptedVaultBackupBundle }>(
      '/api/security/backup/export',
      {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
      },
    ),
  restoreVaultBackup: (bundle: EncryptedVaultBackupBundle, passphrase: string) =>
    apiRequest<{ restoredCount: number; totalKeys: number; security: VaultSecurityStatus }>(
      '/api/security/backup/restore',
      {
        method: 'POST',
        body: JSON.stringify({ bundle, passphrase }),
      },
    ),
  getSecurityAuditLog: () =>
    apiRequest<{ entries: SecurityAuditEntry[] }>('/api/security/audit'),
  getSecurityReadiness: () =>
    apiRequest<{ readiness: ProductionReadinessReport }>('/api/security/readiness'),
  getVaultKeys: () =>
    apiRequest<{
      keys: VaultKeySummary[];
      vaultPersistenceMode: 'persistent_encrypted' | 'ephemeral_memory';
      vaultSecurity: VaultSecurityStatus;
    }>('/api/vault/keys'),
  registerVaultKey: (body: {
    providerId: ProviderId;
    label: string;
    apiKey: string;
    secondaryCredential?: string;
    scopeAppId: string;
    environment: VaultEnvironment;
  }) =>
    apiRequest<{ key: VaultKeySummary }>('/api/vault/keys', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteVaultKey: (id: string) =>
    apiRequest<{ removed: boolean }>(`/api/vault/keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getAgents: () => apiRequest<{ agents: AgentBlueprint[] }>('/api/agents'),
  createAgent: (body: {
    name: string;
    moduleId: ModuleId;
    roleSummary: string;
    systemPromptTemplate: string;
    preferredProviderId: ProviderId;
    fallbackChain: ProviderId[];
  }) =>
    apiRequest<{ agent: AgentBlueprint }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAgent: (
    id: string,
    patch: {
      preferredProviderId?: ProviderId;
      fallbackChain?: ProviderId[];
      status?: 'blueprint_ready' | 'paused';
      systemPromptTemplate?: string;
    },
  ) =>
    apiRequest<{ agent: AgentBlueprint }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  getModules: () => apiRequest<{ modules: OperationalModuleContract[] }>('/api/modules'),
  getTenants: () => apiRequest<{ tenants: TenantApplication[] }>('/api/tenants'),
  createTenant: (body: {
    name: string;
    description: string;
    allowedProviders: ProviderId[];
    enabledModules: ModuleId[];
    permissions: PermissionScope[];
  }) =>
    apiRequest<{ tenant: TenantApplication }>('/api/tenants', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateTenant: (
    id: string,
    patch: {
      status?: 'isolated_ready' | 'suspended';
      allowedProviders?: ProviderId[];
      enabledModules?: ModuleId[];
      permissions?: PermissionScope[];
    },
  ) =>
    apiRequest<{ tenant: TenantApplication }>(`/api/tenants/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTenant: (id: string) =>
    apiRequest<{ removed: boolean }>(`/api/tenants/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
