export type ProviderId =
  | 'gemini'
  | 'groq'
  | 'cloudflare'
  | 'openrouter'
  | 'mistral';

export type ModuleId =
  | 'atendimento'
  | 'produtos'
  | 'monitoramento_precos'
  | 'agendamentos'
  | 'contingencia';

export type PermissionScope =
  | 'agents:invoke'
  | 'agents:configure'
  | 'vault:read_meta'
  | 'module:atendimento'
  | 'module:produtos'
  | 'module:monitoramento_precos'
  | 'module:agendamentos'
  | 'module:contingencia';

export type VaultEnvironment = 'development' | 'staging' | 'production';

export interface ProviderFieldSpec {
  key: 'apiKey' | 'secondaryCredential' | 'baseUrlOverride';
  label: string;
  required: boolean;
  sensitive: boolean;
  placeholder: string;
}

export interface ProviderBlueprint {
  id: ProviderId;
  name: string;
  vendor: string;
  adapterStatus: 'http_ready_stage_2';
  freeTierSummary: string;
  capabilities: string[];
  recommendedModels: string[];
  requiredFields: ProviderFieldSpec[];
  envVarName: string;
  envConfigured: boolean;
  registeredKeyCount: number;
  endpointSummary: string;
}

export type VaultKeyVerificationStatus =
  | 'stored_unverified'
  | 'verified_ok'
  | 'verification_failed'
  | 'rate_limited';

export interface VaultKeySummary {
  id: string;
  providerId: ProviderId;
  label: string;
  maskedPreview: string;
  hasSecondaryCredential: boolean;
  scopeAppId: string;
  environment: VaultEnvironment;
  status: VaultKeyVerificationStatus;
  statusNote: string;
  decryptable?: boolean;
  lastHttpStatus: number | null;
  lastTestedAt: string | null;
  lastModelTested: string | null;
  createdAt: string;
}

export type HttpTestErrorCategory =
  | 'none'
  | 'auth_error'
  | 'rate_limit'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'bad_request'
  | 'provider_error';

export interface ProviderHttpTestResult {
  id: string;
  providerId: ProviderId;
  keyId: string | null;
  keyLabel: string;
  keySource: 'vault' | 'env';
  endpointUrl: string;
  model: string;
  ok: boolean;
  httpStatus: number | null;
  httpStatusText: string;
  latencyMs: number;
  errorCategory: HttpTestErrorCategory;
  responsePreview: string | null;
  errorDetail: string | null;
  rateLimitInfo: Record<string, string>;
  testedAt: string;
}

export interface AgentBlueprint {
  id: string;
  name: string;
  slug: string;
  moduleId: ModuleId;
  roleSummary: string;
  systemPromptTemplate: string;
  preferredProviderId: ProviderId;
  fallbackChain: ProviderId[];
  requiredPermissions: PermissionScope[];
  status: 'blueprint_ready' | 'paused';
  executionStageNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface OperationalModuleContract {
  id: ModuleId;
  name: string;
  summary: string;
  domainResponsibility: string;
  inputContract: string;
  outputContract: string;
  isolationRule: string;
  assignedAgentSlug: string;
  stageStatus: 'structure_ready';
}

export interface TenantApplication {
  id: string;
  name: string;
  slug: string;
  description: string;
  isolationNamespace: string;
  dataPartitionKey: string;
  status: 'isolated_ready' | 'suspended';
  allowedProviders: ProviderId[];
  enabledModules: ModuleId[];
  permissions: PermissionScope[];
  createdAt: string;
  updatedAt: string;
}

export interface ArchitectureLayer {
  id: string;
  order: string;
  title: string;
  responsibility: string;
  components: string[];
  status: 'implemented_foundation' | 'planned_stage_2';
}

export interface VaultSecurityStatus {
  lockState: 'locked' | 'unlocked';
  persistenceKind: 'persistent' | 'ephemeral_memory';
  masterKeySource: 'env' | 'runtime_master_key' | 'none';
  hasDiskVaultFile: boolean;
  hasMasterKeyVerifier: boolean;
  storedKeysCount: number;
  decryptableKeysCount: number;
  lastUnlockedAt: string | null;
  autoLockMinutes: number;
  autoLockExpiresAt: string | null;
  integrityStatus: 'ok' | 'corrupted';
  integrityError: string | null;
  statusSummary: string;
}

export interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  event: string;
  outcome: 'ok' | 'blocked' | 'error';
  detail: string;
}

export interface EncryptedVaultBackupBundle {
  format: 'aurix-vault-backup-v1';
  kdf: 'scrypt';
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  exportedAt: string;
  recordCount: number;
}

export interface VaultStorageDiagnostics {
  vaultDirPath: string;
  vaultDirSource: 'AURIX_VAULT_DIR' | 'default_local';
  storageBackend: 'mounted_persistent_volume' | 'container_overlay_ephemeral';
  filesystemType: string;
  dirExists: boolean;
  dirMode: string | null;
  writable: boolean;
}

export interface ReadinessCheckItem {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'blocker';
  detail: string;
}

export interface ProductionReadinessReport {
  readyForMultiInstanceProduction: boolean;
  readyForSingleInstanceProduction: boolean;
  nodeEnv: string;
  viteHmrActive: boolean;
  sharedStoreMode: 'redis' | 'single_instance_disk' | 'unavailable_fail_closed';
  storage: VaultStorageDiagnostics;
  checks: ReadinessCheckItem[];
}

export interface PlatformOverview {
  platformName: string;
  stage: string;
  vaultPersistenceMode: 'persistent_encrypted' | 'ephemeral_memory';
  vaultSecurity: VaultSecurityStatus;
  counts: {
    providersPrepared: number;
    keysStored: number;
    agentsModular: number;
    modulesPrepared: number;
    isolatedApps: number;
  };
  architectureLayers: ArchitectureLayer[];
  pendingRoadmap: string[];
}
