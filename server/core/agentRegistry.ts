import crypto from 'node:crypto';
import type {
  AgentBlueprint,
  ModuleId,
  PermissionScope,
  ProviderId,
} from '../../shared/contracts.ts';
import {
  readVaultFile,
  VaultCorruptionError,
  withVaultLock,
  writeVaultFile,
} from '../security/storage.ts';

const AGENTS_FILE = 'agents-registry.json';

const VALID_MODULES: ReadonlySet<ModuleId> = new Set([
  'atendimento',
  'produtos',
  'monitoramento_precos',
  'agendamentos',
  'contingencia',
]);

const VALID_PROVIDERS: ReadonlySet<ProviderId> = new Set([
  'gemini',
  'groq',
  'cloudflare',
  'openrouter',
  'mistral',
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

function createDefaultAgents(): AgentBlueprint[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'agt_atendimento',
      name: 'Agente de Atendimento',
      slug: 'agente-atendimento',
      moduleId: 'atendimento',
      roleSummary: 'Triagem inicial, compreensão de intenção e resposta contextualizada por aplicativo.',
      systemPromptTemplate:
        'Atue como especialista de atendimento do aplicativo {{tenantName}}. Responda exclusivamente com base nos dados autorizados do namespace {{namespace}}.',
      preferredProviderId: 'gemini',
      fallbackChain: ['groq', 'openrouter', 'mistral'],
      requiredPermissions: ['agents:invoke', 'module:atendimento'],
      status: 'blueprint_ready',
      executionStageNote: 'Contrato modular pronto · Integração de inferência prevista na Etapa 2',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'agt_produtos',
      name: 'Agente de Produtos',
      slug: 'agente-produtos',
      moduleId: 'produtos',
      roleSummary: 'Normalização de catálogo, especificações técnicas e recomendação estruturada.',
      systemPromptTemplate:
        'Organize atributos, especificações e comparações de catálogo para o tenant {{tenantName}} sem inventar estoque ou preços.',
      preferredProviderId: 'groq',
      fallbackChain: ['gemini', 'mistral', 'openrouter'],
      requiredPermissions: ['agents:invoke', 'module:produtos'],
      status: 'blueprint_ready',
      executionStageNote: 'Contrato modular pronto · Integração de inferência prevista na Etapa 2',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'agt_precos',
      name: 'Agente de Monitoramento de Preços',
      slug: 'agente-precos',
      moduleId: 'monitoramento_precos',
      roleSummary: 'Leitura comparativa de variações, detecção de desvios e alertas de margem.',
      systemPromptTemplate:
        'Avalie variações percentuais recebidas no payload do tenant {{tenantName}} e retorne alertas objetivos conforme a política de margem.',
      preferredProviderId: 'mistral',
      fallbackChain: ['gemini', 'groq', 'openrouter'],
      requiredPermissions: ['agents:invoke', 'module:monitoramento_precos'],
      status: 'blueprint_ready',
      executionStageNote: 'Contrato modular pronto · Integração de inferência prevista na Etapa 2',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'agt_agendamentos',
      name: 'Agente de Agendamentos',
      slug: 'agente-agendamentos',
      moduleId: 'agendamentos',
      roleSummary: 'Sugestão de horários livres, checagem de conflitos e preparação de confirmações.',
      systemPromptTemplate:
        'Valide janelas de disponibilidade fornecidas pela API do tenant {{tenantName}} e apresente opções claras em fuso horário local.',
      preferredProviderId: 'gemini',
      fallbackChain: ['groq', 'cloudflare'],
      requiredPermissions: ['agents:invoke', 'module:agendamentos'],
      status: 'blueprint_ready',
      executionStageNote: 'Contrato modular pronto · Integração de inferência prevista na Etapa 2',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'agt_contingencia',
      name: 'Agente de Contingência',
      slug: 'agente-contingencia',
      moduleId: 'contingencia',
      roleSummary: 'Decisão de failover entre provedores gratuitos, circuit breaking e modo seguro.',
      systemPromptTemplate:
        'Coordene a troca determinística de provedor ou resposta de degradação segura quando o provedor primário estiver indisponível.',
      preferredProviderId: 'cloudflare',
      fallbackChain: ['groq', 'openrouter', 'gemini'],
      requiredPermissions: ['agents:invoke', 'module:contingencia'],
      status: 'blueprint_ready',
      executionStageNote: 'Contrato modular pronto · Integração de inferência prevista na Etapa 2',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function loadAgentsStrict(): AgentBlueprint[] {
  const raw = readVaultFile(AGENTS_FILE);
  if (raw === null) {
    const defaults = createDefaultAgents();
    writeVaultFile(AGENTS_FILE, JSON.stringify(defaults));
    return defaults;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VaultCorruptionError(
      AGENTS_FILE,
      'Registro de agentes (agents-registry.json) corrompido. Escrita bloqueada.',
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new VaultCorruptionError(
      AGENTS_FILE,
      'Estrutura do registro de agentes inválida.',
    );
  }
  return parsed as AgentBlueprint[];
}

function saveAgents(agents: AgentBlueprint[]): void {
  writeVaultFile(AGENTS_FILE, JSON.stringify(agents));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function listAgentBlueprints(): AgentBlueprint[] {
  return loadAgentsStrict();
}

export function getAgentBlueprintById(id: string): AgentBlueprint | null {
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
    return null;
  }
  return loadAgentsStrict().find((a) => a.id === id) ?? null;
}

export async function createAgentBlueprint(input: {
  name: unknown;
  moduleId: unknown;
  roleSummary: unknown;
  systemPromptTemplate: unknown;
  preferredProviderId: unknown;
  fallbackChain?: unknown;
}): Promise<{ ok: true; agent: AgentBlueprint } | { ok: false; error: string }> {
  if (typeof input.name !== 'string' || input.name.trim().length < 3 || input.name.trim().length > 64) {
    return { ok: false, error: 'O nome do agente deve ter entre 3 e 64 caracteres.' };
  }
  if (typeof input.moduleId !== 'string' || !VALID_MODULES.has(input.moduleId as ModuleId)) {
    return { ok: false, error: 'Módulo operacional inválido.' };
  }
  if (typeof input.roleSummary !== 'string' || input.roleSummary.trim().length < 6 || input.roleSummary.trim().length > 220) {
    return { ok: false, error: 'Descreva o papel do agente (6 a 220 caracteres).' };
  }
  if (typeof input.systemPromptTemplate !== 'string' || input.systemPromptTemplate.trim().length < 10 || input.systemPromptTemplate.trim().length > 1500) {
    return { ok: false, error: 'O template de instruções deve ter entre 10 e 1500 caracteres.' };
  }
  if (typeof input.preferredProviderId !== 'string' || !VALID_PROVIDERS.has(input.preferredProviderId as ProviderId)) {
    return { ok: false, error: 'Provedor primário inválido.' };
  }

  const fallbackChain: ProviderId[] = Array.isArray(input.fallbackChain)
    ? input.fallbackChain.filter(
        (p): p is ProviderId =>
          typeof p === 'string' &&
          VALID_PROVIDERS.has(p as ProviderId) &&
          p !== input.preferredProviderId,
      )
    : [];

  const slug = slugify(input.name) || `agente-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  const permissionForModule = `module:${input.moduleId}` as PermissionScope;
  const requiredPermissions: PermissionScope[] = VALID_PERMISSIONS.has(permissionForModule)
    ? ['agents:invoke', permissionForModule]
    : ['agents:invoke'];

  const agent: AgentBlueprint = {
    id: `agt_${crypto.randomBytes(5).toString('hex')}`,
    name: input.name.trim(),
    slug,
    moduleId: input.moduleId as ModuleId,
    roleSummary: input.roleSummary.trim(),
    systemPromptTemplate: input.systemPromptTemplate.trim(),
    preferredProviderId: input.preferredProviderId as ProviderId,
    fallbackChain,
    requiredPermissions,
    status: 'blueprint_ready',
    executionStageNote: 'Contrato modular pronto · Integração de inferência prevista na Etapa 2',
    createdAt: now,
    updatedAt: now,
  };

  return withVaultLock(() => {
    const agents = loadAgentsStrict();
    agents.push(agent);
    saveAgents(agents);
    return { ok: true, agent };
  });
}

export async function updateAgentBlueprint(
  id: string,
  patch: {
    preferredProviderId?: unknown;
    fallbackChain?: unknown;
    status?: unknown;
    systemPromptTemplate?: unknown;
  },
): Promise<{ ok: true; agent: AgentBlueprint } | { ok: false; error: string }> {
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
    return { ok: false, error: 'Identificador de agente inválido.' };
  }

  return withVaultLock(() => {
    const agents = loadAgentsStrict();
    const idx = agents.findIndex((a) => a.id === id);
    if (idx === -1) {
      return { ok: false, error: 'Agente não encontrado.' };
    }

    const current = agents[idx];
    let preferredProviderId = current.preferredProviderId;
    if (patch.preferredProviderId !== undefined) {
      if (
        typeof patch.preferredProviderId !== 'string' ||
        !VALID_PROVIDERS.has(patch.preferredProviderId as ProviderId)
      ) {
        return { ok: false, error: 'Provedor primário inválido.' };
      }
      preferredProviderId = patch.preferredProviderId as ProviderId;
    }

    let fallbackChain = current.fallbackChain;
    if (patch.fallbackChain !== undefined) {
      if (!Array.isArray(patch.fallbackChain)) {
        return { ok: false, error: 'Lista de fallback inválida.' };
      }
      fallbackChain = patch.fallbackChain.filter(
        (p): p is ProviderId =>
          typeof p === 'string' &&
          VALID_PROVIDERS.has(p as ProviderId) &&
          p !== preferredProviderId,
      );
    }

    let status = current.status;
    if (patch.status !== undefined) {
      if (patch.status !== 'blueprint_ready' && patch.status !== 'paused') {
        return { ok: false, error: 'Status inválido.' };
      }
      status = patch.status;
    }

    let systemPromptTemplate = current.systemPromptTemplate;
    if (patch.systemPromptTemplate !== undefined) {
      if (
        typeof patch.systemPromptTemplate !== 'string' ||
        patch.systemPromptTemplate.trim().length < 10 ||
        patch.systemPromptTemplate.trim().length > 1500
      ) {
        return { ok: false, error: 'Template de instruções inválido (10 a 1500 caracteres).' };
      }
      systemPromptTemplate = patch.systemPromptTemplate.trim();
    }

    const updated: AgentBlueprint = {
      ...current,
      preferredProviderId,
      fallbackChain,
      status,
      systemPromptTemplate,
      updatedAt: new Date().toISOString(),
    };

    agents[idx] = updated;
    saveAgents(agents);
    return { ok: true, agent: updated };
  });
}
