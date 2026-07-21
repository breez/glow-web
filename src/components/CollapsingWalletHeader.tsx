import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import type { GetInfoResponse, FiatCurrency } from '@breeztech/breez-sdk-spark';
import { safeAreaTop } from '../utils/safeAreaInsets';
import { getFiatSettings } from '../services/settings';
import { formatWithThinSpaces, formatWithSpaces } from '../utils/formatNumber';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';
import { MenuIcon, AlertTriangleIcon, CurrencyIcon, SpinnerIcon } from './Icons';
import { useStableBalance } from '../contexts/StableBalanceContext';
import { useFiatData } from '../contexts/FiatDataContext';
import { getTokenBalance, formatTokenAmount } from '../utils/tokenFormatting';
import StableBalanceToggleFlow from './StableBalanceToggleFlow';
import { useRestoreStableBalancePrompt } from '../hooks/useRestoreStableBalancePrompt';

// Module-level flag: once the balance count-up has played, skip it on remount.
// Resets on full page reload.
let hasPlayedInitialAnimation = false;

interface CollapsingWalletHeaderProps {
  walletInfo: GetInfoResponse | null;
  scrollProgress: number;
  onOpenMenu: () => void;
  onOpenBuyBitcoin?: () => void;
  isBuyLoading?: boolean;
  isSyncing?: boolean;
  refreshWalletData?: () => Promise<void>;
  hasRejectedDeposits?: boolean;
  onOpenGetRefund?: () => void;
}

