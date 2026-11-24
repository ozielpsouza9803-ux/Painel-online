import type { OperationalModuleContract } from '../../shared/contracts.ts';

const MODULE_CONTRACTS: OperationalModuleContract[] = [
  {
    id: 'atendimento',
    name: 'Módulo de Atendimento',
    summary: 'Triagem, recepção contextual e encaminhamento de solicitações por canal.',
    domainResponsibility: 'Interpretar intenção do usuário final, consultar contexto isolado do aplicativo e direcionar para resposta ou ação estruturada.',
    inputContract: '{ tenantId, channel, message, conversationContextRef }',
    outputContract: '{ intent, suggestedReply, escalateToHuman, confidenceTag }',
    isolationRule: 'Histórico e base de conhecimento restritos ao namespace do tenant solicitante.',
    assignedAgentSlug: 'agente-atendimento',
    stageStatus: 'structure_ready',
  },
  {
    id: 'produtos',
    name: 'Módulo de Produtos',
    summary: 'Padronização de catálogo, descrição técnica e recomendação semântica.',
    domainResponsibility: 'Estruturar atributos de itens, normalizar variações e preparar recomendações compatíveis com o catálogo do aplicativo.',
    inputContract: '{ tenantId, skuOrQuery, catalogFilter, locale }',
    outputContract: '{ normalizedAttributes, summaryCopy, matchedItems }',
    isolationRule: 'Tabelas e vetores de catálogo segregados por dataPartitionKey de cada aplicativo.',
    assignedAgentSlug: 'agente-produtos',
    stageStatus: 'structure_ready',
  },
  {
    id: 'monitoramento_precos',
    name: 'Módulo de Monitoramento de Preços',
    summary: 'Observação de variações, regras de margem e detecção de anomalias comerciais.',
    domainResponsibility: 'Analisar séries históricas de preço, identificar desvios de faixa permitida e gerar alertas auditáveis.',
    inputContract: '{ tenantId, sku, currentPrice, competitorSnapshots, marginFloor }',
    outputContract: '{ deltaPercent, alertLevel, recommendedAction, rationale }',
    isolationRule: 'Políticas de precificação e margens isoladas por tenant, sem cruzamento entre aplicativos.',
    assignedAgentSlug: 'agente-precos',
    stageStatus: 'structure_ready',
  },
  {
    id: 'agendamentos',
    name: 'Módulo de Agendamentos',
    summary: 'Orquestração de janelas de horário, conflitos e fluxos de confirmação.',
    domainResponsibility: 'Validar disponibilidade declarada pelo aplicativo cliente, propor janelas livres e estruturar confirmações/remarcações.',
    inputContract: '{ tenantId, serviceId, requestedWindow, timezone, constraints }',
    outputContract: '{ candidateSlots, conflictDetected, confirmationPayload }',
    isolationRule: 'Agendas, profissionais e clientes finais acessíveis apenas via escopo module:agendamentos.',
    assignedAgentSlug: 'agente-agendamentos',
    stageStatus: 'structure_ready',
  },
  {
    id: 'contingencia',
    name: 'Módulo de Contingência',
    summary: 'Roteamento resiliente, circuit breaker e degradação controlada entre provedores.',
    domainResponsibility: 'Aplicar cadeia de fallback quando um provedor gratuito atingir cota, timeout ou indisponibilidade.',
    inputContract: '{ tenantId, failedProviderId, errorClass, fallbackChain }',
    outputContract: '{ nextProviderId, degradedMode, retryPolicy, auditEvent }',
    isolationRule: 'Políticas de contingência respeitam exclusivamente os provedores autorizados para o tenant.',
    assignedAgentSlug: 'agente-contingencia',
    stageStatus: 'structure_ready',
  },
];

export function listOperationalModules(): OperationalModuleContract[] {
  return MODULE_CONTRACTS;
}
