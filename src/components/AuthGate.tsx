import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { aurixApi, setAuthToken, type AuthStatusResponse } from '../lib/api.ts';
import { LoginSpaceScene, type SpaceSceneEnvironmentInfo } from './LoginSpaceScene.tsx';
import { AurixLogo } from './AurixLogo.tsx';

interface AuthGateProps {
  authStatus: AuthStatusResponse;
  onAuthenticated: () => void;
}

export function AuthGate({ authStatus, onAuthenticated }: AuthGateProps) {
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sceneEnv, setSceneEnv] = useState<SpaceSceneEnvironmentInfo>({
    webglSupported: true,
    isSoftwareGl: true,
    reducedMotion: false,
  });

  const isSetup = authStatus.needsSetup;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (isSetup && passcode !== confirmPasscode) {
      setError('As senhas informadas não coincidem.');
      return;
    }

    setSubmitting(true);
    try {
      const result = isSetup
        ? await aurixApi.setupAdmin(passcode)
        : await aurixApi.login(passcode);
      setAuthToken(result.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação.');
    } finally {
      setSubmitting(false);
    }
  }

  const useBackdropBlur = sceneEnv.webglSupported && !sceneEnv.isSoftwareGl;

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-[#040507] text-[#F4F1EA]">
      <LoginSpaceScene onEnvironmentReady={setSceneEnv} />

      <main className="relative z-10 min-h-[100dvh] w-full flex flex-col items-center justify-end sm:justify-center px-4 pt-28 pb-8 sm:px-6 sm:py-12 [@media(max-height:520px)]:justify-center [@media(max-height:520px)]:items-center [@media(max-height:520px)]:px-5 [@media(max-height:520px)]:py-4">
        <section
          aria-label="Autenticação AURIX AI"
          className={`aurix-float-panel relative w-full max-w-[420px] sm:max-w-[448px] [@media(max-height:520px)]:max-w-[400px] rounded-2xl border border-[#D4AF37]/35 shadow-[0_32px_90px_rgba(0,0,0,0.88)] ${
            useBackdropBlur
              ? 'bg-[#090A0F]/78 backdrop-blur-md'
              : 'bg-[#090A0F]/92'
          }`}
        >
          {/* Floating ambient champagne illumination aura behind panel */}
          <div
            aria-hidden="true"
            className="aurix-aura-glow pointer-events-none -z-10 absolute -inset-3 rounded-3xl bg-[radial-gradient(ellipse_at_top,rgba(230,199,110,0.18),transparent_68%)]"
          />
          {/* Champagne gold specular hairline along top rim */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#F0D580]/80 to-transparent"
          />
          {/* Subtle inner smoked-glass highlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-[#E5C466]/[0.06] via-transparent to-black/35"
          />

          <div className="relative p-6 sm:p-8 [@media(max-height:520px)]:p-4">
            <header className="flex flex-col items-center text-center pb-6 [@media(max-height:520px)]:pb-3 border-b border-[#D4AF37]/20">
              <div className="mb-4 [@media(max-height:520px)]:mb-2">
                <AurixLogo size="lg" showText={false} />
              </div>

              <h1 className="font-display text-xl sm:text-2xl [@media(max-height:520px)]:text-lg font-bold tracking-[0.18em] text-[#F7F4EC]">
                AURIX AI
              </h1>
              <p className="mt-1 text-[11px] font-medium tracking-[0.22em] text-[#E6C76E]">
                INTELLIGENCE WITHOUT BORDERS
              </p>

              <div className="mt-3.5 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#141620] border border-[#D4AF37]/30 text-xs font-medium text-[#D6D1C5]">
                {isSetup ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-[#E6C76E]" />
                    <span>Inicialização de Segurança</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5 text-[#E6C76E]" />
                    <span>Console Administrativo</span>
                  </>
                )}
              </div>
            </header>

            <form onSubmit={handleSubmit} className="mt-6 [@media(max-height:520px)]:mt-3 space-y-4 [@media(max-height:520px)]:space-y-3">
              <div>
                <label
                  htmlFor="admin-passcode"
                  className="block text-xs font-medium text-[#D6D1C5] mb-1.5"
                >
                  {isSetup
                    ? 'Nova senha administrativa (mínimo 8 caracteres)'
                    : 'Senha administrativa'}
                </label>
                <div className="relative">
                  <input
                    id="admin-passcode"
                    type={showPasscode ? 'text' : 'password'}
                    required
                    minLength={isSetup ? 8 : 1}
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="••••••••••••"
                    autoComplete={isSetup ? 'new-password' : 'current-password'}
                    className="w-full min-h-[48px] [@media(max-height:520px)]:min-h-[42px] rounded-xl bg-[#050609]/90 border border-[#D4AF37]/30 pl-4 pr-12 py-3 text-base sm:text-sm text-[#F7F4EC] placeholder:text-[#6E6A60] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E6C76E] focus:border-[#D4AF37]/80 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasscode((prev) => !prev)}
                    aria-label={showPasscode ? 'Ocultar senha' : 'Exibir senha'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-[#9D988C] hover:text-[#E6C76E] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E6C76E] transition-colors cursor-pointer"
                  >
                    {showPasscode ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {isSetup && (
                <div>
                  <label
                    htmlFor="confirm-passcode"
                    className="block text-xs font-medium text-[#D6D1C5] mb-1.5"
                  >
                    Confirmar senha administrativa
                  </label>
                  <input
                    id="confirm-passcode"
                    type={showPasscode ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirmPasscode}
                    onChange={(e) => setConfirmPasscode(e.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="new-password"
                    className="w-full min-h-[48px] [@media(max-height:520px)]:min-h-[42px] rounded-xl bg-[#050609]/90 border border-[#D4AF37]/30 px-4 py-3 text-base sm:text-sm text-[#F7F4EC] placeholder:text-[#6E6A60] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E6C76E] focus:border-[#D4AF37]/80 transition-colors"
                  />
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="rounded-xl bg-[#2A1215]/95 border border-[#8A303B] px-3.5 py-3 text-xs text-[#F8C2C8]"
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[50px] [@media(max-height:520px)]:min-h-[44px] py-3.5 [@media(max-height:520px)]:py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#C8A236] via-[#E6C76E] to-[#C8A236] text-[#070709] text-sm font-bold tracking-[0.1em] uppercase hover:brightness-110 active:scale-[0.995] disabled:opacity-60 transition-all duration-150 cursor-pointer whitespace-nowrap shadow-[0_10px_32px_rgba(212,175,55,0.28)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5E0A0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090A0F]"
              >
                {submitting
                  ? 'Validando acesso...'
                  : isSetup
                    ? 'Inicializar e entrar'
                    : 'Entrar no console'}
              </button>
            </form>

            <footer className="mt-6 pt-4 [@media(max-height:520px)]:mt-3 [@media(max-height:520px)]:pt-2.5 border-t border-[#D4AF37]/15 text-[11px] text-[#8C877B] text-center leading-relaxed">
              Autenticação protegida por token assinado em memória. Cofre AES-256-GCM.
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
