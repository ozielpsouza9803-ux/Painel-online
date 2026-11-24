import { useState, type FormEvent } from 'react';
import { Layers, Plus, Trash2 } from 'lucide-react';
import type {
  ModuleId,
  OperationalModuleContract,
  PermissionScope,
  ProviderBlueprint,
  ProviderId,
  TenantApplication,
} from '../../shared/contracts.ts';
import { aurixApi } from '../lib/api.ts';

interface TenantsSectionProps {
  tenants: TenantApplication[];
  providers: ProviderBlueprint[];
  modules: OperationalModuleContract[];
  onTenantsChanged: () => Promise<void>;
}

const ALL_PERMISSIONS: { id: PermissionScope; label: string }[] = [
  { id: 'agents:invoke', label: 'Executar agentes (Etapa 2)' },
  { id: 'agents:configure', label: 'Configurar prompts do tenant' },
  { id: 'vault:read_meta', label: 'Ler metadados do cofre' },
  { id: 'module:atendimento', label: 'Módulo Atendimento' },
  { id: 'module:produtos', label: 'Módulo Produtos' },
  { id: 'module:monitoramento_precos', label: 'Módulo Monitoramento de Preços' },
  { id: 'module:agendamentos', label: 'Módulo Agendamentos' },
  { id: 'module:contingencia', label: 'Módulo Contingência' },
];

