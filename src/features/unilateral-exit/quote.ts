import type {
  PrepareUnilateralExitResponse,
  UnilateralExitLeaf,
  UnilateralExitResponse,
  UnilateralExitTransaction,
} from '@breeztech/breez-sdk-spark';
import { outputTotalSat } from '@/utils/rawTx';
import type { PendingExit, UnilateralExitPlan } from './driver';
import { fundingAddressOf } from './funding';

// Everything read off a quote, for Recover Funds and the Unilateral Exit alike:
// the SDK quotes both through one API, so the screens differ but the figures
// do not. Steps render these and compute none of their own.

type Quote = PrepareUnilateralExitResponse;

/**
 * What the recover-funds API adds to a quote or an exit, read through these
 * casts while the published types predate it. `skipped` is typed as the API
 * ships it, and its reason is never read: few are the user's to act on.
 */
interface ProposedFields {
  cooperativeFeeSats?: number;
  skipped?: { valueSats: number }[];
}

const proposed = (exit: Quote | UnilateralExitResponse): ProposedFields => exit as ProposedFields;

/** A co-signed recovery: ready at once, and paying the destination directly rather than through the sweep. */
export const isCooperative = (tx: UnilateralExitTransaction): boolean => (tx.kind as string) === 'cooperative';

/**
 * A leaf the operators co-sign out. A stranded leaf quotes like a balance one.
 * Only `method` is cast: a leaf's value stays on the typed `value`, which the
 * API renames `valueSats`, so the port fails to compile rather than sum nothing.
 */
const isCooperativeLeaf = (leaf: UnilateralExitLeaf): boolean =>
  (leaf as { method?: string }).method === 'cooperative';

/**
 * The fee the operators' co-signed recoveries cost, off the value they move:
 * what each leaf's watchtower transaction already took plus the recovery's own.
 */
export const cooperativeFeeSats = (exit: Quote | UnilateralExitResponse): number =>
  proposed(exit).cooperativeFeeSats ?? 0;

/** The part of a quote or an exit that lies outside the balance. */
export const cooperativeValueSat = (exit: Quote | UnilateralExitResponse): number =>
  exit.leaves.filter(isCooperativeLeaf).reduce((sum, leaf) => sum + leaf.value, 0);

/**
 * What the funding pays, from another wallet. The API leaves funding unset when
 * nothing needs it: every leaf co-signed, or only the sweep left, which pays its
 * own fee from the refunds it spends. Today's quote says so with a zero.
 */
export const exitFeeSat = (quote: Quote): number => quote.singleUtxoFundingSat;

/** Whether the exit needs coins from another wallet, and so the phrase, the fee address and the wait for it. */
export const needsFunding = (quote: Quote): boolean => exitFeeSat(quote) > 0;

/** What an exit's fee address was asked for, and where it is. Both absent when the exit never needed funding. */
export interface ExitFeeRecord {
  quotedExitFeeSat?: number;
  exitFeeAddress?: string;
}

/** A plan's record. One written before the record existed has only the coins its builds spent. */
export function exitFeeRecordOf(plan: UnilateralExitPlan): ExitFeeRecord {
  const inputs = plan.exit.fundingInputs;
  const keyed = inputs.find(input => input.type === 'p2wpkh');
  return {
    quotedExitFeeSat:
      plan.quotedExitFeeSat ?? (inputs.length > 0 ? inputs.reduce((sum, input) => sum + input.value, 0) : undefined),
    exitFeeAddress: plan.exitFeeAddress ?? (keyed ? fundingAddressOf(keyed.pubkey, plan.network) : undefined),
  };
}

/**
 * The record a build from `quote` keeps. A quote that needs funding is paid its
 * own exit fee at `address`. One that needs none spends no coins, so `paid`
 * carries over: the user paid it, and whatever the exit left unspent is still
 * at that address.
 */
export const builtExitFeeRecord = (
  quote: Quote,
  paid: ExitFeeRecord,
  address = paid.exitFeeAddress,
): ExitFeeRecord => (needsFunding(quote) ? { quotedExitFeeSat: exitFeeSat(quote), exitFeeAddress: address } : paid);

const tookFunding = (plan: UnilateralExitPlan): boolean => exitFeeRecordOf(plan).quotedExitFeeSat !== undefined;

/**
 * Whether what arrives is an estimate. A refund the operators' watchtower lands
 * first pays its own fee, which no quote can know, so an exit paid for from
 * another wallet stays one until it lands. Funds that need no funding move in
 * transactions whose outputs are already known. A pending exit waits on its fee.
 */
export function isEstimate(
  exit: Quote | UnilateralExitPlan | PendingExit,
  resuming: UnilateralExitPlan | null = null,
): boolean {
  if ('fundingAddress' in exit) return true;
  if ('exit' in exit) return tookFunding(exit);
  return needsFunding(exit) || (resuming !== null && tookFunding(resuming));
}

