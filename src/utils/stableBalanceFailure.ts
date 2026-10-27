import type { GetInfoResponse, StableBalanceConversionKind } from '@breeztech/breez-sdk-spark';
import { getTokenBalance } from './tokenFormatting';

/** A Stable Balance conversion the SDK reported as failed. */
export interface StableBalanceFailure {
  kind: StableBalanceConversionKind;
  /** Epoch ms of the SDK's soonest retry. Unset for a per-receive failure:
   *  its sats wait for the next batch conversion, whose time the SDK keeps. */
  retryAt?: number;
}

export const STABLE_BALANCE_CONVERSION_KINDS: readonly StableBalanceConversionKind[] = [
  'perReceive',
  'autoConvert',
  'deactivation',
];

/** A sweep into USD fails in USD mode, the switch back in BTC mode. A failure
 *  from the other mode is stale: the switch that ended it reset the SDK's retry. */
export function failureMatchesMode(failure: StableBalanceFailure, isUsdMode: boolean): boolean {
  return (failure.kind === 'deactivation') !== isUsdMode;
}

/** What the failed conversion would have moved: the sats balance for a sweep
 *  into USD, the USD balance (token base units) for the switch back. Each is
 *  converted whole, which is why the event needs no amount of its own. */
export function unconvertedBalance(
  failure: StableBalanceFailure,
  walletInfo: GetInfoResponse,
  tokenIdentifier: string,
): bigint {
  if (failure.kind === 'deactivation') {
    return getTokenBalance(walletInfo.tokenBalances, tokenIdentifier)?.balance ?? 0n;
  }
  return BigInt(walletInfo.balanceSats);
}

/**
 * Whether an amount is one the SDK would convert. Below the minimum it never
 * tries, so what is left is change, and money still at the provider awaiting a
 * refund is in neither balance. A minimum that could not be fetched counts as
 * zero.
 */
export function isConvertibleAmount(amount: bigint, minimum: bigint | null): boolean {
  return amount > 0n && amount >= (minimum ?? 0n);
}

/** Ms until a failure with nothing convertible left is over, or null while
 *  there is still something to convert. It waits out the SDK's retry so a
 *  refund still on its way back does not end it early. */
export function msUntilFailureSettles(
  failure: StableBalanceFailure,
  amount: bigint,
  minimum: bigint | null,
  nowMs: number,
): number | null {
  if (isConvertibleAmount(amount, minimum)) return null;
  return Math.max(0, (failure.retryAt ?? 0) - nowMs);
}

export function formatRetryIn(retryAt: number, nowMs: number): string {
  const secs = Math.ceil((retryAt - nowMs) / 1000);
  if (secs <= 0) return 'shortly';
  if (secs < 60) return `in ~${secs} sec`;
  if (secs < 3600) return `in ~${Math.round(secs / 60)} min`;
  return `in ~${Math.round(secs / 3600)} h`;
}
