import { useCallback, useMemo, useState } from 'react';
import { useStableBalance } from '../contexts/StableBalanceContext';
import {
  parseAmountToSats,
  sanitizeTokenInput,
  tokenAmountDisplaysAsZero,
  type TokenDisplayConfig,
} from '../utils/tokenFormatting';
import type { Sats } from '../types/sats';

export interface UseAmountInputOptions {
  /** Pre-fill the input on mount (e.g. when re-opening a dialog with a value). */
  initialAmount?: string;
  /** User's BTC balance in sats. Required for the BTC→token display helpers. */
  balanceSats?: number;
  /** User's token balance in base units. Required for the token-balance display helper. */
  tokenBalance?: bigint;
  /**
   * Fiat input config for flows that denominate in a fiat currency *without*
   * holding a stable-balance token (e.g. cross-chain "Send USD" funded by BTC).
   * Only takes effect when stable balance is inactive; when active, the
   * stable-balance config wins. When present, the hook starts in fiat
   * ("token") mode and uses this config/rate for parsing and display — the
   * fiat amount is converted to sats via `btcFiatRate`.
   */
  fiatOverride?: { config: TokenDisplayConfig; btcFiatRate: number };
}

export interface UseAmountInputResult {
  // ----- Input state -----
  /** Display string bound to the input. Holds fiat in token mode, sats otherwise. */
  amountInput: string;
  /** Set the input from a user-typed value; sanitizes per current mode. */
  setAmount: (value: string) => void;
  /**
   * Set the input from a known-good value (e.g. quick-amount buttons, send-all).
   * Skips sanitization — the caller is responsible for passing a sane string.
   */
  setAmountInput: (value: string) => void;
  /** Clear the input. */
  resetAmount: () => void;

  // ----- Mode -----
  isTokenMode: boolean;
  setIsTokenMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  /** Toggle between fiat (token) and sats; clears the input. */
  toggleDenomination: () => void;

  // ----- Stable balance state (encapsulated; no need to call useStableBalance) -----
  /** True when stable balance is currently active — gates the CurrencySwitcher. */
  isStableBalanceActive: boolean;
  /** SDK token identifier (e.g. for routing token send-all payments). */
  tokenIdentifier: string | null;
  /** Token symbol for display (e.g. "$"). Null when not configured. */
  tokenSymbol: string | null;
  /** Underlying display config — escape hatch for callers that need the full shape. */
  config: TokenDisplayConfig | null;
  /** BTC→fiat rate. Escape hatch; prefer the formatting helpers. */
  btcFiatRate: number;

  // ----- Parsing -----
  /** Parse the current input (or a passed string) to a validated Sats value. */
  parseToSats: (input?: string) => Sats | null;
  /** Current input parsed to Sats; null when input is empty or invalid. */
  amountSats: Sats | null;

  // ----- Display helpers -----
  /**
   * The user's full token balance formatted as a display string (e.g. "10.50").
   * Null when there's no token balance or no display config. Used as the Send
   * All target value in token mode.
   */
  tokenBalanceDisplay: string | null;
  /**
   * Convert a sats value to a token display string (e.g. 50000 → "38.96").
   * Returns null if the result rounds below the displayable threshold (e.g.
   * <$0.01). Used to render BTC sats in token mode without dropping a raw
   * sats integer into a fiat-denominated input.
   */
  formatSatsAsTokenDisplay: (sats: number) => string | null;
  /**
   * Whether Send All in token mode would be unusable (combined balance rounds
   * below the displayable threshold). Components use this to disable the
   * Send All button instead of letting the user click it for no effect.
   */
  tokenSendAllBelowThreshold: boolean;
}

/**
 * Single source of truth for amount input behavior across send, buy, and
 * receive flows. Owns:
 *
 *   - Input string state with mode-aware sanitization
 *   - Token (fiat) vs sats mode toggle, initialized from StableBalanceContext
 *   - Auto-reset to sats mode when stable balance is deactivated mid-flow
 *   - fiat→sats parsing via the shared `parseAmountToSats` utility
 *   - Display helpers for token-balance, BTC-as-fiat, and sub-threshold checks
 *
 * Consumers should NOT call `useStableBalance()` directly for amount-input
 * concerns — pass balances in here and use the returned helpers.
 */
