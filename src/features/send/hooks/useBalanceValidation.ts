import { useMemo } from 'react';
import { useStableBalance } from '../../../contexts/StableBalanceContext';
import { fiatToSats, parseAmountToSats, type TokenDisplayConfig } from '../../../utils/tokenFormatting';
import type { Sats } from '../../../types/sats';
import type { ConversionEstimate } from '@breeztech/breez-sdk-spark';

interface BalanceValidation {
  isTokenMode: boolean;
  setIsTokenMode?: (value: boolean) => void;
  parseInputToSats: (input: string) => Sats | null;
  /**
   * Whether a user-typed display amount (fiat in token mode, sats in sats
   * mode) exceeds the available balance. Takes a plain `number` because the
   * value is the raw display value, not a validated Sats.
   */
  exceedsBalance: (displayAmount: number) => boolean;
  validateAmount: (input: string, feesIncluded?: boolean) => string | null;
  checkInsufficientFunds: (opts: {
    totalSats: Sats;
    conversionEstimate?: ConversionEstimate | null;
  }) => boolean;
  config: TokenDisplayConfig | null;
}

const hasValidRate = (rate?: number): rate is number =>
  rate !== undefined && rate > 0;

const hasPositiveTokenBalance = (balance?: bigint): balance is bigint =>
  balance !== undefined && balance > 0n;

export function useBalanceValidation(
  isTokenMode: boolean,
  setIsTokenMode?: (value: boolean) => void,
  balanceSats?: number,
  tokenBalance?: bigint,
  fiatOverride?: { config: TokenDisplayConfig; btcFiatRate: number },
): BalanceValidation {
  const stable = useStableBalance();
  // Mirror useAmountInput: stable balance wins; otherwise a fiat override
  // (cross-chain "Send USD") supplies the config + rate so a typed fiat amount
  // can be validated against the BTC balance.
  const config = stable.isActive ? stable.displayConfig : (fiatOverride?.config ?? null);
  const btcFiatRate = stable.isActive ? stable.btcFiatRate : (fiatOverride?.btcFiatRate ?? 0);
  const isActive = stable.isActive;

  const tokenBalanceSats = useMemo<number | null>(() => {
    if (!config || !hasPositiveTokenBalance(tokenBalance) || !hasValidRate(btcFiatRate)) return null;
    const fiat = Number(tokenBalance) / 10 ** config.decimals;
    return fiatToSats(fiat, btcFiatRate);
  }, [config, tokenBalance, btcFiatRate]);

  const parseInputToSats = (input: string): Sats | null =>
    parseAmountToSats(input, isTokenMode, btcFiatRate);

  const maxAvailableSats = (): number | undefined => {
    if (balanceSats === undefined) return undefined;
    const tokenFallback = isActive && tokenBalanceSats !== null ? tokenBalanceSats : 0;
    return Math.max(balanceSats, tokenFallback);
  };

  const exceedsBalance = (displayAmount: number): boolean => {
    if (isTokenMode && config) {
      if (hasPositiveTokenBalance(tokenBalance)) {
        const baseUnits = BigInt(Math.round(displayAmount * 10 ** config.decimals));
        if (baseUnits <= tokenBalance) return false;
      }
      // Token balance can't cover it (or is zero). Check if BTC change can.
      if (!hasValidRate(btcFiatRate)) return tokenBalance !== undefined;
      const satsNeeded = fiatToSats(displayAmount, btcFiatRate);
      const available = maxAvailableSats();
      return available === undefined || satsNeeded > available;
    }

    const available = maxAvailableSats();
    if (available === undefined) return false;
    return displayAmount > available;
  };

  const validateAmount = (input: string, feesIncluded?: boolean): string | null => {
    const parsed = parseInputToSats(input);
    if (parsed === null) return 'Please enter a valid amount';

    // displayAmount represents the user-typed value (fiat in token mode,
    // sats in sats mode). exceedsBalance handles both shapes.
    const displayAmount = isTokenMode ? Number(input) : Number(parsed);
    const isSendAll = !isTokenMode && feesIncluded;
    if (isSendAll) return null;

    if (exceedsBalance(displayAmount)) {
      return 'Amount exceeds available balance';
    }
    return null;
  };

  const checkInsufficientFunds: BalanceValidation['checkInsufficientFunds'] = ({
    totalSats,
    conversionEstimate,
  }) => {
    // When the prepare response includes a conversion estimate, the SDK has
    // already validated feasibility against the user's actual token balance
    // and applied any amount adjustments (FlooredToMinLimit / IncreasedToAvoidDust).
    // Trust prepare instead of re-deriving from a snapshot that may already be
    // stale.
    if (conversionEstimate) return false;

    // Plain BTC send (no conversion engaged): the spend comes out of `balanceSats`.
    // Token balance is irrelevant here even if stable balance is active, since
    // no token→BTC conversion was requested.
    if (balanceSats === undefined) return false;
    return Number(totalSats) > balanceSats;
  };

  return {
    isTokenMode,
    setIsTokenMode,
    parseInputToSats,
    exceedsBalance,
    validateAmount,
    checkInsufficientFunds,
    config,
  };
}
