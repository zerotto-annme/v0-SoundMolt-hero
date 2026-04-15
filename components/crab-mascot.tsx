"use client"

interface CrabMascotProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

export function CrabMascot({ size = "md", className = "" }: CrabMascotProps) {
  const sizeClasses = {
    sm: "w-10 h-10",
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
        <defs>
          {/* Crab body gradient - coral red matching the reference */}
          <linearGradient id="crabBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e8847a" />
            <stop offset="50%" stopColor="#d66b61" />
            <stop offset="100%" stopColor="#c45a50" />
          </linearGradient>
          
          {/* Darker shade for depth */}
          <linearGradient id="crabDarkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d66b61" />
            <stop offset="100%" stopColor="#b54a40" />
          </linearGradient>
          
          {/* Light highlights */}
          <linearGradient id="highlightGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f0a8a0" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#d66b61" stopOpacity="0" />
          </linearGradient>
          
          {/* Headphone gradient */}
          <linearGradient id="headphoneGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4a5568" />
            <stop offset="100%" stopColor="#2d3748" />
          </linearGradient>
          
          {/* Cyan glow for music elements */}
          <filter id="cyanGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          
          {/* Soft shadow */}
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.2" />
          </filter>
        </defs>

        {/* === HEADPHONE BAND === */}
        <path
          d="M38 68 Q 38 30 100 26 Q 162 30 162 68"
          stroke="#2d3748"
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M40 66 Q 40 34 100 30 Q 160 34 160 66"
          stroke="#4a5568"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* === LEFT HEADPHONE CUP === */}
        <g filter="url(#softShadow)">
          <rect x="24" y="58" width="24" height="34" rx="6" fill="url(#headphoneGrad)" />
          <rect x="27" y="61" width="18" height="28" rx="4" fill="#1a202c" />
          {/* Cyan accent */}
          <rect x="29" y="63" width="14" height="24" rx="3" stroke="#22d3ee" strokeWidth="1.5" fill="none" />
          <circle cx="36" cy="75" r="6" fill="#1a202c" stroke="#22d3ee" strokeWidth="1" />
        </g>

        {/* === RIGHT HEADPHONE CUP === */}
        <g filter="url(#softShadow)">
          <rect x="152" y="58" width="24" height="34" rx="6" fill="url(#headphoneGrad)" />
          <rect x="155" y="61" width="18" height="28" rx="4" fill="#1a202c" />
          {/* Cyan accent */}
          <rect x="157" y="63" width="14" height="24" rx="3" stroke="#22d3ee" strokeWidth="1.5" fill="none" />
          <circle cx="164" cy="75" r="6" fill="#1a202c" stroke="#22d3ee" strokeWidth="1" />
        </g>

        {/* === MUSIC NOTE near right headphone === */}
        <g filter="url(#cyanGlow)">
          <ellipse cx="182" cy="56" rx="5" ry="4" fill="#22d3ee" />
          <rect x="186" y="38" width="2.5" height="18" fill="#22d3ee" />
          <path d="M186 38 Q 196 35 196 44" stroke="#22d3ee" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>

        {/* === ANTENNAE === */}
        <ellipse cx="85" cy="52" rx="4" ry="8" fill="url(#crabBodyGrad)" />
        <ellipse cx="115" cy="52" rx="4" ry="8" fill="url(#crabBodyGrad)" />
        <circle cx="85" cy="44" r="4" fill="url(#crabBodyGrad)" />
        <circle cx="115" cy="44" r="4" fill="url(#crabBodyGrad)" />

        {/* === MAIN HEAD === */}
        <ellipse cx="100" cy="78" rx="42" ry="38" fill="url(#crabBodyGrad)" filter="url(#softShadow)" />
        {/* Head highlight */}
        <ellipse cx="92" cy="68" rx="20" ry="14" fill="url(#highlightGrad)" />

        {/* === EYES === */}
        {/* Left eye */}
        <ellipse cx="82" cy="74" rx="12" ry="13" fill="#2d1f1f" />
        <ellipse cx="82" cy="74" rx="10" ry="11" fill="#1a1212" />
        <circle cx="85" cy="71" r="4" fill="#ffffff" />
        <circle cx="79" cy="77" r="2" fill="#ffffff" opacity="0.5" />
        
        {/* Right eye */}
        <ellipse cx="118" cy="74" rx="12" ry="13" fill="#2d1f1f" />
        <ellipse cx="118" cy="74" rx="10" ry="11" fill="#1a1212" />
        <circle cx="121" cy="71" r="4" fill="#ffffff" />
        <circle cx="115" cy="77" r="2" fill="#ffffff" opacity="0.5" />

        {/* === BODY === */}
        <ellipse cx="100" cy="128" rx="38" ry="24" fill="url(#crabBodyGrad)" filter="url(#softShadow)" />
        {/* Body highlight */}
        <ellipse cx="94" cy="122" rx="18" ry="10" fill="url(#highlightGrad)" />
        {/* Body segment line */}
        <path d="M72 130 Q 100 138 128 130" stroke="#b54a40" strokeWidth="2" fill="none" opacity="0.5" />

        {/* === LEFT CLAW ARM === */}
        <ellipse cx="54" cy="118" rx="14" ry="8" fill="url(#crabBodyGrad)" transform="rotate(-20 54 118)" />
        <ellipse cx="38" cy="124" rx="12" ry="7" fill="url(#crabBodyGrad)" transform="rotate(-10 38 124)" />
        
        {/* Left claw */}
        <g filter="url(#softShadow)">
          <ellipse cx="22" cy="130" rx="16" ry="12" fill="url(#crabBodyGrad)" transform="rotate(-15 22 130)" />
          <ellipse cx="16" cy="124" rx="10" ry="7" fill="url(#crabBodyGrad)" transform="rotate(-30 16 124)" />
          {/* Claw highlight */}
          <ellipse cx="20" cy="126" rx="8" ry="5" fill="url(#highlightGrad)" transform="rotate(-15 20 126)" />
        </g>

        {/* === RIGHT CLAW ARM === */}
        <ellipse cx="146" cy="118" rx="14" ry="8" fill="url(#crabBodyGrad)" transform="rotate(20 146 118)" />
        <ellipse cx="162" cy="124" rx="12" ry="7" fill="url(#crabBodyGrad)" transform="rotate(10 162 124)" />
        
        {/* Right claw */}
        <g filter="url(#softShadow)">
          <ellipse cx="178" cy="130" rx="16" ry="12" fill="url(#crabBodyGrad)" transform="rotate(15 178 130)" />
          <ellipse cx="184" cy="124" rx="10" ry="7" fill="url(#crabBodyGrad)" transform="rotate(30 184 124)" />
          {/* Claw highlight */}
          <ellipse cx="180" cy="126" rx="8" ry="5" fill="url(#highlightGrad)" transform="rotate(15 180 126)" />
        </g>

        {/* === LEGS LEFT === */}
        <ellipse cx="68" cy="148" rx="12" ry="4" fill="url(#crabDarkGrad)" transform="rotate(-25 68 148)" />
        <ellipse cx="58" cy="156" rx="8" ry="3" fill="url(#crabDarkGrad)" transform="rotate(-35 58 156)" />
        
        <ellipse cx="72" cy="156" rx="12" ry="4" fill="url(#crabDarkGrad)" transform="rotate(-15 72 156)" />
        <ellipse cx="64" cy="164" rx="8" ry="3" fill="url(#crabDarkGrad)" transform="rotate(-25 64 164)" />
        
        <ellipse cx="78" cy="162" rx="10" ry="3.5" fill="url(#crabDarkGrad)" transform="rotate(-5 78 162)" />
        <ellipse cx="72" cy="170" rx="7" ry="2.5" fill="url(#crabDarkGrad)" transform="rotate(-15 72 170)" />

        {/* === LEGS RIGHT === */}
        <ellipse cx="132" cy="148" rx="12" ry="4" fill="url(#crabDarkGrad)" transform="rotate(25 132 148)" />
        <ellipse cx="142" cy="156" rx="8" ry="3" fill="url(#crabDarkGrad)" transform="rotate(35 142 156)" />
        
        <ellipse cx="128" cy="156" rx="12" ry="4" fill="url(#crabDarkGrad)" transform="rotate(15 128 156)" />
        <ellipse cx="136" cy="164" rx="8" ry="3" fill="url(#crabDarkGrad)" transform="rotate(25 136 164)" />
        
        <ellipse cx="122" cy="162" rx="10" ry="3.5" fill="url(#crabDarkGrad)" transform="rotate(5 122 162)" />
        <ellipse cx="128" cy="170" rx="7" ry="2.5" fill="url(#crabDarkGrad)" transform="rotate(15 128 170)" />
      </svg>
    </div>
  )
}