const CollapsingWalletHeader: React.FC<CollapsingWalletHeaderProps> = ({
  walletInfo,
  scrollProgress,
  onOpenMenu,
  onOpenBuyBitcoin,
  isBuyLoading,
  isSyncing,
  refreshWalletData,
  hasRejectedDeposits,
  onOpenGetRefund,
}) => {
  const { fiatRates, fiatCurrencies } = useFiatData();
  const stableBalance = useStableBalance();
  const [activeFiatIndex, setActiveFiatIndex] = useState(0);
  // User-driven open. session is bumped on every tap so the dialog
  // remounts with fresh state via key-based remount (no reset effect).
  const [userToggle, setUserToggle] = useState<{
    direction: 'toToken' | 'toBitcoin';
    session: number;
  } | null>(null);

  // One-shot latch for the restore-prompt auto-open. Set true on the
  // false→true edge of `restorePrompt.shouldPrompt` and cleared only on
  // dismiss, so the dialog doesn't auto-close if shouldPrompt later
  // becomes false (e.g. after token metadata loads and isActive flips).
  const [autoOpened, setAutoOpened] = useState(false);

  const restorePrompt = useRestoreStableBalancePrompt({
    isSyncing: !!isSyncing,
    walletInfo,
    isStableBalanceActive: stableBalance.isActive,
  });

  // Adjust state on prop change (React docs pattern): latch the auto-open
  // when shouldPrompt rises, without using an effect.
  const [prevShouldPrompt, setPrevShouldPrompt] = useState(restorePrompt.shouldPrompt);
  if (prevShouldPrompt !== restorePrompt.shouldPrompt) {
    setPrevShouldPrompt(restorePrompt.shouldPrompt);
    if (restorePrompt.shouldPrompt && !userToggle && !autoOpened) {
      setAutoOpened(true);
    }
  }

  // userToggle wins over restorePrompt (user already saw the pill).
  const isOpen = userToggle !== null || autoOpened;
  const direction: 'toToken' | 'toBitcoin' = userToggle?.direction ?? 'toToken';
  const dialogKey = userToggle ? `user-${userToggle.session}` : 'restore';

  const handleSuffixTap = useCallback(() => {
    if (stableBalance.isToggling) return;
    setUserToggle((prev) => ({
      direction: stableBalance.isActive ? 'toBitcoin' : 'toToken',
      session: (prev?.session ?? 0) + 1,
    }));
  }, [stableBalance]);

  // Acknowledge the restore prompt on dismiss so it doesn't re-open
  // within the same shouldPrompt window.
  const closeToggleFlow = useCallback(() => {
    if (restorePrompt.shouldPrompt) restorePrompt.markPrompted();
    setUserToggle(null);
    setAutoOpened(false);
  }, [restorePrompt]);

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

  // Compute balances
  const btcBalanceSat = walletInfo?.balanceSats || 0;

  const tokenBalanceInfo =
    stableBalance.isActive && walletInfo?.tokenBalances && stableBalance.tokenIdentifier
      ? getTokenBalance(walletInfo.tokenBalances, stableBalance.tokenIdentifier)
      : null;

  const tokenBalanceRaw = tokenBalanceInfo ? Number(tokenBalanceInfo.balance) : 0;

  // Primary balance for animation (token base units or sats)
  const primaryBalance = stableBalance.isActive ? tokenBalanceRaw : btcBalanceSat;

  // Track when both balance and secondary data are ready to trigger synced animation
  const hasSecondaryData = stableBalance.isActive
    ? true
    : fiatCurrencyInfo.length > 0;
  const skipAnimation = hasPlayedInitialAnimation;
  const [animationReady, setAnimationReady] = useState(skipAnimation);
  const hasTriggeredAnimation = useRef(skipAnimation);

  useEffect(() => {
    // Start animation only when BOTH balance and secondary data are available
    if (primaryBalance > 0 && hasSecondaryData && !hasTriggeredAnimation.current) {
      hasTriggeredAnimation.current = true;
      hasPlayedInitialAnimation = true;
      setAnimationReady(true);
    }
  }, [primaryBalance, hasSecondaryData]);

  // Timeout fallback: if secondary data doesn't load within 2s, animate balance anyway
  useEffect(() => {
    if (primaryBalance > 0 && !hasTriggeredAnimation.current) {
      const timeout = setTimeout(() => {
        if (!hasTriggeredAnimation.current) {
          hasTriggeredAnimation.current = true;
          hasPlayedInitialAnimation = true;
          setAnimationReady(true);
        }
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [primaryBalance]);

  // Only animate from 80% when both are ready; otherwise show full value
  // On return visits, skip the count-up effect (no initialStartPercent)
  const animatedBalance = useAnimatedNumber(
    animationReady ? primaryBalance : 0,
    skipAnimation ? {} : { initialStartPercent: 0.8 }
  );

  // Display: if animation started, use animated value; otherwise use actual balance
  const displayBalance = animationReady ? animatedBalance : primaryBalance;

  // Calculate current fiat value from display balance (so both animate together)
  // Used only in non-stable-balance mode
  const currentFiat = useMemo(() => {
    if (stableBalance.isActive) return null;
    if (!hasSecondaryData || btcBalanceSat === 0) return null;

    const info = fiatCurrencyInfo[activeFiatIndex % fiatCurrencyInfo.length];
    const btcValue = displayBalance / 100000000;
    const fiatValue = btcValue * info.rate;

    return {
      ...info,
      value: fiatValue.toFixed(info.fractionSize),
    };
  }, [stableBalance.isActive, fiatCurrencyInfo, activeFiatIndex, displayBalance, btcBalanceSat, hasSecondaryData]);

  // Stable balance secondary line
  const stableSecondaryText = useMemo(() => {
    if (!stableBalance.isActive) return null;
    if (btcBalanceSat > 0) return `${formatWithThinSpaces(btcBalanceSat)} change`;
    return null;
  }, [stableBalance.isActive, btcBalanceSat]);

  // Format primary balance display — strip the currency symbol so we can position it separately.
  // Use a regular space (not thin-space) so the .balance-display word-spacing
  // CSS can tighten the gap between thousand groups in JetBrains Mono.
  const formattedPrimaryBalance = useMemo(() => {
    if (stableBalance.isActive && stableBalance.displayConfig) {
      const full = formatTokenAmount(BigInt(displayBalance), stableBalance.displayConfig);
      const sym = stableBalance.displayConfig.symbol;
      return full.startsWith(sym) ? full.slice(sym.length).trimStart() : full;
    }
    return formatWithSpaces(displayBalance);
  }, [stableBalance.isActive, stableBalance.displayConfig, displayBalance]);

  // Currency symbol to show before the balance (₿ for sats, $ etc. for stable)
  const currencySymbol = stableBalance.isActive && stableBalance.displayConfig?.symbol
    ? stableBalance.displayConfig.symbol
    : '₿';

  if (!walletInfo) return null;

  const balanceSuffix = stableBalance.isActive ? 'USD' : 'sats';

  // Hide fiat secondary line while stable balance config is still loading
  // (activeLabel is set from cache but displayConfig hasn't loaded yet)
  const stableBalanceLoading = !!stableBalance.activeLabel && !stableBalance.isActive;
  const hasSecondaryLine = stableBalance.isActive ? !!stableSecondaryText : (!stableBalanceLoading && !!currentFiat);

  return (
  <>
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

      {/* Header content - padded below safe area. safeAreaTop resolves
          to a fixed 0.5rem gap on Android native (where env() is
          unreliable) and to env(safe-area-inset-top) on iOS / web. */}
      <div
        className="relative z-10 px-4 pb-2"
        style={{ paddingTop: safeAreaTop }}
      >
        {/* Top bar with menu and network. Fixed h-14 (56dp) matches the
            Material toolbar height used by SlideInPage and PageLayout so
            the menu/back buttons land at the same screen y coordinate on
            every screen. */}
        <div className="h-14 flex items-center justify-between mb-4">
          {/* Menu button */}
          <button
            onClick={onOpenMenu}
            className="p-2 -ml-2 text-spark-text-secondary hover:text-spark-text-primary transition-colors rounded-xl hover:bg-white/5"
            aria-label="Open menu"
            data-testid="menu-button"
          >
            <MenuIcon size="lg" />
          </button>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Rejected deposits warning */}
            {hasRejectedDeposits && onOpenGetRefund && (
              <button
                type="button"
                onClick={onOpenGetRefund}
                className="flex items-center gap-1 h-9 px-3 rounded-xl text-spark-warning border border-spark-warning/20 hover:border-spark-warning/40 hover:bg-spark-warning/5 transition-colors text-xs font-medium"
              >
                <AlertTriangleIcon size="xs" />
                Refund
              </button>
            )}
            {/* Buy Bitcoin */}
            {onOpenBuyBitcoin && (
              <button
                type="button"
                disabled={isBuyLoading}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-spark-text-secondary hover:text-spark-text-primary border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors text-sm font-medium disabled:opacity-50"
                onClick={onOpenBuyBitcoin}
              >
                {isBuyLoading ? <SpinnerIcon size="sm" className="animate-spin" /> : <CurrencyIcon size="sm" />}
                <span>Buy</span>
              </button>
            )}
          </div>
        </div>

        {/* Balance display */}
        <div className="text-center">
          {/* Label — fixed height with cross-fade to prevent layout shift */}
          <div className="relative h-4 mb-1 flex items-center justify-center">
            <span
              className={`absolute text-spark-text-muted text-xs font-display font-medium tracking-widest uppercase transition-opacity duration-300 inline-flex items-center gap-1.5 ${
                isSyncing ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-spark-primary animate-pulse" />
              Syncing
            </span>
            <span
              className={`absolute text-spark-text-muted text-xs font-display font-medium tracking-widest uppercase transition-opacity duration-300 ${
                isSyncing ? 'opacity-0' : 'opacity-100'
              }`}
            >
              Balance
              <button
                  type="button"
                  onClick={handleSuffixTap}
                  disabled={stableBalance.isToggling}
                  className="inline-flex items-center cursor-pointer text-spark-text-muted/50 hover:text-spark-text-secondary transition-colors disabled:opacity-50 font-display text-xs font-medium tracking-widest uppercase"
                >
                  <span className="mx-1.5">·</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 transition-all">{balanceSuffix}</span>
                </button>
            </span>
          </div>

          {/* Main balance */}
          <div
            className="relative inline-block text-center"
            data-testid="wallet-balance"
          >
            <span className="balance-display">
              {formattedPrimaryBalance}
            </span>
            {displayBalance > 0 && <span className="absolute right-full top-1/2 -translate-y-1/2 mr-0.5 text-3xl text-spark-text-secondary opacity-70 font-mono">{currencySymbol}</span>}
          </div>

          {/* Secondary line - fiat value or BTC as fiat equivalent */}
          <div
            className={`mt-2 flex items-center justify-center gap-3 transition-opacity duration-200 ${
              hasSecondaryLine ? 'opacity-100' : 'opacity-0'
            } ${!stableBalance.isActive && fiatCurrencyInfo.length > 1 ? 'cursor-pointer' : ''}`}
            onClick={!stableBalance.isActive && fiatCurrencyInfo.length > 1 ? handleFiatTap : undefined}
          >
            <span className="w-6 h-0.5 bg-spark-primary" style={{
              maskImage: 'linear-gradient(to right, transparent, black)',
              WebkitMaskImage: 'linear-gradient(to right, transparent, black)'
            }} />
            <span className="text-spark-text-secondary text-sm font-mono">
              {stableBalance.isActive ? (
                stableSecondaryText ? (
                  <span className="inline-flex items-center"><span className="text-[0.8em] opacity-70 mr-px">₿</span>{stableSecondaryText}</span>
                ) : (
                  <span className="invisible">$0.00</span>
                )
              ) : currentFiat ? (
                <>
                  {currentFiat.symbolPosition === 'before' ? currentFiat.symbol : ''}
                  {currentFiat.value}
                  {currentFiat.symbolPosition === 'after' ? ` ${currentFiat.symbol}` : ''}
                </>
              ) : (
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

    <StableBalanceToggleFlow
      key={dialogKey}
      isOpen={isOpen}
      direction={direction}
      restorePrompt={autoOpened}
      onComplete={() => {
        refreshWalletData?.();
        closeToggleFlow();
      }}
      onCancel={closeToggleFlow}
    />
  </>
  );
};

export default CollapsingWalletHeader;
