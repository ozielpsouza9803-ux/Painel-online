import type { OperationalModuleContract } from '../../shared/contracts.ts';

interface ModulesSectionProps {
  modules: OperationalModuleContract[];
}

export function ModulesSection({ modules }: ModulesSectionProps) {
  return (
    <div className="space-y-6">
      <div className="border-b border-[#1E2028] pb-6">
        <h2 className="text-2xl font-semibold tracking-tight text-[#F4F1EA]">
          Módulos Operacionais
        </h2>
        <p className="mt-1 text-sm text-[#A6A298] max-w-2xl">
          Contratos iniciais de domínio preparados para atendimento, produtos, monitoramento de preços, agendamentos e contingência, com isolamento obrigatório por aplicativo cliente.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {modules.map((mod, idx) => (
          <article
            key={mod.id}
            className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#1A1C24]">
              <div>
                <p className="text-xs font-mono text-[#D4AF37]">
                  0{idx + 1}. {mod.id}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-[#F4F1EA]">{mod.name}</h3>
              </div>
              <div className="text-xs text-[#8E8A80]">
                Agente designado:{' '}
                <span className="font-mono text-[#C8C3B8]">{mod.assignedAgentSlug}</span>
              </div>
            </div>

            <p className="mt-4 text-sm text-[#C8C3B8]">{mod.summary}</p>
            <p className="mt-2 text-xs text-[#9E9A90] leading-relaxed">
              {mod.domainResponsibility}
            </p>

            <div className="mt-5 pt-4 border-t border-[#1A1C24] grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-[#7D7970] mb-1">Contrato de entrada</p>
                <p className="font-mono text-[#D4AF37] break-words">{mod.inputContract}</p>
              </div>
              <div>
                <p className="text-[#7D7970] mb-1">Contrato de saída</p>
                <p className="font-mono text-[#C8C3B8] break-words">{mod.outputContract}</p>
              </div>
              <div>
                <p className="text-[#7D7970] mb-1">Regra de isolamento</p>
                <p className="text-[#A6A298] leading-relaxed">{mod.isolationRule}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
