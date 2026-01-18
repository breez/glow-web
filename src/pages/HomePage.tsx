import React from 'react';

interface HomePageProps {
  onRestoreWallet: () => void;
  onCreateNewWallet: () => void;
}

const HomePage: React.FC<HomePageProps> = ({ onRestoreWallet, onCreateNewWallet }) => {
  return (
    <div className="h-[100dvh] flex flex-col relative overflow-hidden bg-spark-dark">
      {/* Animated background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Central glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px]">
          <div className="absolute inset-0 bg-gradient-radial from-amber-500/20 via-amber-600/5 to-transparent blur-3xl animate-glow-pulse" />
        </div>
        
        {/* Accent orbs */}
        <div className="absolute top-20 right-10 w-32 h-32 bg-gradient-radial from-amber-400/10 to-transparent blur-2xl" />
        <div className="absolute bottom-40 left-10 w-24 h-24 bg-gradient-radial from-amber-500/8 to-transparent blur-2xl" />
        
        {/* Subtle grid pattern */}
        <div 
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)`,
            backgroundSize: '40px 40px'
          }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10">
        
        {/* Logo */}
        <div className="mb-10 relative">
          {/* Outer glow ring */}
          <div className="absolute -inset-8 bg-gradient-radial from-amber-500/20 via-amber-600/5 to-transparent blur-2xl animate-glow-pulse" />
          
          {/* Icon container */}
          <div className="relative w-28 h-28 rounded-[2rem] bg-gradient-to-br from-spark-surface to-spark-dark border border-white/10 flex items-center justify-center shadow-2xl">
            {/* Rays */}
            <svg className="absolute w-full h-full" viewBox="0 0 112 112">
              <defs>
                <linearGradient id="homeRay" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#fcd34d" stopOpacity="0"/>
                  <stop offset="50%" stopColor="#fcd34d" stopOpacity="0.4"/>
                  <stop offset="100%" stopColor="#d4a574" stopOpacity="0"/>
                </linearGradient>
              </defs>
              <g opacity="0.6">
                {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                  <ellipse
                    key={angle}
                    cx="56"
                    cy="28"
                    rx="1"
                    ry="20"
                    fill="url(#homeRay)"
                    transform={`rotate(${angle} 56 56)`}
                  />
                ))}
              </g>
            </svg>
            
            {/* Core glow */}
            <div className="absolute w-16 h-16 rounded-full bg-gradient-radial from-amber-400/40 via-amber-500/20 to-transparent blur-lg" />
            
            {/* Main orb */}
            <div className="relative w-12 h-12 rounded-full bg-gradient-radial from-white via-amber-200 to-amber-500 shadow-lg">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/80 to-transparent" />
              <div className="absolute top-2 left-2 w-3 h-3 rounded-full bg-white/90" />
            </div>
          </div>
        </div>

        {/* Title */}
        <h1 className="font-display text-5xl md:text-6xl font-bold text-center mb-2 tracking-tight">
          <span className="bg-gradient-to-r from-amber-200 via-amber-100 to-amber-300 bg-clip-text text-transparent">
            Glow
          </span>
        </h1>

        {/* Tagline */}
        <p className="text-spark-text-muted text-sm text-center mb-10">
          Powered by Breez SDK
        </p>

        {/* CTA Buttons */}
        <div className="w-full max-w-xs space-y-3">
          {/* Primary CTA */}
          <button
            onClick={onCreateNewWallet}
            className="group relative w-full py-4 px-6 rounded-2xl font-display font-semibold text-base overflow-hidden transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
          >
            {/* Button gradient background */}
            <div className="absolute inset-0 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 opacity-100" />
            <div className="absolute inset-0 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            
            {/* Shimmer effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            
            <span className="relative text-black">Get Started</span>
          </button>

          {/* Secondary CTA */}
          <button
            onClick={onRestoreWallet}
            className="w-full py-4 px-6 rounded-2xl border border-white/10 bg-white/5 text-spark-text-secondary font-display font-medium text-sm hover:bg-white/10 hover:text-spark-text-primary hover:border-white/20 transition-all duration-300"
          >
            Restore from Backup
          </button>
        </div>

        {/* Features */}
        <div className="mt-14 flex gap-8 max-w-sm w-full justify-center">
          <FeaturePill icon="⚡" label="Instant" />
          <FeaturePill icon="🔒" label="Secure" />
          <FeaturePill icon="🌍" label="Global" />
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-spark-dark to-transparent pointer-events-none" />
    </div>
  );
};

const FeaturePill: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/5">
    <span className="text-sm">{icon}</span>
    <span className="text-spark-text-muted text-xs font-medium">{label}</span>
  </div>
);

export default HomePage;
