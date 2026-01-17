import React from 'react';
import type { GetInfoResponse } from '@breeztech/breez-sdk-spark';

interface CollapsingWalletHeaderProps {
  walletInfo: GetInfoResponse | null;
  usdRate: number | null;
  scrollProgress: number;
  onOpenMenu: () => void;
  hasUnclaimedDeposits: boolean;
  onOpenUnclaimedDeposits: () => void;
}

// Format number with space as thousand separator
const formatWithSpaces = (num: number): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
};

const CollapsingWalletHeader: React.FC<CollapsingWalletHeaderProps> = ({
  walletInfo,
  scrollProgress,
  usdRate,
  onOpenMenu,
  hasUnclaimedDeposits,
  onOpenUnclaimedDeposits
}) => {
  if (!walletInfo) return null;

  const balanceSat = walletInfo.balanceSats || 0;
  const pendingOpacity = Math.max(0, 1 - scrollProgress * 2);
  const balanceScale = scrollProgress > 0.5
    ? Math.max(0.8, 1 - (scrollProgress - 0.5))
    : 1;
  const maxPendingHeight = '80px';
  const usdValue = usdRate !== null ? ((balanceSat / 100000000) * usdRate).toFixed(2) : null;

  return (
    <div className="relative overflow-hidden transition-all duration-200">
      {/* Glassmorphism background */}
      <div className="absolute inset-0 bg-spark-surface/80 backdrop-blur-xl border-b border-spark-border" />
      
      {/* Glow effect behind balance */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[150px] bg-gradient-radial from-spark-amber/20 to-transparent blur-3xl pointer-events-none transition-opacity duration-300"
        style={{ opacity: 1 - scrollProgress * 0.7 }}
      />

      {/* Header content */}
      <div className="relative z-10 px-4 pt-4 pb-2">
        {/* Top bar with menu and network */}
        <div className="flex items-center justify-between mb-4">
          {/* Menu button */}
          <button
            onClick={onOpenMenu}
            className="p-2 -ml-2 text-spark-text-secondary hover:text-spark-text-primary transition-colors rounded-xl hover:bg-white/5"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            {/* Unclaimed deposits warning */}
            {hasUnclaimedDeposits && (
              <button
                type="button"
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-spark-warning/15 text-spark-warning border border-spark-warning/30 hover:bg-spark-warning/25 transition-colors"
                title="Unclaimed deposits need attention"
                aria-label="Unclaimed deposits"
                onClick={onOpenUnclaimedDeposits}
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.6c.75 1.336-.213 3.001-1.742 3.001H3.48c-1.53 0-2.492-1.665-1.742-3.001l6.52-11.6zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-2a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Balance display */}
        <div
          className="text-center transition-all duration-200"
          style={{
            transform: `scale(${balanceScale})`,
            transformOrigin: 'center top'
          }}
        >
          {/* Sats label */}
          <div className="text-spark-text-muted text-xs font-display font-medium tracking-widest uppercase mb-1">
            Balance
          </div>
          
          {/* Main balance */}
          <div className="flex items-baseline justify-center gap-2">
            <span className="balance-display font-mono">
              {formatWithSpaces(balanceSat)}
            </span>
            <span className="text-spark-text-secondary text-xl font-display font-medium">
              sats
            </span>
          </div>

          {/* Lightning bolt decoration */}
          <div className="flex items-center justify-center gap-1 mt-1 opacity-60">
            <div className="w-4 h-px bg-gradient-to-r from-transparent to-spark-amber/50" />
            <svg className="w-4 h-4 text-spark-amber" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
            </svg>
            <div className="w-4 h-px bg-gradient-to-l from-transparent to-spark-amber/50" />
          </div>
        </div>

        {/* USD value - fades on scroll */}
        <div
          className="flex flex-col overflow-hidden transition-all duration-200"
          style={{
            opacity: pendingOpacity,
            maxHeight: pendingOpacity > 0 ? maxPendingHeight : '0px',
            marginTop: pendingOpacity > 0 ? '0.75rem' : '0'
          }}
        >
          {usdValue && (
            <div className="text-center text-spark-text-secondary text-lg font-display">
              ≈ ${usdValue}
            </div>
          )}
        </div>

        {/* Bottom spacing */}
        <div className="h-4" />
      </div>
    </div>
  );
};

export default CollapsingWalletHeader;
