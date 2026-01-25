import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { GetInfoResponse, Rate, FiatCurrency } from '@breeztech/breez-sdk-spark';
import { getFiatSettings } from '../services/settings';

interface CollapsingWalletHeaderProps {
  walletInfo: GetInfoResponse | null;
  fiatRates: Rate[];
  fiatCurrencies: FiatCurrency[];
  scrollProgress: number;
  onOpenMenu: () => void;
  hasUnclaimedDeposits: boolean;
  onOpenGetRefund: () => void;
}

// Format number with thin space as thousand separator (for monospace fonts)
const formatWithThinSpaces = (num: number): string => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
};

// Animated number hook - smoothly transitions between values
const useAnimatedNumber = (targetValue: number, duration: number = 400): number => {
  const [displayValue, setDisplayValue] = useState(targetValue);
  const animationRef = useRef<number | null>(null);
  const startValueRef = useRef(targetValue);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // Skip animation if it's the initial render or value is 0
    if (startValueRef.current === targetValue) return;

    const startValue = displayValue;
    startValueRef.current = targetValue;
    startTimeRef.current = null;

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for smooth deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);

      const currentValue = Math.round(startValue + (targetValue - startValue) * easeOut);
      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [targetValue, duration]);

  return displayValue;
};

const CollapsingWalletHeader: React.FC<CollapsingWalletHeaderProps> = ({
  walletInfo,
  scrollProgress,
  fiatRates,
  fiatCurrencies,
  onOpenMenu,
  hasUnclaimedDeposits,
  onOpenGetRefund
}) => {
  const [activeFiatIndex, setActiveFiatIndex] = useState(0);

  // Calculate fiat values for selected currencies
  const fiatValues = useMemo(() => {
    if (!walletInfo) return [];

    const balanceSat = walletInfo.balanceSats || 0;
    if (balanceSat === 0) return []; // Don't show fiat for zero balance

    const balanceBtc = balanceSat / 100000000;
    const settings = getFiatSettings();

    return settings.selectedCurrencies
      .map(currencyId => {
        const rate = fiatRates.find(r => r.coin === currencyId);
        const currency = fiatCurrencies.find(c => c.id === currencyId);

        if (!rate || !currency) return null;

        const value = balanceBtc * rate.value;
        const symbol = currency.info.symbol?.grapheme || currencyId;
        const fractionSize = currency.info.fractionSize || 2;

        return {
          currencyId,
          symbol,
          value: value.toFixed(fractionSize),
          symbolPosition: currency.info.symbol?.rtl ? 'after' : 'before',
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }, [walletInfo, fiatRates, fiatCurrencies]);

  // Cycle through fiat currencies on tap
  const handleFiatTap = useCallback(() => {
    if (fiatValues.length > 1) {
      setActiveFiatIndex(prev => (prev + 1) % fiatValues.length);
    }
  }, [fiatValues.length]);

  // Get current fiat to display
  const currentFiat = fiatValues.length > 0
    ? fiatValues[activeFiatIndex % fiatValues.length]
    : null;

  if (!walletInfo) return null;

  const balanceSat = walletInfo.balanceSats || 0;
  const animatedBalance = useAnimatedNumber(balanceSat);

  return (
    <div className="relative overflow-hidden transition-all duration-200">
      {/* Glassmorphism background */}
      <div className="absolute inset-0 bg-spark-surface/80 backdrop-blur-xl border-b border-spark-border" />

      {/* Strong glow effect behind balance */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[200px] pointer-events-none transition-opacity duration-300"
        style={{ opacity: 1 - scrollProgress * 0.7 }}
      >
        <div className="absolute inset-0 bg-gradient-radial from-spark-primary/30 via-spark-primary/15 to-transparent blur-3xl" />
        <div className="absolute inset-4 bg-gradient-radial from-amber-400/20 to-transparent blur-2xl" />
      </div>

      {/* Header content */}
      <div className="relative z-10 px-4 pb-2" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
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
            {/* Rejected deposits warning */}
            {hasUnclaimedDeposits && (
              <button
                type="button"
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-spark-warning/15 text-spark-warning border border-spark-warning/30 hover:bg-spark-warning/25 transition-colors"
                title="Rejected deposits need refund"
                aria-label="Get refund for rejected deposits"
                onClick={onOpenGetRefund}
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.6c.75 1.336-.213 3.001-1.742 3.001H3.48c-1.53 0-2.492-1.665-1.742-3.001l6.52-11.6zM11 13a1 1 0 10-2 0 1 1 0 002 0zm-1-2a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Balance display */}
        <div className="text-center">
          {/* Sats label */}
          <div className="text-spark-text-muted text-xs font-display font-medium tracking-widest uppercase mb-1">
            Balance
          </div>

          {/* Main balance */}
          <div className="flex items-baseline justify-center gap-2">
            <span className="balance-display">
              {formatWithThinSpaces(animatedBalance)}
            </span>
            <span className="text-spark-text-secondary text-base font-display font-medium">
              sats
            </span>
          </div>

          {/* Decoration with fading lines - shows fiat value or lightning bolt */}
          <div
            className="flex items-center justify-center gap-3 mt-3"
            onClick={currentFiat && fiatValues.length > 1 ? handleFiatTap : undefined}
            role={currentFiat && fiatValues.length > 1 ? "button" : undefined}
            tabIndex={currentFiat && fiatValues.length > 1 ? 0 : undefined}
          >
            {/* Left line - fades left */}
            <div className="w-8 h-0.5 bg-spark-primary" style={{
              maskImage: 'linear-gradient(to right, transparent, black)',
              WebkitMaskImage: 'linear-gradient(to right, transparent, black)'
            }} />

            {/* Center: Fiat value or Lightning bolt */}
            {currentFiat ? (
              <span className="text-spark-text-secondary text-sm font-mono">
                {currentFiat.symbolPosition === 'before' ? currentFiat.symbol : ''}
                {currentFiat.value}
                {currentFiat.symbolPosition === 'after' ? ` ${currentFiat.symbol}` : ''}
              </span>
            ) : (
              <svg className="w-4 h-4 text-spark-primary" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 3L4 14h7l-2 7 9-11h-7l2-7z" />
              </svg>
            )}

            {/* Right line - fades right */}
            <div className="w-8 h-0.5 bg-spark-primary" style={{
              maskImage: 'linear-gradient(to left, transparent, black)',
              WebkitMaskImage: 'linear-gradient(to left, transparent, black)'
            }} />
          </div>
        </div>

        {/* Bottom spacing */}
        <div className="h-4" />
      </div>
    </div>
  );
};

export default CollapsingWalletHeader;
