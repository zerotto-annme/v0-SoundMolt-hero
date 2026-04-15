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
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <defs>
          {/* Subtle glow for tech elements */}
          <filter id="subtleGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          
          {/* Premium red gradient - deep and rich */}
          <linearGradient id="shellGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="40%" stopColor="#dc2626" />
            <stop offset="100%" stopColor="#991b1b" />
          </linearGradient>
          
          {/* Highlight for shell */}
          <linearGradient id="shellHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fca5a5" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
          </linearGradient>
          
          {/* Cyan accent for audio elements */}
          <linearGradient id="cyanAccent" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
          
          {/* Headphone gradient - premium dark */}
          <linearGradient id="headphoneGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#374151" />
            <stop offset="100%" stopColor="#1f2937" />
          </linearGradient>
        </defs>

        {/* Headphone band - sleek arc */}
        <path
          d="M25 52 Q 25 28 60 24 Q 95 28 95 52"
          stroke="#1f2937"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M27 50 Q 27 30 60 27 Q 93 30 93 50"
          stroke="#374151"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Left headphone cup - minimal */}
        <g>
          <rect x="16" y="46" width="16" height="22" rx="4" fill="url(#headphoneGrad)" />
          <rect x="18" y="48" width="12" height="18" rx="3" fill="#111827" />
          {/* Cyan accent ring */}
          <rect
            x="19"
            y="49"
            width="10"
            height="16"
            rx="2"
            stroke="url(#cyanAccent)"
            strokeWidth="1"
            fill="none"
            filter="url(#subtleGlow)"
          />
        </g>

        {/* Right headphone cup - minimal */}
        <g>
          <rect x="88" y="46" width="16" height="22" rx="4" fill="url(#headphoneGrad)" />
          <rect x="90" y="48" width="12" height="18" rx="3" fill="#111827" />
          {/* Cyan accent ring */}
          <rect
            x="91"
            y="49"
            width="10"
            height="16"
            rx="2"
            stroke="url(#cyanAccent)"
            strokeWidth="1"
            fill="none"
            filter="url(#subtleGlow)"
          />
        </g>

        {/* Main shell body - clean geometric shape */}
        <ellipse
          cx="60"
          cy="70"
          rx="32"
          ry="26"
          fill="url(#shellGradient)"
        />
        
        {/* Shell highlight for depth */}
        <ellipse
          cx="60"
          cy="62"
          rx="24"
          ry="14"
          fill="url(#shellHighlight)"
        />

        {/* Left claw - simplified geometric */}
        <g>
          <ellipse cx="22" cy="78" rx="10" ry="6" fill="url(#shellGradient)" transform="rotate(-25 22 78)" />
          <ellipse cx="14" cy="82" rx="8" ry="5" fill="url(#shellGradient)" transform="rotate(-15 14 82)" />
          <ellipse cx="12" cy="76" rx="7" ry="4" fill="url(#shellGradient)" transform="rotate(-40 12 76)" />
        </g>

        {/* Right claw - simplified geometric */}
        <g>
          <ellipse cx="98" cy="78" rx="10" ry="6" fill="url(#shellGradient)" transform="rotate(25 98 78)" />
          <ellipse cx="106" cy="82" rx="8" ry="5" fill="url(#shellGradient)" transform="rotate(15 106 82)" />
          <ellipse cx="108" cy="76" rx="7" ry="4" fill="url(#shellGradient)" transform="rotate(40 108 76)" />
        </g>

        {/* Legs - subtle, minimal */}
        <g opacity="0.9">
          <ellipse cx="35" cy="90" rx="8" ry="3" fill="url(#shellGradient)" transform="rotate(-15 35 90)" />
          <ellipse cx="32" cy="96" rx="7" ry="2.5" fill="url(#shellGradient)" transform="rotate(-5 32 96)" />
          <ellipse cx="85" cy="90" rx="8" ry="3" fill="url(#shellGradient)" transform="rotate(15 85 90)" />
          <ellipse cx="88" cy="96" rx="7" ry="2.5" fill="url(#shellGradient)" transform="rotate(5 88 96)" />
        </g>

        {/* Audio waveform on shell - signature element */}
        <g filter="url(#subtleGlow)">
          <rect x="47" y="72" width="2" height="6" rx="1" fill="url(#cyanAccent)" />
          <rect x="51" y="69" width="2" height="12" rx="1" fill="url(#cyanAccent)" />
          <rect x="55" y="66" width="2" height="18" rx="1" fill="url(#cyanAccent)" />
          <rect x="59" y="68" width="2" height="14" rx="1" fill="url(#cyanAccent)" />
          <rect x="63" y="65" width="2" height="20" rx="1" fill="url(#cyanAccent)" />
          <rect x="67" y="69" width="2" height="12" rx="1" fill="url(#cyanAccent)" />
          <rect x="71" y="72" width="2" height="6" rx="1" fill="url(#cyanAccent)" />
        </g>

        {/* Eye stalks - clean */}
        <ellipse cx="48" cy="54" rx="4" ry="6" fill="url(#shellGradient)" />
        <ellipse cx="72" cy="54" rx="4" ry="6" fill="url(#shellGradient)" />

        {/* Eyes - minimal, sophisticated */}
        <circle cx="48" cy="50" r="5" fill="#fafafa" />
        <circle cx="72" cy="50" r="5" fill="#fafafa" />
        
        {/* Pupils - clean dots */}
        <circle cx="49" cy="50" r="2.5" fill="#0f172a" />
        <circle cx="73" cy="50" r="2.5" fill="#0f172a" />
        
        {/* Eye highlights */}
        <circle cx="50" cy="49" r="1" fill="#ffffff" />
        <circle cx="74" cy="49" r="1" fill="#ffffff" />
      </svg>
    </div>
  )
}
