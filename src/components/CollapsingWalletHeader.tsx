import React, { useMemo, useState, useCallback } from 'react';
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

  // Calculate fiat values for selected currencies (js-combine-iterations optimization)
  const fiatValues = useMemo(() => {
    if (!walletInfo) return [];

    const balanceSat = walletInfo.balanceSats || 0;
    if (balanceSat === 0) return []; // Don't show fiat for zero balance

    const balanceBtc = balanceSat / 100000000;
    const settings = getFiatSettings();
    const result: Array<{
      currencyId: string;
      symbol: string;
      value: string;
      symbolPosition: 'before' | 'after';
    }> = [];

    // Single iteration instead of map().filter()
    for (const currencyId of settings.selectedCurrencies) {
      const rateValue = ratesMap.get(currencyId);
      const currency = currenciesMap.get(currencyId);

      if (rateValue === undefined || !currency) continue;

      const value = balanceBtc * rateValue;
      const symbol = currency.info.symbol?.grapheme || currencyId;
      const fractionSize = currency.info.fractionSize || 2;

      result.push({
        currencyId,
        symbol,
        value: value.toFixed(fractionSize),
        symbolPosition: currency.info.symbol?.rtl ? 'after' : 'before',
      });
    }

    return result;
  }, [walletInfo, ratesMap, currenciesMap]);

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

  const balanceSat = walletInfo?.balanceSats || 0;
  const animatedBalance = useAnimatedNumber(balanceSat);

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
          {/* Sats label */}
          <div className="text-spark-text-muted text-xs font-display font-medium tracking-widest uppercase mb-1">
            Balance
          </div>

          {/* Main balance */}
          <div 
            className="flex items-baseline justify-center gap-2" 
            data-testid="wallet-balance"
          >
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
