import type { ProviderId } from '../../shared/contracts.ts';
import { getVaultKeyMetadata } from '../security/vault.ts';
import { getAgentBlueprintById } from './agentRegistry.ts';
import { getTenantById } from './tenantRegistry.ts';

export interface IsolationEvaluationRequest {
  tenantId?: string;
  agentId?: string;
  providerId: ProviderId;
  keyId?: string | null;
}

export interface IsolationEvaluationResult {
  allowed: boolean;
  httpCode: number;
  reason?: string;
  namespace?: string;
}

export function evaluateExecutionIsolation(
  req: IsolationEvaluationRequest,
): IsolationEvaluationResult {
  const effectiveTenantId =
    typeof req.tenantId === 'string' && req.tenantId.trim() !== '' && req.tenantId !== 'global'
      ? req.tenantId.trim()
      : null;

  let tenant = effectiveTenantId ? getTenantById(effectiveTenantId) : null;
  if (effectiveTenantId && !tenant) {
    return {
      allowed: false,
      httpCode: 404,
      reason: 'Aplicativo isolado (tenant) não encontrado no registro.',
    };
  }

  if (tenant) {
    if (tenant.status !== 'isolated_ready') {
      return {
        allowed: false,
        httpCode: 403,
        reason: `Aplicativo "${tenant.name}" está suspenso. Execução bloqueada.`,
      };
    }
    if (!tenant.allowedProviders.includes(req.providerId)) {
      return {
        allowed: false,
        httpCode: 403,
        reason: `O provedor ${req.providerId} não está autorizado na política do aplicativo "${tenant.name}".`,
      };
    }
    if (!tenant.permissions.includes('agents:invoke')) {
      return {
        allowed: false,
        httpCode: 403,
        reason: `Permissão agents:invoke ausente para o aplicativo "${tenant.name}".`,
      };
    }
  }

  if (req.agentId) {
    const agent = getAgentBlueprintById(req.agentId);
    if (!agent) {
      return {
        allowed: false,
        httpCode: 404,
        reason: 'Agente não encontrado no registro.',
      };
    }
    if (agent.status !== 'blueprint_ready') {
      return {
        allowed: false,
        httpCode: 403,
        reason: `Agente "${agent.name}" está pausado e bloqueado para execução.`,
      };
    }
    const allowedAgentProviders = new Set<ProviderId>([
      agent.preferredProviderId,
      ...agent.fallbackChain,
    ]);
    if (!allowedAgentProviders.has(req.providerId)) {
      return {
        allowed: false,
        httpCode: 403,
        reason: `O provedor ${req.providerId} não pertence à matriz primária/fallback do agente "${agent.name}".`,
      };
    }
    if (tenant) {
      if (!tenant.enabledModules.includes(agent.moduleId)) {
        return {
          allowed: false,
          httpCode: 403,
          reason: `O módulo "${agent.moduleId}" não está habilitado para o aplicativo "${tenant.name}".`,
        };
      }
      for (const requiredPerm of agent.requiredPermissions) {
        if (!tenant.permissions.includes(requiredPerm)) {
          return {
            allowed: false,
            httpCode: 403,
            reason: `Permissão RBAC "${requiredPerm}" exigida pelo agente "${agent.name}" ausente no aplicativo "${tenant.name}".`,
          };
        }
      }
    }
  }

  if (req.keyId) {
    const keyMeta = getVaultKeyMetadata(req.keyId);
    if (!keyMeta) {
      return {
        allowed: false,
        httpCode: 404,
        reason: 'Chave não encontrada no cofre.',
      };
    }
    if (keyMeta.providerId !== req.providerId) {
      return {
        allowed: false,
        httpCode: 400,
        reason: 'A chave selecionada pertence a outro provedor.',
      };
    }
    if (effectiveTenantId) {
      if (keyMeta.scopeAppId !== 'global' && keyMeta.scopeAppId !== effectiveTenantId) {
        return {
          allowed: false,
          httpCode: 403,
          reason: `Violação de isolamento: a chave "${keyMeta.label}" pertence exclusivamente ao escopo ${keyMeta.scopeAppId}.`,
        };
      }
    } else if (keyMeta.scopeAppId !== 'global') {
      tenant = getTenantById(keyMeta.scopeAppId);
      if (tenant && tenant.status !== 'isolated_ready') {
        return {
          allowed: false,
          httpCode: 403,
          reason: `O aplicativo vinculado à chave (${tenant.name}) está suspenso.`,
        };
      }
      if (tenant && !tenant.allowedProviders.includes(req.providerId)) {
        return {
          allowed: false,
          httpCode: 403,
          reason: `O provedor ${req.providerId} foi revogado no aplicativo ${tenant.name}.`,
        };
      }
    }
  }

  return {
    allowed: true,
    httpCode: 200,
    namespace: tenant?.isolationNamespace ?? 'global',
  };
}
