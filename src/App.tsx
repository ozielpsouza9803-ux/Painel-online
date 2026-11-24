import { useCallback, useEffect, useState } from 'react';
import {
  Blocks,
  Bot,
  Compass,
  Cpu,
  KeyRound,
  Layers,
  LogOut,
  Menu,
  Shield,
  X,
} from 'lucide-react';
import type {
  AgentBlueprint,
  OperationalModuleContract,
  PlatformOverview,
  ProviderBlueprint,
  ProviderHttpTestResult,
  ProviderId,
  TenantApplication,
  VaultKeySummary,
  VaultSecurityStatus,
} from '../shared/contracts.ts';
import {
  aurixApi,
  getAuthToken,
  setAuthToken,
  type AuthStatusResponse,
} from './lib/api.ts';
import { AuthGate } from './components/AuthGate.tsx';
import { AurixLogo } from './components/AurixLogo.tsx';
import { OverviewSection } from './components/OverviewSection.tsx';
import { ProvidersSection } from './components/ProvidersSection.tsx';
import { VaultSection } from './components/VaultSection.tsx';
import { SecurityVaultSection } from './components/SecurityVaultSection.tsx';
import { AgentsSection } from './components/AgentsSection.tsx';
import { ModulesSection } from './components/ModulesSection.tsx';
import { TenantsSection } from './components/TenantsSection.tsx';

type NavTab =
  | 'overview'
  | 'providers'
  | 'vault'
  | 'security'
  | 'agents'
  | 'modules'
  | 'tenants';

const NAV_ITEMS: { id: NavTab; label: string; icon: typeof Compass }[] = [
  { id: 'overview', label: 'Arquitetura', icon: Compass },
  { id: 'providers', label: 'Provedores IA', icon: Cpu },
  { id: 'vault', label: 'Cofre de Chaves', icon: KeyRound },
  { id: 'security', label: 'Segurança e Cofre', icon: Shield },
  { id: 'agents', label: 'Agentes Modulares', icon: Bot },
  { id: 'modules', label: 'Módulos Operacionais', icon: Blocks },
  { id: 'tenants', label: 'Aplicativos & Isolamento', icon: Layers },
];

