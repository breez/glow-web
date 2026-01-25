import React from 'react';

interface HomePageProps {
  onRestoreWallet: () => void;
  onCreateNewWallet: () => void;
}

const HomePage: React.FC<HomePageProps> = ({ onRestoreWallet, onCreateNewWallet }) => {
  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-spark-dark">
      {/* Animated background - extends behind safe areas via negative margins */}
      <div className="absolute -inset-[env(safe-area-inset-top)] pointer-events-none overflow-hidden" style={{
        top: 'calc(-1 * env(safe-area-inset-top, 0px))',
        bottom: 'calc(-1 * env(safe-area-inset-bottom, 0px))',
        left: 'calc(-1 * env(safe-area-inset-left, 0px))',
        right: 'calc(-1 * env(safe-area-inset-right, 0px))'
      }}>
        {/* Central glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px]">
          <div className="absolute inset-0 bg-gradient-radial from-spark-primary/25 via-spark-primary/8 to-transparent blur-3xl animate-glow-pulse" />
        </div>

        {/* Accent orbs */}
        <div className="absolute top-20 right-10 w-32 h-32 bg-gradient-radial from-spark-primary/15 to-transparent blur-2xl" />
        <div className="absolute bottom-40 left-10 w-24 h-24 bg-gradient-radial from-spark-electric/10 to-transparent blur-2xl" />

        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.4) 1px, transparent 0)`,
            backgroundSize: '48px 48px'
          }}
        />
      </div>

      {/* Content - safe areas handled by AppShell */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10">
        
        {/* Logo */}
        <div className="mb-10 relative">
          {/* Outer glow ring */}
          <div className="absolute -inset-10 bg-gradient-radial from-spark-primary/25 via-spark-primary/5 to-transparent blur-2xl animate-glow-pulse" />
          
          {/* Icon container */}
          <div className="relative w-36 h-36 flex items-center justify-center">
            <img 
              src="/assets/Glow_Logo.png" 
              alt="Glow" 
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* Title */}
        <h1 className="font-display text-5xl md:text-6xl font-bold text-center mb-2 tracking-tight">
          <span className="text-gradient-primary">
            Glow
          </span>
        </h1>

        {/* Tagline */}
        <p className="text-spark-text-muted text-sm font-display text-center mb-12">
          Powered by Breez SDK
        </p>

        {/* CTA Buttons */}
        <div className="w-full max-w-xs space-y-4">
          {/* Primary CTA */}
          <button
            onClick={onCreateNewWallet}
            className="button w-full py-4 text-base tracking-wider"
          >
            Get Started
          </button>

          {/* Secondary CTA */}
          <button
            onClick={onRestoreWallet}
            className="button-secondary w-full py-4 rounded-xl font-display font-semibold text-sm tracking-wide"
          >
            Restore from Backup
          </button>
        </div>

        {/* Features */}
        <div className="mt-16 flex gap-6 max-w-sm w-full justify-center">
          <FeaturePill 
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            label="Instant" 
          />
          <FeaturePill 
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            }
            label="Secure" 
          />
          <FeaturePill 
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            label="Global" 
          />
        </div>
      </div>

      {/* Bottom fade - extends behind safe area */}
      <div className="absolute inset-x-0 h-24 bg-gradient-to-t from-spark-dark to-transparent pointer-events-none" style={{
        bottom: 'calc(-1 * env(safe-area-inset-bottom, 0px))',
        left: 'calc(-1 * env(safe-area-inset-left, 0px))',
        right: 'calc(-1 * env(safe-area-inset-right, 0px))'
      }} />
    </div>
  );
};

interface FeaturePillProps {
  icon: React.ReactNode;
  label: string;
}

const FeaturePill: React.FC<FeaturePillProps> = ({ icon, label }) => (
  <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-spark-surface/80 border border-spark-border hover:border-spark-border-light transition-colors">
    <span className="text-spark-primary">{icon}</span>
    <span className="text-spark-text-secondary text-xs font-display font-medium tracking-wide">{label}</span>
  </div>
);

export default HomePage;
