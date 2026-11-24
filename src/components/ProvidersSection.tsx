import { useState } from 'react';
import { Activity, KeyRound } from 'lucide-react';
import type {
  ProviderBlueprint,
  ProviderHttpTestResult,
  ProviderId,
  VaultKeySummary,
} from '../../shared/contracts.ts';
import { aurixApi } from '../lib/api.ts';

interface ProvidersSectionProps {
  providers: ProviderBlueprint[];
  keys: VaultKeySummary[];
  testHistory: ProviderHttpTestResult[];
  vaultPersistenceMode: 'persistent_encrypted' | 'ephemeral_memory';
  onAddKeyForProvider: (providerId: ProviderId) => void;
  onTestCompleted: () => Promise<void>;
}

const ERROR_CATEGORY_LABELS: Record<ProviderHttpTestResult['errorCategory'], string> = {
  none: 'Sucesso',
  auth_error: 'Autenticação rejeitada',
  rate_limit: 'Limite de taxa / cota',
  timeout: 'Timeout',
  network_error: 'Erro de rede',
  invalid_response: 'Resposta inválida',
  bad_request: 'Requisição inválida',
  provider_error: 'Erro do provedor',
};

export function ProvidersSection({
  providers,
  keys,
  testHistory,
  vaultPersistenceMode,
  onAddKeyForProvider,
  onTestCompleted,
}: ProvidersSectionProps) {
  const [selectedCredByProvider, setSelectedCredByProvider] = useState<Record<string, string>>({});
  const [selectedModelByProvider, setSelectedModelByProvider] = useState<Record<string, string>>({});
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleRunTest(provider: ProviderBlueprint) {
    const providerKeys = keys.filter((k) => k.providerId === provider.id);
    const defaultCred =
      providerKeys[0]?.id ?? (provider.envConfigured ? '__ENV__' : '');
    const chosenCred = selectedCredByProvider[provider.id] ?? defaultCred;

    if (!chosenCred) {
      setLocalError(
        `Nenhuma chave cadastrada para ${provider.name}. Cadastre uma chave no cofre primeiro.`,
      );
      return;
    }

    const chosenModel =
      selectedModelByProvider[provider.id] ?? provider.recommendedModels[0];

    setLocalError(null);
    setTestingProvider(provider.id);

    try {
      await aurixApi.testProvider(provider.id, {
        keyId: chosenCred === '__ENV__' ? undefined : chosenCred,
        useEnv: chosenCred === '__ENV__',
        model: chosenModel,
      });
      await onTestCompleted();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Falha ao executar teste HTTP.');
    } finally {
      setTestingProvider(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#1E2028] pb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#F4F1EA]">
            Central de Provedores de IA
          </h2>
          <p className="mt-1 text-sm text-[#A6A298] max-w-2xl">
            Integrações HTTP reais com descriptografia exclusiva no servidor. Cada teste executa uma chamada REST real ao provedor selecionado e exibe o código HTTP retornado.
          </p>
        </div>
        <div className="text-xs text-[#9E9A90] font-mono">
          Modo do cofre:{' '}
          <span className="text-[#D4AF37]">
            {vaultPersistenceMode === 'persistent_encrypted'
              ? 'AES-256-GCM em disco'
              : 'AES-256-GCM em memória'}
          </span>
        </div>
      </div>

      {localError && (
        <div className="rounded-xl bg-[#2A1215] border border-[#7F2932] px-4 py-3 text-sm text-[#F5B8BE]">
          {localError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {providers.map((provider) => {
          const providerKeys = keys.filter((k) => k.providerId === provider.id);
          const hasAnyCredential = providerKeys.length > 0 || provider.envConfigured;
          const defaultCred =
            providerKeys[0]?.id ?? (provider.envConfigured ? '__ENV__' : '');
          const chosenCred = selectedCredByProvider[provider.id] ?? defaultCred;
          const chosenModel =
            selectedModelByProvider[provider.id] ?? provider.recommendedModels[0];
          const latestTest = testHistory.find((t) => t.providerId === provider.id);

          return (
            <article
              key={provider.id}
              className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-6 flex flex-col justify-between gap-5"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs text-[#8E8A80]">
                      {provider.vendor} <span aria-hidden="true">·</span>{' '}
                      <span className="font-mono">{provider.id}</span>
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-[#F4F1EA]">
                      {provider.name}
                    </h3>
                  </div>
                  <span
                    className={`text-xs font-medium whitespace-nowrap ${
                      hasAnyCredential ? 'text-[#D4AF37]' : 'text-[#8E8A80]'
                    }`}
                  >
                    {providerKeys.length > 0
                      ? `${providerKeys.length} chave(s) no cofre`
                      : provider.envConfigured
                        ? 'Variável de ambiente ativa'
                        : 'Sem chave cadastrada'}
                  </span>
                </div>

                <p className="mt-3 text-sm text-[#A6A298] leading-relaxed">
                  {provider.freeTierSummary}
                </p>

                <div className="mt-4 pt-4 border-t border-[#1A1C24] space-y-2 text-xs">
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-[#C8C3B8]">
                    <span className="text-[#7D7970]">Capacidades:</span>
                    <span>{provider.capabilities.join(' · ')}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-[#9E9A90] font-mono">
                    <span className="text-[#7D7970] font-sans">Endpoint:</span>
                    <span className="break-all">{provider.endpointSummary}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-[#9E9A90] font-mono">
                    <span className="text-[#7D7970] font-sans">Variável de servidor:</span>
                    <span>
                      {provider.envVarName} (
                      {provider.envConfigured ? 'detectada no ambiente' : 'não definida'})
                    </span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-[#1A1C24] grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor={`cred-${provider.id}`}
                      className="block text-xs text-[#8E8A80] mb-1"
                    >
                      Credencial para teste
                    </label>
                    <select
                      id={`cred-${provider.id}`}
                      value={chosenCred}
                      onChange={(e) =>
                        setSelectedCredByProvider((prev) => ({
                          ...prev,
                          [provider.id]: e.target.value,
                        }))
                      }
                      disabled={!hasAnyCredential}
                      className="w-full rounded-md bg-[#090A0D] border border-[#282B36] px-2.5 py-2 text-xs text-[#F4F1EA] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                    >
                      {!hasAnyCredential && <option value="">Sem credencial</option>}
                      {providerKeys.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label} ({k.maskedPreview})
                        </option>
                      ))}
                      {provider.envConfigured && (
                        <option value="__ENV__">Servidor: {provider.envVarName}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`model-${provider.id}`}
                      className="block text-xs text-[#8E8A80] mb-1"
                    >
                      Modelo alvo
                    </label>
                    <select
                      id={`model-${provider.id}`}
                      value={chosenModel}
                      onChange={(e) =>
                        setSelectedModelByProvider((prev) => ({
                          ...prev,
                          [provider.id]: e.target.value,
                        }))
                      }
                      className="w-full rounded-md bg-[#090A0D] border border-[#282B36] px-2.5 py-2 text-xs font-mono text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                    >
                      {provider.recommendedModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {latestTest && (
                  <div
                    className={`mt-4 rounded-lg px-3.5 py-3 border text-xs space-y-1.5 ${
                      latestTest.ok
                        ? 'bg-[#121710] border-[#425229] text-[#DCE6B8]'
                        : 'bg-[#211215] border-[#6E2A32] text-[#F5B8BE]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                      <span>
                        HTTP {latestTest.httpStatus ?? 'N/A'} · {latestTest.httpStatusText}
                      </span>
                      <span>{latestTest.latencyMs} ms</span>
                    </div>
                    <p className="text-[#C8C3B8]">
                      {latestTest.ok
                        ? `Resposta: ${latestTest.responsePreview}`
                        : `${ERROR_CATEGORY_LABELS[latestTest.errorCategory]}: ${latestTest.errorDetail}`}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#1A1C24]">
                <button
                  type="button"
                  onClick={() => onAddKeyForProvider(provider.id)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#2C2F3A] text-xs font-medium text-[#C8C3B8] hover:border-[#D4AF37]/50 hover:text-[#F4F1EA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Cadastrar chave</span>
                </button>

                <button
                  type="button"
                  disabled={!hasAnyCredential || testingProvider === provider.id}
                  onClick={() => handleRunTest(provider)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070709] text-xs font-semibold hover:bg-[#E2C04D] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>
                    {testingProvider === provider.id
                      ? 'Executando chamada HTTP...'
                      : 'Testar HTTP real'}
                  </span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <section className="bg-[#0D0E12] border border-[#22252F] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1E2028] flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-[#F4F1EA]">
              Registro de testes HTTP reais desta sessão
            </h3>
            <p className="text-xs text-[#8E8A80] mt-0.5">
              Exibe apenas resultados reais retornados pelos endpoints oficiais dos provedores
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#9E9A90]">
            {testHistory.length} chamada(s)
          </span>
        </div>

        {testHistory.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-[#8E8A80]">
            Nenhum teste HTTP real executado ainda nesta sessão. Cadastre uma chave no cofre e clique em "Testar HTTP real".
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#1E2028] text-xs text-[#8E8A80]">
                  <th className="py-3 px-6 font-medium">Provedor / Modelo</th>
                  <th className="py-3 px-4 font-medium">Credencial</th>
                  <th className="py-3 px-4 font-medium">Status HTTP</th>
                  <th className="py-3 px-4 font-medium text-right">Latência</th>
                  <th className="py-3 px-6 font-medium">Retorno / Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1A1C24] text-xs">
                {testHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-[#111319] transition-colors align-top">
                    <td className="py-3.5 px-6">
                      <p className="font-medium text-[#F4F1EA]">{item.providerId}</p>
                      <p className="font-mono text-[#8E8A80] mt-0.5">{item.model}</p>
                    </td>
                    <td className="py-3.5 px-4 text-[#C8C3B8]">
                      <p>{item.keyLabel}</p>
                      <p className="font-mono text-[#7D7970] mt-0.5">{item.keySource}</p>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums">
                      <span className={item.ok ? 'text-[#D4AF37]' : 'text-[#F5B8BE]'}>
                        {item.httpStatus !== null
                          ? `${item.httpStatus} ${item.httpStatusText}`
                          : item.httpStatusText}
                      </span>
                      <p className="text-[#7D7970] font-sans mt-0.5">
                        {ERROR_CATEGORY_LABELS[item.errorCategory]}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#C8C3B8]">
                      {item.latencyMs} ms
                    </td>
                    <td className="py-3.5 px-6 text-[#A6A298] max-w-md">
                      <p className="break-words">
                        {item.ok ? item.responsePreview : item.errorDetail}
                      </p>
                      {Object.keys(item.rateLimitInfo).length > 0 && (
                        <p className="mt-1 font-mono text-[#7D7970]">
                          Limites:{' '}
                          {Object.entries(item.rateLimitInfo)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(' · ')}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
