import Image from "next/image"

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
    <div className={`${sizeClasses[size]} ${className} relative`}>
      <Image
        src="/images/crab-logo.png"
        alt="SoundMolt Crab Mascot"
        fill
        className="object-contain mix-blend-lighten"
        priority
      />
    </div>
  )
}
