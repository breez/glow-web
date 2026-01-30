import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { GetInfoResponse, Rate, FiatCurrency } from '@breeztech/breez-sdk-spark';
import { getFiatSettings } from '../services/settings';
import { formatWithThinSpaces } from '../utils/formatNumber';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';

interface CollapsingWalletHeaderProps {
  walletInfo: GetInfoResponse | null;
  fiatRates: Rate[];
  fiatCurrencies: FiatCurrency[];
  scrollProgress: number;
  onOpenMenu: () => void;
  hasUnclaimedDeposits: boolean;
  onOpenGetRefund: () => void;
}

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

  // Build lookup maps for O(1) access (js-index-maps optimization)
  const ratesMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const rate of fiatRates) {
      map.set(rate.coin, rate.value);
    }
    return map;
  }, [fiatRates]);

  const currenciesMap = useMemo(() => {
    const map = new Map<string, FiatCurrency>();
    for (const currency of fiatCurrencies) {
      map.set(currency.id, currency);
    }
    return map;
  }, [fiatCurrencies]);

  // Get selected currency metadata (without values - those are computed from animatedBalance)
  const fiatCurrencyInfo = useMemo(() => {
    const settings = getFiatSettings();
    const result: Array<{
      currencyId: string;
      symbol: string;
      rate: number;
      fractionSize: number;
      symbolPosition: 'before' | 'after';
    }> = [];

    for (const currencyId of settings.selectedCurrencies) {
      const rateValue = ratesMap.get(currencyId);
      const currency = currenciesMap.get(currencyId);

      if (rateValue === undefined || !currency) continue;

      result.push({
        currencyId,
        symbol: currency.info.symbol?.grapheme || currencyId,
        rate: rateValue,
        fractionSize: currency.info.fractionSize || 2,
        symbolPosition: currency.info.symbol?.rtl ? 'after' : 'before',
      });
    }

    return result;
  }, [ratesMap, currenciesMap]);

  // Cycle through fiat currencies on tap
  const handleFiatTap = useCallback(() => {
    if (fiatCurrencyInfo.length > 1) {
      setActiveFiatIndex(prev => (prev + 1) % fiatCurrencyInfo.length);
    }
  }, [fiatCurrencyInfo.length]);

  const balanceSat = walletInfo?.balanceSats || 0;
  
  // Track when both balance and fiat are ready to trigger synced animation
  const hasFiatData = fiatCurrencyInfo.length > 0;
  const [animationReady, setAnimationReady] = useState(false);
  const hasTriggeredAnimation = useRef(false);
  
  useEffect(() => {
    // Start animation only when BOTH balance and fiat are available
    if (balanceSat > 0 && hasFiatData && !hasTriggeredAnimation.current) {
      hasTriggeredAnimation.current = true;
      setAnimationReady(true);
    }
  }, [balanceSat, hasFiatData]);
  
  // Timeout fallback: if fiat doesn't load within 2s, animate balance anyway
  useEffect(() => {
    if (balanceSat > 0 && !hasTriggeredAnimation.current) {
      const timeout = setTimeout(() => {
        if (!hasTriggeredAnimation.current) {
          hasTriggeredAnimation.current = true;
          setAnimationReady(true);
        }
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [balanceSat]);
  
  // Only animate from 80% when both are ready; otherwise show full value
  const animatedBalance = useAnimatedNumber(
    animationReady ? balanceSat : 0,
    { initialStartPercent: 0.8 }
  );
  
  // Display: if animation started, use animated value; otherwise use actual balance
  const displayBalance = animationReady ? animatedBalance : balanceSat;

  // Calculate current fiat value from display balance (so both animate together)
  const currentFiat = useMemo(() => {
    if (!hasFiatData || balanceSat === 0) return null;
    
    const info = fiatCurrencyInfo[activeFiatIndex % fiatCurrencyInfo.length];
    const btcValue = displayBalance / 100000000;
    const fiatValue = btcValue * info.rate;
    
    return {
      ...info,
      value: fiatValue.toFixed(info.fractionSize),
    };
  }, [fiatCurrencyInfo, activeFiatIndex, displayBalance, balanceSat, hasFiatData]);

  if (!walletInfo) return null;

  return (
    <div className="relative overflow-hidden transition-all duration-200">
      {/* Glassmorphism background - extends into safe area */}
      <div
        className="absolute inset-0 bg-spark-surface/80 backdrop-blur-xl border-b border-spark-border"
        style={{
          top: 'calc(-1 * env(safe-area-inset-top, 0px))',
        }}
      />

      {/* Strong glow effect behind balance - extends into safe area */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[200px] pointer-events-none transition-opacity duration-300"
        style={{
          opacity: 1 - scrollProgress * 0.7,
          marginTop: 'calc(-0.5 * env(safe-area-inset-top, 0px))',
        }}
      >
        <div className="absolute inset-0 bg-gradient-radial from-spark-primary/30 via-spark-primary/15 to-transparent blur-3xl" />
        <div className="absolute inset-4 bg-gradient-radial from-amber-400/20 to-transparent blur-2xl" />
      </div>

      {/* Header content - padded below safe area */}
      <div
        className="relative z-10 px-4 pb-2"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
      >
        {/* Top bar with menu and network */}
        <div className="flex items-center justify-between mb-4">
          {/* Menu button */}
          <button
            onClick={onOpenMenu}
            className="p-2 -ml-2 text-spark-text-secondary hover:text-spark-text-primary transition-colors rounded-xl hover:bg-white/5"
            aria-label="Open menu"
            data-testid="menu-button"
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
          {/* Label */}
          <div className="text-spark-text-muted text-xs font-display font-medium tracking-widest uppercase mb-1">
            Balance<span className="text-spark-text-muted/50 mx-1.5">·</span><span className="text-spark-text-muted/50">sats</span>
          </div>

          {/* Main balance */}
          <div 
            className="inline-flex items-baseline justify-center" 
            data-testid="wallet-balance"
          >
            <span className="balance-display">
              {formatWithThinSpaces(displayBalance)}
            </span>
          </div>

          {/* Fiat value with accent marks - always reserve space to prevent layout shift */}
          <div
            className={`mt-2 flex items-center justify-center gap-3 transition-opacity duration-200 ${
              currentFiat ? 'opacity-100' : 'opacity-0'
            } ${fiatCurrencyInfo.length > 1 ? 'cursor-pointer' : ''}`}
            onClick={fiatCurrencyInfo.length > 1 ? handleFiatTap : undefined}
          >
            <span className="w-6 h-0.5 bg-spark-primary" style={{
              maskImage: 'linear-gradient(to right, transparent, black)',
              WebkitMaskImage: 'linear-gradient(to right, transparent, black)'
            }} />
            <span className="text-spark-text-secondary text-sm font-mono">
              {currentFiat ? (
                <>
                  {currentFiat.symbolPosition === 'before' ? currentFiat.symbol : ''}
                  {currentFiat.value}
                  {currentFiat.symbolPosition === 'after' ? ` ${currentFiat.symbol}` : ''}
                </>
              ) : (
                /* Invisible placeholder to reserve space */
                <span className="invisible">$0.00</span>
              )}
            </span>
            <span className="w-6 h-0.5 bg-spark-primary" style={{
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
