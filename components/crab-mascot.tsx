"use client"

interface CrabMascotProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

export function CrabMascot({ size = "md", className = "" }: CrabMascotProps) {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-48 h-48",
    lg: "w-64 h-64",
  }

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        {/* Glow filter */}
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="crabBodyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#dc2626" />
            <stop offset="100%" stopColor="#b91c1c" />
          </linearGradient>
          <linearGradient id="neonCyan" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
          <linearGradient id="headphoneBand" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#374151" />
            <stop offset="50%" stopColor="#1f2937" />
            <stop offset="100%" stopColor="#111827" />
          </linearGradient>
        </defs>

        {/* Left claw */}
        <g>
          {/* Upper pincer */}
          <ellipse
            cx="35"
            cy="115"
            rx="20"
            ry="12"
            fill="url(#crabBodyGradient)"
            transform="rotate(-30 35 115)"
          />
          {/* Lower pincer */}
          <ellipse
            cx="30"
            cy="125"
            rx="18"
            ry="10"
            fill="url(#crabBodyGradient)"
            transform="rotate(-15 30 125)"
          />
          {/* Arm */}
          <ellipse
            cx="55"
            cy="105"
            rx="12"
            ry="8"
            fill="url(#crabBodyGradient)"
            transform="rotate(-45 55 105)"
          />
          {/* Neon accent on claw */}
          <path
            d="M20 115 Q 25 110 35 108"
            stroke="url(#neonCyan)"
            strokeWidth="2"
            strokeLinecap="round"
            filter="url(#glow)"
            opacity="0.9"
          />
        </g>

        {/* Right claw */}
        <g>
          {/* Upper pincer */}
          <ellipse
            cx="165"
            cy="115"
            rx="20"
            ry="12"
            fill="url(#crabBodyGradient)"
            transform="rotate(30 165 115)"
          />
          {/* Lower pincer */}
          <ellipse
            cx="170"
            cy="125"
            rx="18"
            ry="10"
            fill="url(#crabBodyGradient)"
            transform="rotate(15 170 125)"
          />
          {/* Arm */}
          <ellipse
            cx="145"
            cy="105"
            rx="12"
            ry="8"
            fill="url(#crabBodyGradient)"
            transform="rotate(45 145 105)"
          />
          {/* Neon accent on claw */}
          <path
            d="M180 115 Q 175 110 165 108"
            stroke="url(#neonCyan)"
            strokeWidth="2"
            strokeLinecap="round"
            filter="url(#glow)"
            opacity="0.9"
          />
        </g>

        {/* Legs (left side) */}
        <g>
          <ellipse cx="60" cy="140" rx="15" ry="5" fill="url(#crabBodyGradient)" transform="rotate(-20 60 140)" />
          <ellipse cx="55" cy="150" rx="14" ry="5" fill="url(#crabBodyGradient)" transform="rotate(-10 55 150)" />
          <ellipse cx="55" cy="160" rx="13" ry="4" fill="url(#crabBodyGradient)" transform="rotate(0 55 160)" />
        </g>

        {/* Legs (right side) */}
        <g>
          <ellipse cx="140" cy="140" rx="15" ry="5" fill="url(#crabBodyGradient)" transform="rotate(20 140 140)" />
          <ellipse cx="145" cy="150" rx="14" ry="5" fill="url(#crabBodyGradient)" transform="rotate(10 145 150)" />
          <ellipse cx="145" cy="160" rx="13" ry="4" fill="url(#crabBodyGradient)" transform="rotate(0 145 160)" />
        </g>

        {/* Main body */}
        <ellipse
          cx="100"
          cy="130"
          rx="50"
          ry="40"
          fill="url(#crabBodyGradient)"
        />
        
        {/* Body shell texture/highlight */}
        <ellipse
          cx="100"
          cy="120"
          rx="35"
          ry="20"
          fill="#f87171"
          opacity="0.3"
        />

        {/* Audio waveform on body */}
        <g filter="url(#glow)" opacity="0.85">
          <rect x="80" y="135" width="3" height="10" rx="1.5" fill="url(#neonCyan)" />
          <rect x="86" y="132" width="3" height="16" rx="1.5" fill="url(#neonCyan)" />
          <rect x="92" y="128" width="3" height="24" rx="1.5" fill="url(#neonCyan)" />
          <rect x="98" y="130" width="3" height="20" rx="1.5" fill="url(#neonCyan)" />
          <rect x="104" y="126" width="3" height="28" rx="1.5" fill="url(#neonCyan)" />
          <rect x="110" y="131" width="3" height="18" rx="1.5" fill="url(#neonCyan)" />
          <rect x="116" y="134" width="3" height="12" rx="1.5" fill="url(#neonCyan)" />
        </g>

        {/* Headphone band */}
        <path
          d="M55 75 Q 55 45 100 40 Q 145 45 145 75"
          stroke="url(#headphoneBand)"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
        />
        
        {/* Headphone band highlight */}
        <path
          d="M60 72 Q 60 50 100 46 Q 140 50 140 72"
          stroke="#4b5563"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />

        {/* Left headphone cup */}
        <g>
          <ellipse cx="52" cy="85" rx="18" ry="22" fill="#1f2937" />
          <ellipse cx="52" cy="85" rx="14" ry="18" fill="#111827" />
          <ellipse cx="52" cy="85" rx="10" ry="12" fill="#0f172a" />
          {/* Neon ring */}
          <ellipse
            cx="52"
            cy="85"
            rx="12"
            ry="15"
            stroke="url(#neonCyan)"
            strokeWidth="2"
            fill="none"
            filter="url(#glow)"
          />
          {/* Speaker mesh dots */}
          <circle cx="48" cy="82" r="1.5" fill="#374151" />
          <circle cx="52" cy="82" r="1.5" fill="#374151" />
          <circle cx="56" cy="82" r="1.5" fill="#374151" />
          <circle cx="48" cy="87" r="1.5" fill="#374151" />
          <circle cx="52" cy="87" r="1.5" fill="#374151" />
          <circle cx="56" cy="87" r="1.5" fill="#374151" />
        </g>

        {/* Right headphone cup */}
        <g>
          <ellipse cx="148" cy="85" rx="18" ry="22" fill="#1f2937" />
          <ellipse cx="148" cy="85" rx="14" ry="18" fill="#111827" />
          <ellipse cx="148" cy="85" rx="10" ry="12" fill="#0f172a" />
          {/* Neon ring */}
          <ellipse
            cx="148"
            cy="85"
            rx="12"
            ry="15"
            stroke="url(#neonCyan)"
            strokeWidth="2"
            fill="none"
            filter="url(#glow)"
          />
          {/* Speaker mesh dots */}
          <circle cx="144" cy="82" r="1.5" fill="#374151" />
          <circle cx="148" cy="82" r="1.5" fill="#374151" />
          <circle cx="152" cy="82" r="1.5" fill="#374151" />
          <circle cx="144" cy="87" r="1.5" fill="#374151" />
          <circle cx="148" cy="87" r="1.5" fill="#374151" />
          <circle cx="152" cy="87" r="1.5" fill="#374151" />
        </g>

        {/* Eyes */}
        <g>
          {/* Eye stalks */}
          <ellipse cx="82" cy="95" rx="6" ry="10" fill="url(#crabBodyGradient)" />
          <ellipse cx="118" cy="95" rx="6" ry="10" fill="url(#crabBodyGradient)" />
          
          {/* Eye whites */}
          <circle cx="82" cy="90" r="8" fill="#f8fafc" />
          <circle cx="118" cy="90" r="8" fill="#f8fafc" />
          
          {/* Pupils */}
          <circle cx="84" cy="90" r="4" fill="#0f172a" />
          <circle cx="120" cy="90" r="4" fill="#0f172a" />
          
          {/* Eye shine */}
          <circle cx="86" cy="88" r="2" fill="#ffffff" />
          <circle cx="122" cy="88" r="2" fill="#ffffff" />
        </g>

        {/* Mouth - happy expression */}
        <path
          d="M90 108 Q 100 115 110 108"
          stroke="#7f1d1d"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  )
}
