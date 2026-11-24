import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
  Shield,
  Unlock,
  Upload,
} from 'lucide-react';
import type {
  EncryptedVaultBackupBundle,
  ProductionReadinessReport,
  SecurityAuditEntry,
  VaultSecurityStatus,
} from '../../shared/contracts.ts';
import { aurixApi } from '../lib/api.ts';

interface SecurityVaultSectionProps {
  security: VaultSecurityStatus;
  onSecurityChanged: () => Promise<void>;
  onNavigateVault: () => void;
}

export function SecurityVaultSection({
  security,
  onSecurityChanged,
  onNavigateVault,
}: SecurityVaultSectionProps) {
  const [masterKey, setMasterKey] = useState('');
  const [confirmMasterKey, setConfirmMasterKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [currentRotateKey, setCurrentRotateKey] = useState('');
  const [newRotateKey, setNewRotateKey] = useState('');
  const [confirmRotateKey, setConfirmRotateKey] = useState('');
  const [rotating, setRotating] = useState(false);

  const [backupExportPassphrase, setBackupExportPassphrase] = useState('');
  const [exportingBackup, setExportingBackup] = useState(false);

  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoreBundle, setRestoreBundle] = useState<EncryptedVaultBackupBundle | null>(null);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restoringBackup, setRestoringBackup] = useState(false);

  const [auditEntries, setAuditEntries] = useState<SecurityAuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [readiness, setReadiness] = useState<ProductionReadinessReport | null>(null);

  const loadAudit = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const [auditRes, readyRes] = await Promise.all([
        aurixApi.getSecurityAuditLog(),
        aurixApi.getSecurityReadiness().catch(() => null),
      ]);
      setAuditEntries(auditRes.entries);
      if (readyRes) {
        setReadiness(readyRes.readiness);
      }
    } catch {
      // Keep current audit entries if request fails
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit, security.lockState, security.storedKeysCount]);

  const isFirstTimeSetup =
    security.persistenceKind === 'ephemeral_memory' && !security.hasMasterKeyVerifier;
  const needsUnlock = security.lockState === 'locked';
  const canLock =
    security.lockState === 'unlocked' && security.masterKeySource === 'runtime_master_key';
  const canRotate =
    security.persistenceKind === 'persistent' &&
    security.hasMasterKeyVerifier &&
    security.masterKeySource !== 'env';

  async function handleUnlockOrSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (isFirstTimeSetup && masterKey !== confirmMasterKey) {
      setFeedback({ type: 'err', text: 'As chaves mestras informadas não coincidem.' });
      return;
    }

    const secretToSend = masterKey;
    setMasterKey('');
    setConfirmMasterKey('');
    setSubmitting(true);

    try {
      const res = await aurixApi.unlockVault(secretToSend);
      const migrationMsg =
        res.migratedCount > 0
          ? ` ${res.migratedCount} chave(s) foram migradas e re-cifradas com salt aleatório e AES-256-GCM + AAD.`
          : '';
      setFeedback({
        type: 'ok',
        text: `${res.security.statusSummary}.${migrationMsg}`,
      });
      await onSecurityChanged();
      await loadAudit();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao desbloquear o cofre.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLock() {
    setFeedback(null);
    setLocking(true);
    try {
      const res = await aurixApi.lockVault();
      setFeedback({
        type: 'ok',
        text: res.security.statusSummary,
      });
      await onSecurityChanged();
      await loadAudit();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao bloquear o cofre.',
      });
    } finally {
      setLocking(false);
    }
  }

  async function handleRotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (newRotateKey !== confirmRotateKey) {
      setFeedback({ type: 'err', text: 'A confirmação da nova chave mestra não coincide.' });
      return;
    }

    const cur = currentRotateKey;
    const next = newRotateKey;
    setCurrentRotateKey('');
    setNewRotateKey('');
    setConfirmRotateKey('');
    setRotating(true);

    try {
      const res = await aurixApi.rotateMasterKey(cur, next);
      setFeedback({
        type: 'ok',
        text: `Chave mestra rotacionada com sucesso. ${res.rotatedRecordsCount} registro(s) re-cifrados em disco.`,
      });
      await onSecurityChanged();
      await loadAudit();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao rotacionar chave mestra.',
      });
    } finally {
      setRotating(false);
    }
  }

  async function handleExportBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const pass = backupExportPassphrase;
    setBackupExportPassphrase('');
    setExportingBackup(true);

    try {
      const { bundle } = await aurixApi.exportVaultBackup(pass);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `aurix-vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setFeedback({
        type: 'ok',
        text: `Backup cifrado exportado (${bundle.recordCount} registro(s)). Guarde o arquivo e a senha em local seguro.`,
      });
      await loadAudit();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao exportar backup cifrado.',
      });
    } finally {
      setExportingBackup(false);
    }
  }

  async function handleBackupFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFeedback(null);
    const file = event.target.files?.[0];
    if (!file) {
      setRestoreBundle(null);
      setRestoreFileName('');
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EncryptedVaultBackupBundle;
      if (parsed.format !== 'aurix-vault-backup-v1') {
        throw new Error('Formato de backup inválido.');
      }
      setRestoreBundle(parsed);
      setRestoreFileName(file.name);
    } catch {
      setRestoreBundle(null);
      setRestoreFileName('');
      setFeedback({
        type: 'err',
        text: 'O arquivo selecionado não é um backup válido aurix-vault-backup-v1.',
      });
    }
  }

  async function handleRestoreBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (!restoreBundle) {
      setFeedback({ type: 'err', text: 'Selecione um arquivo de backup cifrado antes de restaurar.' });
      return;
    }

    const pass = restorePassphrase;
    setRestorePassphrase('');
    setRestoringBackup(true);

    try {
      const res = await aurixApi.restoreVaultBackup(restoreBundle, pass);
      setRestoreBundle(null);
      setRestoreFileName('');
      setFeedback({
        type: 'ok',
        text: `Backup restaurado: ${res.restoredCount} chave(s) re-cifradas sob a chave mestra ativa (${res.totalKeys} no total).`,
      });
      await onSecurityChanged();
      await loadAudit();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao restaurar backup cifrado.',
      });
    } finally {
      setRestoringBackup(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-[#1E2028] pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#F4F1EA]">
            Segurança e Cofre
          </h2>
          <p className="mt-1 text-sm text-[#A6A298] max-w-2xl">
            Gerencie a chave mestra AES-256-GCM + AAD, bloqueio automático por inatividade, rotação criptográfica e backups cifrados diretamente no servidor.
          </p>
        </div>

        <button
          type="button"
          onClick={onNavigateVault}
          className="px-4 py-2 rounded-lg border border-[#2C2F3A] text-xs font-medium text-[#C8C3B8] hover:border-[#D4AF37]/50 hover:text-[#F4F1EA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          Ir para cadastro de chaves API
        </button>
      </div>

      {security.integrityStatus === 'corrupted' && (
        <div className="rounded-xl bg-[#2A1215] border border-[#7F2932] px-5 py-4 flex items-start gap-3 text-xs text-[#F5B8BE]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">
              Falha de integridade detectada nos arquivos do cofre (modo fail-closed ativo)
            </p>
            <p className="text-[#E0B8BC]">
              {security.integrityError ||
                'O arquivo em disco não foi sobrescrito para preservar dados existentes. Restaure um backup cifrado após desbloquear ou verifique o disco no servidor.'}
            </p>
          </div>
        </div>
      )}

      {/* Real State Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-5">
          <p className="text-xs text-[#8E8A80]">Estado de Acesso</p>
          <p
            className={`mt-2 text-lg font-semibold ${
              security.lockState === 'unlocked' ? 'text-[#D4AF37]' : 'text-[#F5B8BE]'
            }`}
          >
            {security.lockState === 'unlocked' ? 'Desbloqueado' : 'Bloqueado'}
          </p>
          <p className="mt-1.5 text-xs text-[#7D7970]">
            {security.lockState === 'unlocked'
              ? `Auto-lock após ${security.autoLockMinutes} min sem atividade`
              : 'Aguardando chave mestra na sessão atual'}
          </p>
        </div>

        <div className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-5">
          <p className="text-xs text-[#8E8A80]">Modo de Persistência</p>
          <p className="mt-2 text-lg font-semibold text-[#F4F1EA]">
            {security.persistenceKind === 'persistent' ? 'Persistente' : 'Memória temporária'}
          </p>
          <p className="mt-1.5 text-xs text-[#7D7970]">
            {security.persistenceKind === 'persistent'
              ? 'AES-256-GCM + AAD gravado em .aurix-vault'
              : 'Somente RAM até definir chave mestra'}
          </p>
        </div>

        <div className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-5">
          <p className="text-xs text-[#8E8A80]">Origem da Chave Mestra</p>
          <p className="mt-2 text-lg font-semibold text-[#F4F1EA]">
            {security.masterKeySource === 'env'
              ? 'Variável de ambiente'
              : security.masterKeySource === 'runtime_master_key'
                ? 'Sessão do servidor'
                : 'Não ativa'}
          </p>
          <p className="mt-1.5 text-xs font-mono text-[#7D7970]">
            {security.masterKeySource === 'env'
              ? 'AURIX_VAULT_SECRET'
              : security.masterKeySource === 'runtime_master_key'
                ? 'Buffer scrypt em RAM'
                : 'Aguardando desbloqueio'}
          </p>
        </div>

        <div className="bg-[#0D0E12] border border-[#22252F] rounded-xl p-5">
          <p className="text-xs text-[#8E8A80]">Chaves no Cofre</p>
          <p className="mt-2 text-lg font-semibold font-mono tabular-nums text-[#F4F1EA]">
            {security.storedKeysCount} armazenada(s)
          </p>
          <p className="mt-1.5 text-xs font-mono tabular-nums text-[#7D7970]">
            {security.decryptableKeysCount} descriptografável(is) agora
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-lg px-4 py-3 text-xs border ${
            feedback.type === 'ok'
              ? 'bg-[#151811] border-[#4A5328] text-[#D7E0AE]'
              : 'bg-[#2A1215] border-[#7F2932] text-[#F5B8BE]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-6 bg-[#0D0E12] border border-[#22252F] rounded-xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#1E2028]">
            <div>
              <h3 className="text-base font-semibold text-[#F4F1EA]">
                {security.masterKeySource === 'env'
                  ? 'Cofre gerenciado por variável de ambiente'
                  : needsUnlock
                    ? 'Desbloquear cofre persistente'
                    : isFirstTimeSetup
                      ? 'Ativar persistência com chave mestra'
                      : 'Controle da chave mestra em memória'}
              </h3>
              <p className="mt-1 text-xs text-[#9E9A90] leading-relaxed">
                {security.statusSummary}
              </p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-[#15171E] border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] shrink-0">
              {needsUnlock ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </div>
          </div>

          {security.masterKeySource === 'env' ? (
            <div className="space-y-3 text-sm text-[#A6A298] leading-relaxed">
              <p>
                A variável <span className="font-mono text-[#F4F1EA]">AURIX_VAULT_SECRET</span> está configurada no servidor. O cofre opera em modo persistente desbloqueado automaticamente após reinicializações.
              </p>
              <p className="text-xs text-[#7D7970]">
                Arquivo cifrado em disco: <span className="font-mono">.aurix-vault/keys-vault.enc.json</span>
              </p>
            </div>
          ) : canLock ? (
            <div className="space-y-4">
              <p className="text-sm text-[#A6A298] leading-relaxed">
                O cofre está desbloqueado na memória do processo Node.js e todas as chaves são gravadas com AES-256-GCM + AAD no disco. O bloqueio automático ocorre após {security.autoLockMinutes} minutos de inatividade ou ao reiniciar o servidor.
              </p>
              {security.lastUnlockedAt && (
                <p className="text-xs font-mono tabular-nums text-[#7D7970]">
                  Desbloqueado em: {new Date(security.lastUnlockedAt).toLocaleString('pt-BR')}
                  {security.autoLockExpiresAt
                    ? ` · Expira sem uso em ${new Date(security.autoLockExpiresAt).toLocaleTimeString('pt-BR')}`
                    : ''}
                </p>
              )}
              <button
                type="button"
                disabled={locking}
                onClick={handleLock}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#D4AF37]/40 text-xs font-semibold text-[#D4AF37] hover:bg-[#D4AF37] hover:text-[#070709] disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{locking ? 'Bloqueando e limpando buffer...' : 'Bloquear cofre agora'}</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleUnlockOrSetup} className="space-y-4">
              <div>
                <label
                  htmlFor="vault-master-key"
                  className="block text-xs font-medium text-[#C8C3B8] mb-1.5"
                >
                  {isFirstTimeSetup
                    ? 'Definir chave mestra (mínimo 16 caracteres, sem repetição trivial)'
                    : 'Chave mestra do cofre'}
                </label>
                <input
                  id="vault-master-key"
                  type="password"
                  required
                  minLength={16}
                  maxLength={256}
                  value={masterKey}
                  onChange={(e) => setMasterKey(e.target.value)}
                  autoComplete="off"
                  placeholder="Digite sua chave mestra forte"
                  className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm font-mono text-[#F4F1EA] placeholder:font-sans placeholder:text-[#66635C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                />
              </div>

              {isFirstTimeSetup && (
                <div>
                  <label
                    htmlFor="vault-master-key-confirm"
                    className="block text-xs font-medium text-[#C8C3B8] mb-1.5"
                  >
                    Confirmar chave mestra
                  </label>
                  <input
                    id="vault-master-key-confirm"
                    type="password"
                    required
                    minLength={16}
                    maxLength={256}
                    value={confirmMasterKey}
                    onChange={(e) => setConfirmMasterKey(e.target.value)}
                    autoComplete="off"
                    placeholder="Repita a chave mestra"
                    className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2.5 text-sm font-mono text-[#F4F1EA] placeholder:font-sans placeholder:text-[#66635C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-[#D4AF37] text-[#070709] text-sm font-semibold hover:bg-[#E2C04D] disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                {submitting
                  ? 'Derivando chave com scrypt no servidor...'
                  : isFirstTimeSetup
                    ? 'Ativar persistência e desbloquear cofre'
                    : 'Desbloquear cofre'}
              </button>
            </form>
          )}
        </section>

        <section className="xl:col-span-6 bg-[#0D0E12] border border-[#22252F] rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 pb-4 border-b border-[#1E2028]">
            <Shield className="w-4 h-4 text-[#D4AF37]" />
            <h3 className="text-base font-semibold text-[#F4F1EA]">
              Garantias criptográficas e isolamento ativos
            </h3>
          </div>

          <ul className="space-y-3 text-sm text-[#A6A298] leading-relaxed">
            <li>
              <span className="text-[#F4F1EA] font-medium">Zero segredo no navegador:</span> a chave mestra digitada é enviada uma única vez via POST autenticado, limpa do estado React imediatamente e jamais gravada em localStorage ou sessionStorage.
            </li>
            <li>
              <span className="text-[#F4F1EA] font-medium">AES-256-GCM com AAD vinculado:</span> cada credencial vincula criptograficamente seu <span className="font-mono text-xs text-[#C8C3B8]">id</span>, provedor, escopo multiaplicativo e ambiente na tag GCM, impedindo adulteração em disco.
            </li>
            <li>
              <span className="text-[#F4F1EA] font-medium">Fail-closed e escrita atômica 0600:</span> arquivos corrompidos bloqueiam alterações sem sobrescrever dados; gravações usam mutex, <span className="font-mono text-xs text-[#C8C3B8]">O_EXCL</span> e <span className="font-mono text-xs text-[#C8C3B8]">fsync</span>.
            </li>
            <li>
              <span className="text-[#F4F1EA] font-medium">Proteção anti força bruta:</span> tentativas inválidas de login, desbloqueio ou rotação acionam atraso progressivo e bloqueio temporário por 15 minutos.
            </li>
          </ul>
        </section>
      </div>

      {/* Master Key Rotation + Encrypted Backup Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-6 bg-[#0D0E12] border border-[#22252F] rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2.5 pb-4 border-b border-[#1E2028]">
            <KeyRound className="w-4 h-4 text-[#D4AF37]" />
            <div>
              <h3 className="text-base font-semibold text-[#F4F1EA]">
                Rotação segura da chave mestra
              </h3>
              <p className="text-xs text-[#8E8A80]">
                Gera novo salt aleatório e re-cifra todas as credenciais em disco sem perda de dados.
              </p>
            </div>
          </div>

          {!canRotate ? (
            <p className="text-xs text-[#9E9A90] leading-relaxed">
              {security.masterKeySource === 'env'
                ? 'A rotação pela interface fica desabilitada enquanto AURIX_VAULT_SECRET estiver definida no ambiente.'
                : 'Ative o cofre persistente com uma chave mestra antes de utilizar a rotação.'}
            </p>
          ) : (
            <form onSubmit={handleRotate} className="space-y-3.5">
              <div>
                <label htmlFor="rotate-current" className="block text-xs font-medium text-[#C8C3B8] mb-1">
                  Chave mestra atual
                </label>
                <input
                  id="rotate-current"
                  type="password"
                  required
                  minLength={16}
                  maxLength={256}
                  value={currentRotateKey}
                  onChange={(e) => setCurrentRotateKey(e.target.value)}
                  autoComplete="off"
                  placeholder="Informe a chave atual"
                  className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2 text-sm font-mono text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rotate-new" className="block text-xs font-medium text-[#C8C3B8] mb-1">
                    Nova chave mestra
                  </label>
                  <input
                    id="rotate-new"
                    type="password"
                    required
                    minLength={16}
                    maxLength={256}
                    value={newRotateKey}
                    onChange={(e) => setNewRotateKey(e.target.value)}
                    autoComplete="off"
                    placeholder="Mínimo 16 caracteres"
                    className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2 text-sm font-mono text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                  />
                </div>
                <div>
                  <label htmlFor="rotate-confirm" className="block text-xs font-medium text-[#C8C3B8] mb-1">
                    Confirmar nova chave
                  </label>
                  <input
                    id="rotate-confirm"
                    type="password"
                    required
                    minLength={16}
                    maxLength={256}
                    value={confirmRotateKey}
                    onChange={(e) => setConfirmRotateKey(e.target.value)}
                    autoComplete="off"
                    placeholder="Repita a nova chave"
                    className="w-full rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2 text-sm font-mono text-[#F4F1EA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={rotating}
                className="w-full py-2.5 px-4 rounded-lg border border-[#D4AF37]/50 text-[#D4AF37] text-xs font-semibold hover:bg-[#D4AF37] hover:text-[#070709] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                {rotating ? 'Re-cifrando registros em disco...' : 'Rotacionar chave mestra'}
              </button>
            </form>
          )}
        </section>

        <section className="xl:col-span-6 bg-[#0D0E12] border border-[#22252F] rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2.5 pb-4 border-b border-[#1E2028]">
            <Download className="w-4 h-4 text-[#D4AF37]" />
            <div>
              <h3 className="text-base font-semibold text-[#F4F1EA]">
                Backup e restauração cifrados
              </h3>
              <p className="text-xs text-[#8E8A80]">
                Exporte ou restaure um pacote AES-256-GCM protegido por senha dedicada de backup.
              </p>
            </div>
          </div>

          <form onSubmit={handleExportBackup} className="space-y-3">
            <label htmlFor="backup-export-pass" className="block text-xs font-medium text-[#C8C3B8]">
              Exportar backup cifrado (desbloqueado)
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                id="backup-export-pass"
                type="password"
                required
                minLength={16}
                maxLength={256}
                disabled={needsUnlock || exportingBackup}
                value={backupExportPassphrase}
                onChange={(e) => setBackupExportPassphrase(e.target.value)}
                autoComplete="off"
                placeholder="Senha forte do backup (16+ caracteres)"
                className="flex-1 rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2 text-sm font-mono text-[#F4F1EA] placeholder:font-sans placeholder:text-[#66635C] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              />
              <button
                type="submit"
                disabled={needsUnlock || exportingBackup}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#D4AF37] text-[#070709] text-xs font-semibold hover:bg-[#E2C04D] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exportingBackup ? 'Exportando...' : 'Exportar JSON'}</span>
              </button>
            </div>
          </form>

          <form onSubmit={handleRestoreBackup} className="space-y-3 pt-4 border-t border-[#1E2028]">
            <label htmlFor="backup-restore-file" className="block text-xs font-medium text-[#C8C3B8]">
              Restaurar pacote de backup cifrado
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <label
                htmlFor="backup-restore-file"
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg border border-[#2C2F3A] bg-[#090A0D] text-xs text-[#C8C3B8] hover:border-[#D4AF37]/50 cursor-pointer whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>{restoreFileName || 'Selecionar arquivo .json'}</span>
              </label>
              <input
                id="backup-restore-file"
                type="file"
                accept="application/json,.json"
                onChange={handleBackupFileChange}
                className="sr-only"
              />
              <input
                type="password"
                required
                minLength={16}
                maxLength={256}
                disabled={needsUnlock || restoringBackup}
                value={restorePassphrase}
                onChange={(e) => setRestorePassphrase(e.target.value)}
                autoComplete="off"
                placeholder="Senha do backup"
                className="flex-1 rounded-lg bg-[#090A0D] border border-[#282B36] px-3.5 py-2 text-sm font-mono text-[#F4F1EA] placeholder:font-sans placeholder:text-[#66635C] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              />
              <button
                type="submit"
                disabled={needsUnlock || restoringBackup || !restoreBundle}
                className="px-4 py-2 rounded-lg border border-[#D4AF37]/50 text-[#D4AF37] text-xs font-semibold hover:bg-[#D4AF37] hover:text-[#070709] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {restoringBackup ? 'Restaurando...' : 'Restaurar'}
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Real Production Readiness & Persistence Diagnostics */}
      {readiness && (
        <section className="bg-[#0D0E12] border border-[#22252F] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1E2028] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-[#F4F1EA]">
                Prontidão de Produção & Persistência Real
              </h3>
              <p className="text-xs text-[#8E8A80]">
                Diagnóstico em tempo real de volume, modo Vite/HMR, store compartilhado e variáveis críticas.
              </p>
            </div>
            <span className="text-xs font-mono text-[#D4AF37]">
              NODE_ENV={readiness.nodeEnv} · {readiness.sharedStoreMode} · {readiness.storage.filesystemType}
            </span>
          </div>
          <div className="divide-y divide-[#1A1C24]">
            {readiness.checks.map((item) => (
              <div
                key={item.id}
                className="px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-[#F4F1EA]">{item.label}</p>
                  <p className="text-[#9E9A90] mt-0.5">{item.detail}</p>
                </div>
                <span
                  className={`font-mono shrink-0 ${
                    item.status === 'ok'
                      ? 'text-[#D4AF37]'
                      : item.status === 'blocker'
                        ? 'text-[#F5B8BE]'
                        : 'text-[#C8C3B8]'
                  }`}
                >
                  {item.status === 'ok'
                    ? 'conforme'
                    : item.status === 'blocker'
                      ? 'bloqueador'
                      : 'atenção'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sanitized Security Audit Trail */}
      <section className="bg-[#0D0E12] border border-[#22252F] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1E2028] flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[#F4F1EA]">
              Registro recente de eventos de segurança
            </h3>
            <p className="text-xs text-[#8E8A80]">
              Auditoria administrativa sanitizada (sem segredos ou tokens) armazenada com permissão 0600.
            </p>
          </div>
          <button
            type="button"
            disabled={loadingAudit}
            onClick={() => void loadAudit()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2C2F3A] text-xs text-[#C8C3B8] hover:border-[#D4AF37]/50 hover:text-[#F4F1EA] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{loadingAudit ? 'Atualizando...' : 'Atualizar'}</span>
          </button>
        </div>

        {auditEntries.length === 0 ? (
          <div className="px-6 py-8 text-center text-xs text-[#8E8A80]">
            Nenhum evento de segurança registrado até o momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#1E2028] text-xs text-[#8E8A80]">
                  <th className="py-3 px-6 font-medium">Data / Hora</th>
                  <th className="py-3 px-4 font-medium">Evento</th>
                  <th className="py-3 px-4 font-medium">Resultado</th>
                  <th className="py-3 px-6 font-medium">Detalhe sanitizado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1A1C24] text-xs">
                {auditEntries.slice(0, 20).map((entry) => (
                  <tr key={entry.id} className="hover:bg-[#111319] transition-colors">
                    <td className="py-2.5 px-6 font-mono tabular-nums text-[#8E8A80] whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[#F4F1EA] whitespace-nowrap">
                      {entry.event}
                    </td>
                    <td
                      className={`py-2.5 px-4 font-mono whitespace-nowrap ${
                        entry.outcome === 'ok'
                          ? 'text-[#D4AF37]'
                          : entry.outcome === 'blocked'
                            ? 'text-[#F5B8BE]'
                            : 'text-[#C8C3B8]'
                      }`}
                    >
                      {entry.outcome}
                    </td>
                    <td className="py-2.5 px-6 text-[#A6A298]">{entry.detail}</td>
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
