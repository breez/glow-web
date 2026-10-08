import type {
  PrepareUnilateralExitResponse,
  UnilateralExitResponse,
  UnilateralExitTransaction,
} from '@breeztech/breez-sdk-spark';
import { outputTotalSat } from '@/utils/rawTx';
import type { UnilateralExitPlan } from './driver';

// Everything read off a quote, for Recover Funds and the Unilateral Exit alike:
// the SDK quotes both through one API, so the screens differ but the figures
// do not. Steps render these and compute none of their own.

type Quote = PrepareUnilateralExitResponse;

/**
 * What the recover-funds API adds to a quote or an exit. The published types
 * predate it, so its fields are read through this one cast. `skipped` is typed
 * as the API ships it; its reason is never read, as few are the user's to act on.
 */
interface ProposedFields {
  cooperativeFeeSats?: number;
  leaves: { value: number; method?: 'cooperative' | 'unilateral' }[];
  skipped?: { valueSats: number }[];
}

const proposed = (exit: Quote | UnilateralExitResponse): ProposedFields => exit as ProposedFields;

/** A co-signed recovery: ready at once, and paying the destination directly rather than through the sweep. */
export const isCooperative = (tx: UnilateralExitTransaction): boolean => (tx.kind as string) === 'cooperative';

/** A leaf the operators co-sign out. A stranded leaf quotes like a balance one. */
export const isCooperativeLeaf = (leaf: { method?: string }): boolean => leaf.method === 'cooperative';

/**
 * The fee the operators' co-signed recoveries cost, off the value they move:
 * what each leaf's watchtower transaction already took plus the recovery's own.
 */
export const cooperativeFeeSats = (exit: Quote | UnilateralExitResponse): number =>
  proposed(exit).cooperativeFeeSats ?? 0;

/** The part of a quote or an exit that lies outside the balance. */
export const cooperativeValueSat = (exit: Quote | UnilateralExitResponse): number =>
  proposed(exit)
    .leaves.filter(isCooperativeLeaf)
    .reduce((sum, leaf) => sum + leaf.value, 0);

/**
 * What the funding pays, from another wallet. The API leaves funding unset when
 * nothing needs it: every leaf co-signed, or only the sweep left, which pays its
 * own fee from the refunds it spends. Today's quote says so with a zero.
 */
export const exitFeeSat = (quote: Quote): number => quote.singleUtxoFundingSat;

/** Whether the exit needs coins from another wallet, and so the phrase, the fee address and the wait for it. */
export const needsFunding = (quote: Quote): boolean => exitFeeSat(quote) > 0;

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
  /** Some of it is co-signed, so the fee is more than the sweep's. */
  isCooperative: boolean;
  /**
   * A refund the operators' watchtower lands first pays its own fee, which the
   * quote cannot know. A quote that needs no funding has no refund left to send.
   */
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
  const funded = needsFunding(quote);
  return {
    fundsSat: quote.recoverableValueSat,
    balanceSat: quote.recoverableValueSat - recoverableSat,
    recoverableSat,
    networkFeeSat: quotedSweepFeeSat(quote, resuming),
    exitFeeSat: exitFeeSat(quote),
    needsFunding: funded,
    willReceiveSat: receiveSat,
    recoverableReceiveSat,
    balanceReceiveSat: Math.max(0, receiveSat - recoverableReceiveSat),
    leftOutSat: leftOutSat(quote, walletBalanceSat),
    isCooperative: recoverableSat > 0 || coopFeeSat > 0,
    isEstimate: funded,
    isEmpty: quote.leaves.length === 0,
    isWorthMoving: isWorthExiting(quote, receiveSat),
  };
}
