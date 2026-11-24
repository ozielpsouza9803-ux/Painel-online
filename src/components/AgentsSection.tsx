import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type {
  AgentBlueprint,
  ModuleId,
  OperationalModuleContract,
  ProviderBlueprint,
  ProviderId,
} from '../../shared/contracts.ts';
import { aurixApi } from '../lib/api.ts';

interface AgentsSectionProps {
  agents: AgentBlueprint[];
  providers: ProviderBlueprint[];
  modules: OperationalModuleContract[];
  onAgentsChanged: () => Promise<void>;
}

export function AgentsSection({
  agents,
  providers,
  modules,
  onAgentsChanged,
}: AgentsSectionProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [moduleId, setModuleId] = useState<ModuleId>('atendimento');
  const [roleSummary, setRoleSummary] = useState('');
  const [systemPromptTemplate, setSystemPromptTemplate] = useState('');
  const [preferredProviderId, setPreferredProviderId] = useState<ProviderId>('gemini');
  const [fallbackSelection, setFallbackSelection] = useState<ProviderId[]>(['groq', 'openrouter']);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleFallback(providerId: ProviderId) {
    setFallbackSelection((prev) =>
      prev.includes(providerId) ? prev.filter((id) => id !== providerId) : [...prev, providerId],
    );
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await aurixApi.createAgent({
        name,
        moduleId,
        roleSummary,
        systemPromptTemplate,
        preferredProviderId,
        fallbackChain: fallbackSelection.filter((p) => p !== preferredProviderId),
      });
      setName('');
      setRoleSummary('');
      setSystemPromptTemplate('');
      setShowCreateForm(false);
      await onAgentsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar blueprint de agente.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(agent: AgentBlueprint) {
    setUpdatingId(agent.id);
    try {
      await aurixApi.updateAgent(agent.id, {
        status: agent.status === 'blueprint_ready' ? 'paused' : 'blueprint_ready',
      });
      await onAgentsChanged();
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleChangePrimaryProvider(agent: AgentBlueprint, nextProvider: ProviderId) {
    setUpdatingId(agent.id);
    try {
      await aurixApi.updateAgent(agent.id, {
        preferredProviderId: nextProvider,
        fallbackChain: agent.fallbackChain.filter((p) => p !== nextProvider),
      });
      await onAgentsChanged();
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#1E2028] pb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#F4F1EA]">
            Agentes Especializados
          </h2>
          <p className="mt-1 text-sm text-[#A6A298] max-w-2xl">
            Estrutura modular de agentes desacoplados por domínio operacional, com roteamento primário e cadeia de contingência entre provedores.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070709] text-xs font-semibold hover:bg-[#E2C04D] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{showCreateForm ? 'Fechar formulário' : 'Novo agente modular'}</span>
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="bg-[#0D0E12] border border-[#D4AF37]/30 rounded-xl p-6 space-y-4"
        >
          <h3 className="text-base font-semibold text-[#F4F1EA]">
            Registrar novo blueprint de agente
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="agent-name" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
                Nome do agente
              </label>
              <input
                id="agent-name"
                type="text"
                required
                minLength={3}
                maxLength={64}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Agente de Pós-Venda"
                className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              />
            </div>

            <div>
              <label htmlFor="agent-module" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
                Módulo vinculado
              </label>
              <select
                id="agent-module"
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value as ModuleId)}
                className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              >
                {modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="agent-provider" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
                Provedor primário
              </label>
              <select
                id="agent-provider"
                value={preferredProviderId}
                onChange={(e) => setPreferredProviderId(e.target.value as ProviderId)}
                className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="agent-summary" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
              Responsabilidade resumida
            </label>
            <input
              id="agent-summary"
              type="text"
              required
              minLength={6}
              maxLength={220}
              value={roleSummary}
              onChange={(e) => setRoleSummary(e.target.value)}
              placeholder="Descreva a especialidade e limite de atuação do agente"
              className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            />
          </div>

          <div>
            <label htmlFor="agent-prompt" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
              Template de instruções (suporta {'{{tenantName}}'} e {'{{namespace}}'})
            </label>
            <textarea
              id="agent-prompt"
              rows={3}
              required
              minLength={10}
              maxLength={1500}
              value={systemPromptTemplate}
              onChange={(e) => setSystemPromptTemplate(e.target.value)}
              placeholder="Defina as instruções base isoladas para este agente"
              className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            />
          </div>

          <div>
            <p className="text-xs font-medium text-[#C8C3B8] mb-2">
              Cadeia de fallback (contingência)
            </p>
            <div className="flex flex-wrap gap-3">
              {providers
                .filter((p) => p.id !== preferredProviderId)
                .map((p) => (
                  <label
                    key={p.id}
                    className="inline-flex items-center gap-2 text-xs text-[#C8C3B8] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={fallbackSelection.includes(p.id)}
                      onChange={() => toggleFallback(p.id)}
                      className="accent-[#D4AF37]"
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-[#2A1215] border border-[#7F2932] px-3.5 py-2.5 text-xs text-[#F5B8BE]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-lg border border-[#2C2F3A] text-xs font-medium text-[#C8C3B8] hover:text-[#F4F1EA] cursor-pointer whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070709] text-xs font-semibold hover:bg-[#E2C04D] disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              {submitting ? 'Salvando...' : 'Salvar agente'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {agents.map((agent) => (
          <article
            key={agent.id}
            className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-6 space-y-4"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#8E8A80]">
                  <span className="font-mono text-[#D4AF37]">{agent.slug}</span>
                  <span aria-hidden="true">·</span>
                  <span>Módulo: {agent.moduleId}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {agent.status === 'blueprint_ready'
                      ? 'Estrutura pronta (Etapa 1)'
                      : 'Pausado'}
                  </span>
                </div>
                <h3 className="mt-1 text-lg font-semibold text-[#F4F1EA]">{agent.name}</h3>
                <p className="mt-1 text-sm text-[#A6A298]">{agent.roleSummary}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <label className="text-xs text-[#8E8A80] flex items-center gap-2">
                  <span>Primário:</span>
                  <select
                    aria-label={`Provedor primário de ${agent.name}`}
                    disabled={updatingId === agent.id}
                    value={agent.preferredProviderId}
                    onChange={(e) =>
                      handleChangePrimaryProvider(agent, e.target.value as ProviderId)
                    }
                    className="rounded-md bg-[#090A0D] border border-[#282B36] px-2.5 py-1.5 text-xs text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  disabled={updatingId === agent.id}
                  onClick={() => handleToggleStatus(agent)}
                  className="px-3.5 py-1.5 rounded-md border border-[#2C2F3A] text-xs font-medium text-[#C8C3B8] hover:border-[#D4AF37]/50 hover:text-[#F4F1EA] transition-colors cursor-pointer whitespace-nowrap"
                >
                  {agent.status === 'blueprint_ready' ? 'Pausar blueprint' : 'Reativar blueprint'}
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-[#1A1C24] grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
              <div className="lg:col-span-7">
                <span className="text-[#7D7970]">Template isolado:</span>
                <p className="mt-1 font-mono text-[#C8C3B8] leading-relaxed">
                  {agent.systemPromptTemplate}
                </p>
              </div>
              <div className="lg:col-span-5 space-y-1.5">
                <p className="text-[#9E9A90]">
                  <span className="text-[#7D7970]">Fallback: </span>
                  <span className="font-mono">
                    {agent.fallbackChain.length > 0
                      ? agent.fallbackChain.join(' → ')
                      : 'Nenhum configurado'}
                  </span>
                </p>
                <p className="text-[#9E9A90]">
                  <span className="text-[#7D7970]">Permissões exigidas: </span>
                  <span className="font-mono">{agent.requiredPermissions.join(', ')}</span>
                </p>
                <p className="text-[#7D7970]">{agent.executionStageNote}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
