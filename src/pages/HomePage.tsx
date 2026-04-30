import React, { useEffect, useState } from 'react';
import { useSecretTap } from '@/hooks/useSecretTap';
import { safeAreaTop, safeAreaBottom } from '@/utils/safeAreaInsets';
import { useStatusBarColor } from '@/hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE } from '@/utils/statusBarManager';

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
  onCreatePasskey: () => void;
  onUsePasskey: () => void;
  prfAvailable: boolean;
  /** True when this device has previously used a passkey (prioritize sign-in). */
  hasPasskeyBefore?: boolean;
}

const HomePage: React.FC<HomePageProps> = ({
  onRestoreWallet,
  onCreateNewWallet,
  onCreatePasskey,
  onUsePasskey,
  prfAvailable,
  hasPasskeyBefore = false,
}) => {
  // Landing page sits on a flat spark-surface background, so pin the
  // system bars to the same solid tone while we're shown.
  useStatusBarColor(STATUS_BAR_SURFACE);

  const [starsAnimating, setStarsAnimating] = useState(false);
  const [showMnemonicFlow, setShowMnemonicFlow] = useState(false);
  const { handleTap: handleLogoTap } = useSecretTap(5, 2000, false, () => setShowMnemonicFlow(v => !v));

  // Trigger star animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setStarsAnimating(true), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="h-full w-full flex flex-col bg-spark-surface relative overflow-hidden">
      {/* Background layer - extends behind all safe areas.
          Uses spark-surface (matching the system status/navigation bars)
          so the landing page blends seamlessly with the system chrome
          instead of presenting a visibly different color. */}
      <div
        className="absolute inset-0 bg-spark-surface pointer-events-none"
        style={{
          top: 'calc(-1 * env(safe-area-inset-top, 0px))',
          bottom: 'calc(-1 * env(safe-area-inset-bottom, 0px))',
          left: 'calc(-1 * env(safe-area-inset-left, 0px))',
          right: 'calc(-1 * env(safe-area-inset-right, 0px))'
        }}
      />
      {/* Animated background effects - extends behind safe areas */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{
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

      {/* Content - with safe area padding */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-6 relative z-10"
        style={{
          paddingTop: safeAreaTop,
          paddingBottom: safeAreaBottom,
        }}
      >

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
              onClick={handleLogoTap}
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
        <div className="w-full max-w-xs space-y-4 min-h-[11rem]">
          {prfAvailable && !showMnemonicFlow ? (
            hasPasskeyBefore ? (
              // Returning user (has registered a passkey before): the only
              // CTA is sign-in. There's no "Create" path here; multiple
              // wallets are achieved via multiple labels under a single
              // passkey, not multiple passkeys per RP per device. The
              // secret-tap on the logo flips into the mnemonic flow as
              // a support escape hatch for the rare "I cleared
              // localStorage" case.
              <>
                <button
                  onClick={onUsePasskey}
                  data-testid="use-passkey-button"
                  className="button w-full py-4 text-base tracking-wider"
                >
                  Use Passkey
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onCreatePasskey}
                  data-testid="create-passkey-button"
                  className="button w-full py-4 text-base tracking-wider"
                >
                  Get Started
                </button>

                <button
                  onClick={onUsePasskey}
                  data-testid="use-passkey-button"
                  className="button-secondary w-full py-4 rounded-xl font-display font-semibold text-sm tracking-wide"
                >
                  Use Existing Passkey
                </button>

                <button
                  onClick={() => setShowMnemonicFlow(true)}
                  className="text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors w-full text-center py-2"
                >
                  Use Recovery Phrase Instead
                </button>
              </>
            )
          ) : (
            <>
              {/* Mnemonic flow */}
              <button
                onClick={onCreateNewWallet}
                data-testid="create-wallet-button"
                className="button w-full py-4 text-base tracking-wider"
              >
                Get Started
              </button>

              <button
                onClick={onRestoreWallet}
                data-testid="restore-wallet-button"
                className="button-secondary w-full py-4 rounded-xl font-display font-semibold text-sm tracking-wide"
              >
                Restore from Backup
              </button>

              {/* Toggle back to passkey if PRF available */}
              {prfAvailable && (
                <button
                  onClick={() => setShowMnemonicFlow(false)}
                  className="text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors w-full text-center py-2"
                >
                  Use Passkey Instead
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default HomePage;
