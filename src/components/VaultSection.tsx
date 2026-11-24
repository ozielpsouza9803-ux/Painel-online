import { useState, type FormEvent } from 'react';
import { Activity, Shield, Trash2 } from 'lucide-react';
import type {
  ProviderBlueprint,
  ProviderHttpTestResult,
  ProviderId,
  TenantApplication,
  VaultEnvironment,
  VaultKeySummary,
  VaultKeyVerificationStatus,
  VaultSecurityStatus,
} from '../../shared/contracts.ts';
import { aurixApi } from '../lib/api.ts';

interface VaultSectionProps {
  providers: ProviderBlueprint[];
  keys: VaultKeySummary[];
  tenants: TenantApplication[];
  initialProviderId: ProviderId;
  vaultPersistenceMode: 'persistent_encrypted' | 'ephemeral_memory';
  security: VaultSecurityStatus;
  onKeysChanged: () => Promise<void>;
  onNavigateSecurity: () => void;
}

const KEY_STATUS_LABELS: Record<VaultKeyVerificationStatus, string> = {
  stored_unverified: 'Armazenada · não testada',
  verified_ok: 'Verificada (HTTP 200)',
  rate_limited: 'Limite atingido (HTTP 429)',
  verification_failed: 'Falha na verificação',
};

export function VaultSection({
  providers,
  keys,
  tenants,
  initialProviderId,
  vaultPersistenceMode,
  security,
  onKeysChanged,
  onNavigateSecurity,
}: VaultSectionProps) {
  const isLocked = security.lockState === 'locked';
  const [providerId, setProviderId] = useState<ProviderId>(initialProviderId);
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [secondaryCredential, setSecondaryCredential] = useState('');
  const [scopeAppId, setScopeAppId] = useState('global');
  const [environment, setEnvironment] = useState<VaultEnvironment>('development');
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [lastKeyTest, setLastKeyTest] = useState<ProviderHttpTestResult | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const selectedProvider = providers.find((p) => p.id === providerId);
  const needsSecondary = selectedProvider?.requiredFields.some(
    (f) => f.key === 'secondaryCredential' && f.required,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setSubmitting(true);

    try {
      await aurixApi.registerVaultKey({
        providerId,
        label,
        apiKey,
        secondaryCredential: secondaryCredential || undefined,
        scopeAppId,
        environment,
      });
      setLabel('');
      setApiKey('');
      setSecondaryCredential('');
      setFeedback({
        type: 'ok',
        text: 'Chave criptografada e armazenada no servidor. O segredo completo não permanece no navegador.',
      });
      await onKeysChanged();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao registrar chave.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestKey(item: VaultKeySummary) {
    setTestingId(item.id);
    setFeedback(null);
    setLastKeyTest(null);
    try {
      const { result } = await aurixApi.testProvider(item.providerId, {
        keyId: item.id,
      });
      setLastKeyTest(result);
      await onKeysChanged();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao testar chave.',
      });
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id: string) {
    setRemovingId(id);
    setFeedback(null);
    try {
      await aurixApi.deleteVaultKey(id);
      await onKeysChanged();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao remover chave.',
      });
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-[#1E2028] pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#F4F1EA]">
            Cofre Seguro de Chaves API
          </h2>
          <p className="mt-1 text-sm text-[#A6A298] max-w-2xl">
            As credenciais enviadas são cifradas imediatamente no backend com AES-256-GCM. Apenas metadados mascarados retornam ao painel administrativo.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-[#C8C3B8]">
          <Shield className="w-4 h-4 text-[#D4AF37]" />
          <span>{security.statusSummary}</span>
        </div>
      </div>

      {isLocked && (
        <div className="rounded-xl bg-[#211215] border border-[#6E2A32] px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="space-y-1">
            <p className="font-semibold text-[#F5B8BE]">
              Cofre bloqueado após inicialização
            </p>
            <p className="text-[#E0B8BC]">
              As chaves existentes estão preservadas e criptografadas em disco. Desbloqueie o cofre com a chave mestra para cadastrar, testar ou remover credenciais.
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateSecurity}
            className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070709] font-semibold hover:bg-[#E2C04D] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Desbloquear em Segurança e Cofre
          </button>
        </div>
      )}

      {!isLocked && vaultPersistenceMode === 'ephemeral_memory' && (
        <div className="rounded-xl bg-[#111217] border border-[#D4AF37]/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-[#C8C3B8]">
          <div className="space-y-1">
            <p className="font-medium text-[#D4AF37]">
              Modo memória temporária ativo
            </p>
            <p className="leading-relaxed text-[#A6A298]">
              As chaves cadastradas agora ficam na memória RAM do servidor. Defina uma chave mestra na seção Segurança e Cofre para gravar e preservar automaticamente suas chaves em disco com AES-256-GCM.
            </p>
          </div>
          <button
            type="button"
            onClick={onNavigateSecurity}
            className="px-4 py-2 rounded-lg border border-[#D4AF37]/40 text-[#D4AF37] font-medium hover:bg-[#D4AF37] hover:text-[#070709] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Configurar chave mestra
          </button>
        </div>
      )}

      {lastKeyTest && (
        <div
          className={`rounded-xl px-5 py-4 border text-xs space-y-1.5 ${
            lastKeyTest.ok
              ? 'bg-[#121710] border-[#425229] text-[#DCE6B8]'
              : 'bg-[#211215] border-[#6E2A32] text-[#F5B8BE]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums">
            <span>
              Teste HTTP · {lastKeyTest.providerId} ({lastKeyTest.keyLabel}) · HTTP{' '}
              {lastKeyTest.httpStatus ?? 'N/A'} {lastKeyTest.httpStatusText}
            </span>
            <span>{lastKeyTest.latencyMs} ms</span>
          </div>
          <p className="text-[#C8C3B8]">
            {lastKeyTest.ok
              ? `Modelo ${lastKeyTest.model} respondeu: ${lastKeyTest.responsePreview}`
              : `${lastKeyTest.errorCategory}: ${lastKeyTest.errorDetail}`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSubmit}
          className="xl:col-span-5 bg-[#0D0E12] border border-[#22252F] rounded-xl p-6 space-y-4"
        >
          <h3 className="text-base font-semibold text-[#F4F1EA]">
            Cadastrar credencial no cofre
          </h3>

          <div>
            <label htmlFor="vault-provider" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
              Provedor de IA
            </label>
            <select
              id="vault-provider"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value as ProviderId)}
              className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="vault-label" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
              Rótulo identificador
            </label>
            <input
              id="vault-label"
              type="text"
              required
              minLength={2}
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex.: Conta principal gratuita"
              className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] placeholder:text-[#66635C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            />
          </div>

          <div>
            <label htmlFor="vault-apikey" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
              {selectedProvider?.requiredFields[0]?.label || 'Chave API'}
            </label>
            <input
              id="vault-apikey"
              type="password"
              required
              minLength={8}
              maxLength={512}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              placeholder={selectedProvider?.requiredFields[0]?.placeholder || 'Cole sua chave real'}
              className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm font-mono text-[#F4F1EA] placeholder:font-sans placeholder:text-[#66635C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            />
          </div>

          {needsSecondary && (
            <div>
              <label htmlFor="vault-secondary" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
                Cloudflare Account ID
              </label>
              <input
                id="vault-secondary"
                type="password"
                required
                value={secondaryCredential}
                onChange={(e) => setSecondaryCredential(e.target.value)}
                autoComplete="off"
                placeholder="Informe o Account ID da sua conta Cloudflare"
                className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm font-mono text-[#F4F1EA] placeholder:font-sans placeholder:text-[#66635C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="vault-env" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
                Ambiente
              </label>
              <select
                id="vault-env"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as VaultEnvironment)}
                className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              >
                <option value="development">Desenvolvimento</option>
                <option value="staging">Homologação</option>
                <option value="production">Produção</option>
              </select>
            </div>

            <div>
              <label htmlFor="vault-scope" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
                Escopo de aplicativo
              </label>
              <select
                id="vault-scope"
                value={scopeAppId}
                onChange={(e) => setScopeAppId(e.target.value)}
                className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              >
                <option value="global">Global (plataforma)</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {feedback && (
            <div
              className={`rounded-lg px-3.5 py-2.5 text-xs border ${
                feedback.type === 'ok'
                  ? 'bg-[#151811] border-[#4A5328] text-[#D7E0AE]'
                  : 'bg-[#2A1215] border-[#7F2932] text-[#F5B8BE]'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || isLocked}
            className="w-full py-2.5 px-4 rounded-lg bg-[#D4AF37] text-[#070709] text-sm font-semibold hover:bg-[#E2C04D] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
          >
            {isLocked
              ? 'Cofre bloqueado'
              : submitting
                ? 'Criptografando no servidor...'
                : 'Salvar chave no cofre'}
          </button>
        </form>

        <section className="xl:col-span-7 bg-[#0D0E12] border border-[#22252F] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1E2028] flex items-center justify-between">
            <h3 className="text-base font-semibold text-[#F4F1EA]">
              Chaves registradas (visualização mascarada)
            </h3>
            <span className="text-xs font-mono tabular-nums text-[#9E9A90]">
              {keys.length} registro(s)
            </span>
          </div>

          {keys.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium text-[#F4F1EA]">
                Nenhuma chave API cadastrada
              </p>
              <p className="mt-1.5 text-xs text-[#8E8A80] max-w-md mx-auto leading-relaxed">
                O cofre inicia vazio por segurança e não utiliza chaves fictícias. Utilize o formulário ao lado quando desejar armazenar suas credenciais reais.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1E2028] text-xs text-[#8E8A80]">
                    <th className="py-3 px-6 font-medium">Provedor / Rótulo</th>
                    <th className="py-3 px-4 font-medium">Máscara</th>
                    <th className="py-3 px-4 font-medium">Status HTTP</th>
                    <th className="py-3 px-6 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1A1C24] text-sm">
                  {keys.map((item) => (
                    <tr key={item.id} className="hover:bg-[#111319] transition-colors">
                      <td className="py-3.5 px-6">
                        <p className="font-medium text-[#F4F1EA]">{item.label}</p>
                        <p className="text-xs text-[#8E8A80] font-mono mt-0.5">
                          {item.providerId} · {item.environment} · {item.scopeAppId}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-[#D4AF37]">
                        {item.maskedPreview}
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <p
                          className={
                            item.decryptable === false
                              ? 'text-[#F5B8BE]'
                              : item.status === 'verified_ok'
                                ? 'text-[#D4AF37]'
                                : item.status === 'stored_unverified'
                                  ? 'text-[#9E9A90]'
                                  : 'text-[#F5B8BE]'
                          }
                        >
                          {item.decryptable === false
                            ? 'Incompatível com AURIX_VAULT_SECRET atual'
                            : KEY_STATUS_LABELS[item.status]}
                        </p>
                        <p className="text-[#7D7970] mt-0.5 max-w-xs truncate" title={item.statusNote}>
                          {item.statusNote}
                        </p>
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={testingId === item.id || item.decryptable === false || isLocked}
                            onClick={() => handleTestKey(item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#D4AF37]/40 text-xs text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#070709] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <Activity className="w-3.5 h-3.5" />
                            <span>{testingId === item.id ? 'Testando...' : 'Testar HTTP'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={removingId === item.id || isLocked}
                            onClick={() => handleDelete(item.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#2C2F3A] text-xs text-[#C8C3B8] hover:border-[#7F2932] hover:text-[#F5B8BE] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{removingId === item.id ? 'Removendo...' : 'Remover'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
