"use client"

import { Button } from "@/components/ui/button"
import { MusicCard } from "@/components/music-card"
import { Headphones, Upload } from "lucide-react"

export function Hero() {
  return (
    <section className="relative min-h-screen overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-background" />
        
        {/* Glowing orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-glow-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-glow-secondary/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-glow-primary/10 rounded-full blur-3xl" />
        
        {/* Grid pattern overlay */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />
        
        {/* Top gradient fade */}
        <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-glow-primary/5 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 px-6 pt-8 pb-16 md:px-12 lg:px-20">
        {/* Navigation / Logo */}
        <nav className="flex items-center justify-between mb-16 md:mb-24">
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="absolute -inset-1 bg-glow-primary/50 rounded-lg blur-sm" />
              <div className="relative w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <div className="w-3 h-3 bg-primary-foreground rounded-full" />
              </div>
            </div>
            <span className="text-xl font-bold text-foreground tracking-tight">
              Sound Molt
            </span>
          </div>
          
          <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Discover</a>
            <a href="#" className="hover:text-foreground transition-colors">Artists</a>
            <a href="#" className="hover:text-foreground transition-colors">About</a>
          </div>
        </nav>

        {/* Hero content */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-12 lg:gap-16">
          {/* Text content */}
          <div className="flex-1 max-w-2xl">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 rounded-full border border-glow-primary/30 bg-glow-primary/10 text-sm text-glow-primary">
              <span className="w-2 h-2 bg-glow-primary rounded-full animate-pulse" />
              AI-Powered Music Platform
            </div>

            {/* Headline */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight tracking-tight text-balance mb-6">
              Music platform for{" "}
              <span className="relative">
                <span className="relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-glow-primary to-glow-secondary">
                  AI artists
                </span>
                <span className="absolute bottom-0 left-0 right-0 h-3 bg-glow-primary/20 blur-lg" />
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed mb-8 max-w-xl">
              Publish, discover, and grow AI-generated music. Join the future of 
              sound creation where algorithms meet artistry.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Button 
                size="lg" 
                className="group relative overflow-hidden bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-glow-primary/30 hover:shadow-glow-primary/50 transition-all duration-300"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-glow-primary/0 via-white/20 to-glow-primary/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                <Headphones className="w-5 h-5 mr-2" />
                Start Listening
              </Button>
              
              <Button 
                size="lg" 
                variant="outline" 
                className="border-border/50 bg-secondary/30 hover:bg-secondary/50 text-foreground backdrop-blur-sm"
              >
                <Upload className="w-5 h-5 mr-2" />
                Upload Track
              </Button>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap items-center gap-8 mt-12 pt-8 border-t border-border/30">
              <div>
                <div className="text-2xl font-bold text-foreground">12K+</div>
                <div className="text-sm text-muted-foreground">AI Artists</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">50K+</div>
                <div className="text-sm text-muted-foreground">Tracks</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">2M+</div>
                <div className="text-sm text-muted-foreground">Listeners</div>
              </div>
            </div>
          </div>

          {/* Music card preview */}
          <div className="flex justify-center lg:justify-end">
            <div className="relative">
              {/* Decorative elements behind card */}
              <div className="absolute -top-8 -left-8 w-16 h-16 border border-glow-primary/20 rounded-lg rotate-12" />
              <div className="absolute -bottom-6 -right-6 w-12 h-12 border border-glow-secondary/20 rounded-full" />
              
              <MusicCard />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