export function useAmountInput(options: UseAmountInputOptions = {}): UseAmountInputResult {
  const { initialAmount = '', balanceSats, tokenBalance, fiatOverride } = options;
  const stableBalance = useStableBalance();

  // When stable balance is off, a fiat override (e.g. cross-chain "Send USD")
  // supplies the currency config + rate so the user can still denominate in
  // fiat. Stable balance always wins when active.
  const fiatOverrideActive = !stableBalance.isActive && !!fiatOverride;
  const config = stableBalance.isActive ? stableBalance.displayConfig : (fiatOverride?.config ?? null);
  const btcFiatRate = stableBalance.isActive ? stableBalance.btcFiatRate : (fiatOverride?.btcFiatRate ?? 0);

  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive || fiatOverrideActive);
  const [amountInput, setAmountInput] = useState(initialAmount);

  // Adjust-state-on-prop-change pattern (React docs): when stable
  // balance flips off mid-flow, drop token mode and clear the input
  // so the no-longer-toggleable fiat value doesn't get stuck. Skipped when a
  // fiat override is in play — fiat mode is intentional there, not stale.
  const [prevStableActive, setPrevStableActive] = useState(stableBalance.isActive);
  if (prevStableActive !== stableBalance.isActive) {
    setPrevStableActive(stableBalance.isActive);
    if (!stableBalance.isActive && isTokenMode && !fiatOverride) {
      setIsTokenMode(false);
      setAmountInput('');
    }
  }

  const setAmount = useCallback(
    (value: string) => {
      if (isTokenMode && config) {
        const sanitized = sanitizeTokenInput(value, config.fractionSize);
        if (sanitized !== null) setAmountInput(sanitized);
      } else {
        setAmountInput(value.replace(/[^0-9]/g, ''));
      }
    },
    [isTokenMode, config],
  );

  const resetAmount = useCallback(() => setAmountInput(''), []);

  const toggleDenomination = useCallback(() => {
    setIsTokenMode((prev) => !prev);
    setAmountInput('');
  }, []);

  const parseToSats = useCallback(
    (input?: string): Sats | null =>
      parseAmountToSats(input ?? amountInput, isTokenMode, btcFiatRate),
    [amountInput, isTokenMode, btcFiatRate],
  );

  const amountSats = useMemo(() => parseToSats(), [parseToSats]);

  const tokenBalanceDisplay = useMemo<string | null>(() => {
    if (!tokenBalance || !config) return null;
    const { decimals, fractionSize } = config;
    const divisor = BigInt(10 ** decimals);
    const wholePart = tokenBalance / divisor;
    const fractionalPart = tokenBalance % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, fractionSize);
    return `${wholePart}.${fractionalStr}`;
  }, [tokenBalance, config]);

  const formatSatsAsTokenDisplay = useCallback<(sats: number) => string | null>(
    (sats) => {
      if (!config || !btcFiatRate || btcFiatRate <= 0) return null;
      if (!Number.isFinite(sats) || sats <= 0) return null;
      const fiat = (sats / 100_000_000) * btcFiatRate;
      const baseUnits = BigInt(Math.round(fiat * 10 ** config.decimals));
      if (tokenAmountDisplaysAsZero(baseUnits, config)) return null;
      return fiat.toFixed(config.fractionSize);
    },
    [config, btcFiatRate],
  );

  const tokenSendAllBelowThreshold = useMemo<boolean>(() => {
    if (!isTokenMode || !config) return false;
    const threshold = BigInt(10 ** (config.decimals - config.fractionSize));
    if (tokenBalance !== undefined && tokenBalance >= threshold) return false;
    if (balanceSats !== undefined && balanceSats > 0 && btcFiatRate > 0) {
      const fiat = (balanceSats / 100_000_000) * btcFiatRate;
      const baseUnits = BigInt(Math.round(fiat * 10 ** config.decimals));
      if (baseUnits >= threshold) return false;
    }
    return true;
  }, [isTokenMode, config, tokenBalance, balanceSats, btcFiatRate]);

  return {
    amountInput,
    setAmount,
    setAmountInput,
    resetAmount,
    isTokenMode,
    setIsTokenMode,
    toggleDenomination,
    isStableBalanceActive: stableBalance.isActive,
    tokenIdentifier: stableBalance.tokenIdentifier,
    tokenSymbol: config?.symbol ?? null,
    config,
    btcFiatRate,
    parseToSats,
    amountSats,
    tokenBalanceDisplay,
    formatSatsAsTokenDisplay,
    tokenSendAllBelowThreshold,
  };
}