const TAB_TITLES: Record<NavTab, string> = {
  overview: 'AURIX AI / Arquitetura & Plano',
  providers: 'AURIX AI / Central de Provedores',
  vault: 'AURIX AI / Cofre Seguro de Chaves',
  security: 'AURIX AI / Segurança e Cofre',
  agents: 'AURIX AI / Agentes Especializados',
  modules: 'AURIX AI / Módulos Operacionais',
  tenants: 'AURIX AI / Aplicativos & Permissões',
};

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean>(Boolean(getAuthToken()));
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [selectedVaultProvider, setSelectedVaultProvider] = useState<ProviderId>('gemini');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [providers, setProviders] = useState<ProviderBlueprint[]>([]);
  const [vaultPersistenceMode, setVaultPersistenceMode] = useState<
    'persistent_encrypted' | 'ephemeral_memory'
  >('ephemeral_memory');
  const [vaultKeys, setVaultKeys] = useState<VaultKeySummary[]>([]);
  const [vaultSecurity, setVaultSecurity] = useState<VaultSecurityStatus | null>(null);
  const [providerTests, setProviderTests] = useState<ProviderHttpTestResult[]>([]);
  const [agents, setAgents] = useState<AgentBlueprint[]>([]);
  const [modules, setModules] = useState<OperationalModuleContract[]>([]);
  const [tenants, setTenants] = useState<TenantApplication[]>([]);

  const checkAuth = useCallback(async () => {
    try {
      const status = await aurixApi.getAuthStatus();
      setAuthStatus(status);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Falha ao consultar servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ovRes = await aurixApi.getOverview();
      setOverview(ovRes);
      setVaultPersistenceMode(ovRes.vaultPersistenceMode);
      setVaultSecurity(ovRes.vaultSecurity);

      const [provRes, testsRes, keysRes, agRes, modRes, tenRes] = await Promise.all([
        aurixApi.getProviders().catch(() => null),
        aurixApi.getProviderTests(),
        aurixApi.getVaultKeys().catch(() => null),
        aurixApi.getAgents().catch(() => null),
        aurixApi.getModules(),
        aurixApi.getTenants().catch(() => null),
      ]);

      if (provRes) {
        setProviders(provRes.providers);
      }
      setProviderTests(testsRes.tests);
      if (keysRes) {
        setVaultKeys(keysRes.keys);
        setVaultSecurity(keysRes.vaultSecurity);
      } else {
        setVaultKeys([]);
      }
      if (agRes) setAgents(agRes.agents);
      setModules(modRes.modules);
      if (tenRes) setTenants(tenRes.tenants);
    } catch (err) {
      if (!getAuthToken()) {
        setAuthenticated(false);
        await checkAuth();
        return;
      }
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar dados do console.');
    } finally {
      setLoading(false);
    }
  }, [checkAuth]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (authenticated) {
      void loadWorkspaceData();
    }
  }, [authenticated, loadWorkspaceData]);

  async function handleLogout() {
    try {
      await aurixApi.logout();
    } catch {
      // Clear local memory token regardless of network outcome
    }
    setAuthToken(null);
    setAuthenticated(false);
    void checkAuth();
  }

  function handleOpenVaultForProvider(providerId: ProviderId) {
    setSelectedVaultProvider(providerId);
    setActiveTab('vault');
    setMobileMenuOpen(false);
  }

  function handleSelectTab(tab: NavTab) {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  }

  if (loading && !authenticated && !authStatus) {
    return (
      <div className="min-h-screen bg-[#070709] text-[#A6A298] flex items-center justify-center text-sm">
        Inicializando console AURIX AI...
      </div>
    );
  }

  if (!authenticated) {
    if (!authStatus) {
      return (
        <div className="min-h-screen bg-[#070709] text-[#F5B8BE] flex items-center justify-center px-6 text-sm">
          {loadError || 'Não foi possível conectar ao servidor.'}
        </div>
      );
    }
    return (
      <AuthGate
        authStatus={authStatus}
        onAuthenticated={() => setAuthenticated(true)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#070709] text-[#F4F1EA] flex flex-col lg:flex-row">
      {/* Sidebar Desktop + Mobile Drawer */}
      <aside
        className={`${
          mobileMenuOpen ? 'fixed inset-0 z-40 flex' : 'hidden'
        } lg:static lg:flex lg:w-[264px] lg:shrink-0 flex-col bg-[#0B0C10] border-r border-[#1E2028]`}
      >
        <div className="h-16 px-6 flex items-center justify-between border-b border-[#1E2028]">
          <AurixLogo size="sm" showText={true} />
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-2 text-[#A6A298] hover:text-[#F4F1EA] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="Navegação principal" className="flex-1 px-3 py-5 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#161820] text-[#D4AF37] border border-[#D4AF37]/30'
                    : 'text-[#A6A298] hover:text-[#F4F1EA] hover:bg-[#111319] border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#1E2028]">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg border border-[#252834] text-xs font-medium text-[#A6A298] hover:text-[#F4F1EA] hover:border-[#3A3E4E] transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Encerrar sessão</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-6 border-b border-[#1E2028] bg-[#090A0D] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Abrir navegação"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-[#A6A298] hover:text-[#F4F1EA] cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-[#C8C3B8] truncate">
              {TAB_TITLES[activeTab]}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleSelectTab('vault')}
              className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070709] text-xs font-semibold hover:bg-[#E2C04D] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Cadastrar chave API
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-[1320px] w-full mx-auto">
          {loadError && (
            <div className="mb-6 rounded-xl bg-[#2A1215] border border-[#7F2932] px-4 py-3 text-sm text-[#F5B8BE]">
              {loadError}
            </div>
          )}

          {loading && !overview ? (
            <div className="space-y-4">
              <div className="h-24 rounded-xl bg-[#0D0E12] border border-[#22252F]" />
              <div className="h-64 rounded-xl bg-[#0D0E12] border border-[#22252F]" />
            </div>
          ) : (
            <>
              {activeTab === 'overview' && overview && (
                <OverviewSection
                  overview={overview}
                  onNavigate={(tab) => handleSelectTab(tab)}
                />
              )}
              {activeTab === 'providers' && (
                <ProvidersSection
                  providers={providers}
                  keys={vaultKeys}
                  testHistory={providerTests}
                  vaultPersistenceMode={vaultPersistenceMode}
                  onAddKeyForProvider={handleOpenVaultForProvider}
                  onTestCompleted={loadWorkspaceData}
                />
              )}
              {activeTab === 'vault' && vaultSecurity && (
                <VaultSection
                  key={selectedVaultProvider}
                  providers={providers}
                  keys={vaultKeys}
                  tenants={tenants}
                  initialProviderId={selectedVaultProvider}
                  vaultPersistenceMode={vaultPersistenceMode}
                  security={vaultSecurity}
                  onKeysChanged={loadWorkspaceData}
                  onNavigateSecurity={() => handleSelectTab('security')}
                />
              )}
              {activeTab === 'security' && vaultSecurity && (
                <SecurityVaultSection
                  security={vaultSecurity}
                  onSecurityChanged={loadWorkspaceData}
                  onNavigateVault={() => handleSelectTab('vault')}
                />
              )}
              {activeTab === 'agents' && (
                <AgentsSection
                  agents={agents}
                  providers={providers}
                  modules={modules}
                  onAgentsChanged={loadWorkspaceData}
                />
              )}
              {activeTab === 'modules' && <ModulesSection modules={modules} />}
              {activeTab === 'tenants' && (
                <TenantsSection
                  tenants={tenants}
                  providers={providers}
                  modules={modules}
                  onTenantsChanged={loadWorkspaceData}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
