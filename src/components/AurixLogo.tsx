export interface AurixLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  subtitle?: boolean;
}

export function AurixLogo({
  className = '',
  size = 'md',
  showText = true,
  subtitle = false,
}: AurixLogoProps) {
  const dimMap = {
    sm: { icon: 'w-7 h-7', text: 'text-sm', sub: 'text-[9px]' },
    md: { icon: 'w-9 h-9', text: 'text-lg', sub: 'text-[10px]' },
    lg: { icon: 'w-12 h-12', text: 'text-xl', sub: 'text-[11px]' },
    xl: { icon: 'w-16 h-16', text: 'text-2xl', sub: 'text-xs' },
  };

  const currentDim = dimMap[size];

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Official Geometric AI & Quantum Vault Emblem */}
      <div
        className={`relative flex items-center justify-center shrink-0 ${currentDim.icon} rounded-xl bg-gradient-to-br from-[#1A1C24] via-[#0E1017] to-[#050608] border border-[#D4AF37]/45 shadow-[0_4px_20px_rgba(212,175,55,0.22)]`}
      >
        {/* Subtle inner background glow */}
        <div className="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_center,rgba(230,199,110,0.18),transparent_70%)] pointer-events-none" />

        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-3/4 h-3/4 relative z-10"
        >
          {/* Outer diamond / shield telemetry frame */}
          <path
            d="M24 4L42 24L24 44L6 24L24 4Z"
            stroke="url(#aurixGoldGrad)"
            strokeWidth="1.75"
            strokeLinejoin="round"
            fill="rgba(212, 175, 55, 0.05)"
          />
          {/* Inner neural / quantum connection nodes */}
          <path
            d="M24 12V36M12 24H36M15 15L33 33M33 15L15 33"
            stroke="url(#aurixGoldGradBright)"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />
          {/* Central AI core nucleus */}
          <circle cx="24" cy="24" r="3.5" fill="#F7F4EC" stroke="#D4AF37" strokeWidth="1.5" />
          <circle cx="24" cy="24" r="1.25" fill="#D4AF37" />

          {/* Glowing node vertices */}
          <circle cx="24" cy="12" r="1.5" fill="#E6C76E" />
          <circle cx="24" cy="36" r="1.5" fill="#E6C76E" />
          <circle cx="12" cy="24" r="1.5" fill="#E6C76E" />
          <circle cx="36" cy="24" r="1.5" fill="#E6C76E" />

          <defs>
            <linearGradient
              id="aurixGoldGrad"
              x1="6"
              y1="4"
              x2="42"
              y2="44"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#F5E0A0" />
              <stop offset="50%" stopColor="#D4AF37" />
              <stop offset="100%" stopColor="#8C6718" />
            </linearGradient>
            <linearGradient
              id="aurixGoldGradBright"
              x1="12"
              y1="12"
              x2="36"
              y2="36"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="50%" stopColor="#E6C76E" />
              <stop offset="100%" stopColor="#C8A236" />
            </linearGradient>
          </defs>
        </svg>

        {/* Specular hairline top rim */}
        <div className="absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-[#F0D580]/80 to-transparent pointer-events-none" />
      </div>

      {showText && (
        <div className="flex flex-col min-w-0">
          <span
            className={`font-display font-bold tracking-[0.2em] text-[#F7F4EC] ${currentDim.text} drop-shadow-sm`}
          >
            AURIX AI
          </span>
          {subtitle && (
            <span
              className={`font-mono font-medium tracking-[0.16em] text-[#D4AF37] ${currentDim.sub}`}
            >
              INTELLIGENCE WITHOUT BORDERS
            </span>
          )}
        </div>
      )}
    </div>
  );
}
