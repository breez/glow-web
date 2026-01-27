import React, { useEffect, useState } from 'react';

// Star positions around the logo (relative to center, in pixels) - larger radius for bigger logo
const STARS = [
  { x: -55, y: -40, size: 3.5 },
  { x: 58, y: -30, size: 2.5 },
  { x: -45, y: 45, size: 3 },
  { x: 52, y: 50, size: 2.5 },
  { x: -15, y: -60, size: 2.5 },
  { x: 20, y: 55, size: 3.5 },
  { x: -62, y: 10, size: 2.5 },
  { x: 65, y: -5, size: 3 },
];

interface HomePageProps {
  onRestoreWallet: () => void;
  onCreateNewWallet: () => void;
}

const HomePage: React.FC<HomePageProps> = ({ onRestoreWallet, onCreateNewWallet }) => {
  const [starsAnimating, setStarsAnimating] = useState(false);

  // Trigger star animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setStarsAnimating(true), 300);
    return () => clearTimeout(timer);
  }, []);

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
            {/* Twinkling stars */}
            {STARS.map((star, i) => (
              <span
                key={i}
                className={`sidebar-star ${starsAnimating ? 'animate' : ''}`}
                style={{
                  width: star.size,
                  height: star.size,
                  left: `calc(50% + ${star.x}px)`,
                  top: `calc(50% + ${star.y}px)`,
                  boxShadow: starsAnimating ? `0 0 ${star.size * 2}px var(--spark-primary)` : 'none',
                }}
              />
            ))}
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
            data-testid="create-wallet-button"
            className="button w-full py-4 text-base tracking-wider"
          >
            Get Started
          </button>

          {/* Secondary CTA */}
          <button
            onClick={onRestoreWallet}
            data-testid="restore-wallet-button"
            className="button-secondary w-full py-4 rounded-xl font-display font-semibold text-sm tracking-wide"
          >
            Restore from Backup
          </button>
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

export default HomePage;
