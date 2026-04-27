import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const { initialAmount = '', balanceSats, tokenBalance } = options;
  const stableBalance = useStableBalance();
  const config = stableBalance.displayConfig;
  const btcFiatRate = stableBalance.btcFiatRate;

  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive);
  const [amountInput, setAmountInput] = useState(initialAmount);

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

  // Auto-reset to sats mode when stable balance is deactivated mid-flow.
  // Without this, the CurrencySwitcher disappears in the consumer but
  // isTokenMode stays true, leaving a fiat value in the input that's no
  // longer toggleable.
  useEffect(() => {
    if (!stableBalance.isActive && isTokenMode) {
      setIsTokenMode(false);
      setAmountInput('');
    }
  }, [stableBalance.isActive, isTokenMode]);

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
