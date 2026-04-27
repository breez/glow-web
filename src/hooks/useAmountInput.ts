import { useCallback, useMemo, useState } from 'react';
import { useStableBalance } from '../contexts/StableBalanceContext';
import {
  parseAmountToSats,
  sanitizeTokenInput,
  type TokenDisplayConfig,
} from '../utils/tokenFormatting';
import type { Sats } from '../types/sats';

export interface UseAmountInputResult {
  /** The raw display string bound to the input. Holds fiat in token mode, sats otherwise. */
  amountInput: string;
  /** Set the input from a user-typed value; sanitizes per current mode. */
  setAmount: (value: string) => void;
  /**
   * Set the input from a known-good value (e.g. quick-amount buttons, send-all).
   * Skips sanitization — the caller is responsible for passing a sane string.
   */
  setAmountInput: (value: string) => void;
  /** Clear the input and any quick-amount selection state. */
  resetAmount: () => void;
  /** Whether the input is in fiat (token) mode. */
  isTokenMode: boolean;
  setIsTokenMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  /** Toggle between fiat (token) and sats; clears the input. */
  toggleDenomination: () => void;
  /** Token display config from StableBalanceContext (null when not configured). */
  config: TokenDisplayConfig | null;
  hasTokenConfig: boolean;
  /** BTC→fiat rate exposed for callers that need it directly. */
  btcFiatRate: number;
  /** Parse the current input (or a passed string) to a validated Sats value. Returns null when invalid. */
  parseToSats: (input?: string) => Sats | null;
  /** Current input parsed to Sats; null when input is empty or invalid. */
  amountSats: Sats | null;
}

/**
 * Owns the shared state and parsing for an "amount input" — used by send, buy,
 * and receive flows. Centralizes:
 *   - input string state with mode-aware sanitization
 *   - token (fiat) vs sats mode toggle, initialized from StableBalanceContext
 *   - fiat→sats parsing via the shared `parseAmountToSats` utility
 *
 * Components still own their own validation rules (min/max, balance checks, etc.)
 * — this hook only handles input plumbing.
 */
export function useAmountInput(initialAmount: string = ''): UseAmountInputResult {
  const stableBalance = useStableBalance();
  const config = stableBalance.displayConfig;
  const hasTokenConfig = !!config;
  const btcFiatRate = stableBalance.btcFiatRate;

  const [isTokenMode, setIsTokenMode] = useState(stableBalance.isActive && hasTokenConfig);
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

  const parseToSats = useCallback(
    (input?: string): Sats | null =>
      parseAmountToSats(input ?? amountInput, isTokenMode, btcFiatRate),
    [amountInput, isTokenMode, btcFiatRate],
  );

  const amountSats = useMemo(() => parseToSats(), [parseToSats]);

  return {
    amountInput,
    setAmount,
    setAmountInput,
    resetAmount,
    isTokenMode,
    setIsTokenMode,
    toggleDenomination,
    config,
    hasTokenConfig,
    btcFiatRate,
    parseToSats,
    amountSats,
  };
}
