import type { PlatformOverview } from '../../shared/contracts.ts';

interface OverviewSectionProps {
  overview: PlatformOverview;
  onNavigate: (tab: 'providers' | 'vault' | 'agents' | 'modules' | 'tenants') => void;
}

export function OverviewSection({ overview, onNavigate }: OverviewSectionProps) {
  const kpis = [
    {
      label: 'Provedores Preparados',
      value: overview.counts.providersPrepared,
      detail: 'Gemini, Groq, Cloudflare, OpenRouter, Mistral',
      action: () => onNavigate('providers'),
    },
    {
      label: 'Chaves no Cofre',
      value: overview.counts.keysStored,
      detail:
        overview.vaultSecurity.lockState === 'locked'
          ? 'Bloqueado · Persistente em disco'
          : overview.vaultSecurity.persistenceKind === 'persistent'
            ? 'Desbloqueado · Persistente AES-256-GCM'
            : 'Desbloqueado · Memória temporária',
      action: () => onNavigate('vault'),
    },
    {
      label: 'Agentes Modulares',
      value: overview.counts.agentsModular,
      detail: 'Blueprints isolados prontos',
      action: () => onNavigate('agents'),
    },
    {
      label: 'Módulos Operacionais',
      value: overview.counts.modulesPrepared,
      detail: 'Contratos de domínio definidos',
      action: () => onNavigate('modules'),
    },
    {
      label: 'Aplicativos Isolados',
      value: overview.counts.isolatedApps,
      detail: 'Sem conexões externas nesta etapa',
      action: () => onNavigate('tenants'),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 border-b border-[#1E2028] pb-6">
        <div className="flex items-center gap-2 text-xs text-[#D4AF37]">
          <span>{overview.stage}</span>
          <span aria-hidden="true">·</span>
          <span className="text-[#9E9A90]">Isolamento estrito ativo</span>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-[#F4F1EA] max-w-2xl">
          Arquitetura inicial da plataforma multiagentes
        </h2>
        <p className="text-sm text-[#A6A298] max-w-3xl leading-relaxed">
          Fundação independente projetada para coordenar agentes especializados, centralizar provedores gratuitos sem expor credenciais no navegador e isolar dados entre múltiplos aplicativos clientes.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className="text-left bg-[#0D0E12] border border-[#22252F] hover:border-[#D4AF37]/50 rounded-xl p-5 transition-colors cursor-pointer"
          >
            <p className="text-xs text-[#9E9A90]">{item.label}</p>
            <p className="mt-2 text-3xl font-semibold font-mono tabular-nums text-[#F4F1EA]">
              {item.value}
            </p>
            <p className="mt-2 text-xs text-[#7B776E] truncate">{item.detail}</p>
          </button>
        ))}
      </div>

      <section className="bg-[#0D0E12] border border-[#22252F] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1E2028] flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#F4F1EA]">
              Camadas da arquitetura
            </h3>
            <p className="text-xs text-[#8E8A80] mt-0.5">
              Separação de responsabilidades entre interface, segurança, provedores, agentes e tenants
            </p>
          </div>
          <span className="text-xs font-mono text-[#D4AF37] whitespace-nowrap">
            6 camadas
          </span>
        </div>

        <div className="divide-y divide-[#1A1C24]">
          {overview.architectureLayers.map((layer) => (
            <div
              key={layer.id}
              className="px-6 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start hover:bg-[#111319] transition-colors"
            >
              <div className="lg:col-span-4 flex items-start gap-3">
                <span className="font-mono text-xs text-[#D4AF37] pt-0.5 tabular-nums">
                  {layer.order}.
                </span>
                <div>
                  <p className="text-sm font-medium text-[#F4F1EA]">{layer.title}</p>
                  <p className="text-xs text-[#8E8A80] mt-1">
                    {layer.status === 'implemented_foundation'
                      ? 'Fundação implementada'
                      : 'Planejado para Etapa 2'}
                  </p>
                </div>
              </div>
              <p className="lg:col-span-5 text-sm text-[#A6A298] leading-relaxed">
                {layer.responsibility}
              </p>
              <div className="lg:col-span-3 text-xs text-[#9E9A90] font-mono">
                {layer.components.join(' · ')}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-6">
          <h3 className="text-base font-semibold text-[#F4F1EA]">
            Limites respeitados na Etapa 2
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-[#A6A298]">
            <li>Projeto independente, sem alteração nem conexão ao SALÃO LUXE.</li>
            <li>Sem uso de Firebase; descriptografia de chaves restrita ao servidor.</li>
            <li>Chamadas HTTP reais aos provedores, sem mocks ou resultados simulados.</li>
            <li>Módulos operacionais mantidos apenas em contrato estrutural nesta etapa.</li>
          </ul>
        </section>

        <section className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-6">
          <h3 className="text-base font-semibold text-[#F4F1EA]">
            Pendências para próximas etapas
          </h3>
          <ul className="mt-4 space-y-2.5 text-sm text-[#A6A298]">
            {overview.pendingRoadmap.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