export function TenantsSection({
  tenants,
  providers,
  modules,
  onTenantsChanged,
}: TenantsSectionProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [allowedProviders, setAllowedProviders] = useState<ProviderId[]>(['gemini', 'groq']);
  const [enabledModules, setEnabledModules] = useState<ModuleId[]>([
    'atendimento',
    'contingencia',
  ]);
  const [permissions, setPermissions] = useState<PermissionScope[]>([
    'agents:invoke',
    'module:atendimento',
    'module:contingencia',
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleItem<T extends string>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await aurixApi.createTenant({
        name,
        description,
        allowedProviders,
        enabledModules,
        permissions,
      });
      setName('');
      setDescription('');
      setShowCreate(false);
      await onTenantsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar aplicativo.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTogglePermission(tenant: TenantApplication, scope: PermissionScope) {
    setBusyId(tenant.id);
    try {
      const nextPermissions = toggleItem(tenant.permissions, scope);
      await aurixApi.updateTenant(tenant.id, { permissions: nextPermissions });
      await onTenantsChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleStatus(tenant: TenantApplication) {
    setBusyId(tenant.id);
    try {
      await aurixApi.updateTenant(tenant.id, {
        status: tenant.status === 'isolated_ready' ? 'suspended' : 'isolated_ready',
      });
      await onTenantsChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      await aurixApi.deleteTenant(id);
      await onTenantsChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#1E2028] pb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#F4F1EA]">
            Aplicativos & Isolamento Multi-Tenant
          </h2>
          <p className="mt-1 text-sm text-[#A6A298] max-w-2xl">
            Cada aplicativo registrado recebe namespace próprio, chave de partição de dados isolada e matriz explícita de permissões. Nenhuma integração externa pré-conectada nesta etapa.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070709] text-xs font-semibold hover:bg-[#E2C04D] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{showCreate ? 'Fechar formulário' : 'Registrar aplicativo'}</span>
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="bg-[#0D0E12] border border-[#D4AF37]/30 rounded-xl p-6 space-y-5"
        >
          <h3 className="text-base font-semibold text-[#F4F1EA]">
            Novo aplicativo isolado (sandbox arquitetural)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tenant-name" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
                Nome do aplicativo
              </label>
              <input
                id="tenant-name"
                type="text"
                required
                minLength={2}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: App Teste Interno"
                className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              />
            </div>

            <div>
              <label htmlFor="tenant-desc" className="block text-xs font-medium text-[#C8C3B8] mb-1.5">
                Finalidade do aplicativo
              </label>
              <input
                id="tenant-desc"
                type="text"
                required
                minLength={4}
                maxLength={200}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descreva o contexto e os limites do tenant"
                className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
            <div>
              <p className="text-xs font-medium text-[#C8C3B8] mb-2">Provedores permitidos</p>
              <div className="space-y-2">
                {providers.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs text-[#A6A298] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowedProviders.includes(p.id)}
                      onChange={() => setAllowedProviders((prev) => toggleItem(prev, p.id))}
                      className="accent-[#D4AF37]"
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-[#C8C3B8] mb-2">Módulos habilitados</p>
              <div className="space-y-2">
                {modules.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-xs text-[#A6A298] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledModules.includes(m.id)}
                      onChange={() => setEnabledModules((prev) => toggleItem(prev, m.id))}
                      className="accent-[#D4AF37]"
                    />
                    <span>{m.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-[#C8C3B8] mb-2">Escopos de permissão</p>
              <div className="space-y-2">
                {ALL_PERMISSIONS.map((perm) => (
                  <label key={perm.id} className="flex items-center gap-2 text-xs text-[#A6A298] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions.includes(perm.id)}
                      onChange={() => setPermissions((prev) => toggleItem(prev, perm.id))}
                      className="accent-[#D4AF37]"
                    />
                    <span>{perm.label}</span>
                  </label>
                ))}
              </div>
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
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg border border-[#2C2F3A] text-xs font-medium text-[#C8C3B8] hover:text-[#F4F1EA] cursor-pointer whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070709] text-xs font-semibold hover:bg-[#E2C04D] disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              {submitting ? 'Criando namespace...' : 'Criar aplicativo isolado'}
            </button>
          </div>
        </form>
      )}

      {tenants.length === 0 ? (
        <div className="bg-[#0D0E12] border border-[#22252F] rounded-xl px-6 py-14 text-center">
          <div className="w-11 h-11 rounded-lg bg-[#15171E] border border-[#D4AF37]/30 text-[#D4AF37] flex items-center justify-center mx-auto">
            <Layers className="w-5 h-5" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-[#F4F1EA]">
            Nenhum aplicativo conectado nesta etapa
          </h3>
          <p className="mt-2 text-sm text-[#8E8A80] max-w-lg mx-auto leading-relaxed">
            Por diretriz da Etapa 1, nenhum sistema externo (incluindo o SALÃO LUXE) está conectado. Você pode registrar um aplicativo sandbox acima para validar o particionamento de namespaces e permissões.
          </p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#D4AF37]/40 text-xs font-medium text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#070709] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Registrar aplicativo sandbox</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {tenants.map((tenant) => (
            <article
              key={tenant.id}
              className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-6 space-y-5"
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-[#1A1C24]">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#8E8A80]">
                    <span className="font-mono text-[#D4AF37]">{tenant.isolationNamespace}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{tenant.dataPartitionKey}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {tenant.status === 'isolated_ready' ? 'Isolamento ativo' : 'Suspenso'}
                    </span>
                  </div>
                  <h3 className="mt-1 text-lg font-semibold text-[#F4F1EA]">{tenant.name}</h3>
                  <p className="mt-1 text-sm text-[#A6A298]">{tenant.description}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === tenant.id}
                    onClick={() => handleToggleStatus(tenant)}
                    className="px-3.5 py-1.5 rounded-md border border-[#2C2F3A] text-xs font-medium text-[#C8C3B8] hover:border-[#D4AF37]/50 hover:text-[#F4F1EA] cursor-pointer whitespace-nowrap"
                  >
                    {tenant.status === 'isolated_ready' ? 'Suspender' : 'Reativar'}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === tenant.id}
                    onClick={() => handleDelete(tenant.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#2C2F3A] text-xs text-[#C8C3B8] hover:border-[#7F2932] hover:text-[#F5B8BE] cursor-pointer whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remover</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
                <div className="space-y-2">
                  <p className="text-[#7D7970]">
                    Provedores autorizados:{' '}
                    <span className="font-mono text-[#C8C3B8]">
                      {tenant.allowedProviders.join(', ') || 'Nenhum'}
                    </span>
                  </p>
                  <p className="text-[#7D7970]">
                    Módulos autorizados:{' '}
                    <span className="font-mono text-[#C8C3B8]">
                      {tenant.enabledModules.join(', ') || 'Nenhum'}
                    </span>
                  </p>
                </div>

                <div>
                  <p className="text-[#7D7970] mb-2">Matriz de permissões granulares:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ALL_PERMISSIONS.map((perm) => (
                      <label
                        key={perm.id}
                        className="flex items-center gap-2 text-xs text-[#A6A298] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          disabled={busyId === tenant.id}
                          checked={tenant.permissions.includes(perm.id)}
                          onChange={() => handleTogglePermission(tenant, perm.id)}
                          className="accent-[#D4AF37]"
                        />
                        <span className="truncate">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