/**
 * What comes off the value moved: the sweep's fee and the co-signed recoveries'.
 * A rebuild is quoted on the refunds it has left to sweep, so an earlier quote
 * stays the floor; a quote at a higher rate replaces it.
 */
export function quotedSweepFeeSat(quote: Quote, resuming: UnilateralExitPlan | null): number {
  return Math.max(quote.sweepFeeSat + cooperativeFeeSats(quote), resuming?.quotedSweepFeeSat ?? 0);
}

/**
 * What the destination address ends up with: the value moved less what comes
 * off it, until the sweep and any co-signed recoveries confirm and the figure
 * is read off them. The funding is not counted: it pays the other fees, and
 * what it has left comes back only if the sweep Glow built is the one that lands.
 */
export function willReceiveSat(exit: Quote | UnilateralExitPlan, resuming: UnilateralExitPlan | null = null): number {
  if (!('exit' in exit)) {
    return Math.max(0, exit.recoverableValueSat - quotedSweepFeeSat(exit, resuming));
  }
  const landing = exit.exit.transactions.filter(tx => tx.kind === 'sweep' || isCooperative(tx));
  const outputs = landing.every(tx => tx.status.type === 'confirmed') ? landing.map(tx => outputTotalSat(tx.txHex)) : [];
  const landed = outputs.length > 0 && outputs.every(sat => sat !== null);
  return landed
    ? outputs.reduce<number>((sum, sat) => sum + (sat ?? 0), 0)
    : Math.max(0, exit.exit.recoverableValueSat - exit.quotedSweepFeeSat);
}

/** Whether a quote moves anything worth more than it costs to move. */
export const isWorthExiting = (quote: Quote, receiveSat: number = willReceiveSat(quote)): boolean =>
  quote.leaves.length > 0 && quote.totalFeeSat < quote.recoverableValueSat && receiveSat > 0;

/**
 * What the quote leaves behind: the leaves it skipped, whatever the reason,
 * including one the SDK adds later. Today's quote lists none, so the part of
 * the wallet's balance it does not move stands in.
 */
export function leftOutSat(quote: Quote, walletBalanceSat: number): number {
  const { skipped } = proposed(quote);
  if (skipped) return skipped.reduce((sum, leaf) => sum + leaf.valueSats, 0);
  return Math.max(0, walletBalanceSat - (quote.recoverableValueSat - cooperativeValueSat(quote)));
}

export interface QuoteFigures {
  /** Everything the quote moves. */
  fundsSat: number;
  /** The part its own pre-signed transactions move: the balance, or stranded funds, which quote alike. */
  balanceSat: number;
  /** The co-signed part, outside the balance. */
  recoverableSat: number;
  /** What comes off `fundsSat`. */
  networkFeeSat: number;
  /** Zero when the quote needs no funding. */
  exitFeeSat: number;
  needsFunding: boolean;
  willReceiveSat: number;
  /** What the co-signed part delivers on its own, without waiting on the exit fee. */
  recoverableReceiveSat: number;
  /** What the rest delivers, once the exit fee is paid. */
  balanceReceiveSat: number;
  leftOutSat: number;
  /**
   * The quote listed what it leaves out, for any reason. Without that list the
   * part of the balance it does not move stands in, which today's quote leaves
   * out as pieces too small to be worth their fee.
   */
  leftOutFromSkipped: boolean;
  /** Some of it is co-signed, so the fee is more than the sweep's. */
  isCooperative: boolean;
  isEstimate: boolean;
  isEmpty: boolean;
  isWorthMoving: boolean;
}

/**
 * A quote's figures as both flows show them. `resuming` is the exit a rebuild
 * re-quotes. `walletBalanceSat` stands in for a skipped list the quote lacks.
 */
export function quoteFigures(
  quote: Quote,
  { resuming = null, walletBalanceSat = 0 }: { resuming?: UnilateralExitPlan | null; walletBalanceSat?: number } = {},
): QuoteFigures {
  const recoverableSat = cooperativeValueSat(quote);
  const coopFeeSat = cooperativeFeeSats(quote);
  const receiveSat = willReceiveSat(quote, resuming);
  const recoverableReceiveSat = Math.max(0, recoverableSat - coopFeeSat);
  return {
    fundsSat: quote.recoverableValueSat,
    balanceSat: quote.recoverableValueSat - recoverableSat,
    recoverableSat,
    networkFeeSat: quotedSweepFeeSat(quote, resuming),
    exitFeeSat: exitFeeSat(quote),
    needsFunding: needsFunding(quote),
    willReceiveSat: receiveSat,
    recoverableReceiveSat,
    balanceReceiveSat: Math.max(0, receiveSat - recoverableReceiveSat),
    leftOutSat: leftOutSat(quote, walletBalanceSat),
    leftOutFromSkipped: proposed(quote).skipped !== undefined,
    isCooperative: recoverableSat > 0 || coopFeeSat > 0,
    isEstimate: isEstimate(quote, resuming),
    isEmpty: quote.leaves.length === 0,
    isWorthMoving: isWorthExiting(quote, receiveSat),
  };
}
