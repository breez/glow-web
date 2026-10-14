import type {
  PrepareRecoverFundsResponse,
  RecoverFundsLeaf,
  RecoverFundsResponse,
  RecoveryTransaction,
  SkippedLeaf,
} from '@breeztech/breez-sdk-spark';
import { outputTotalSat } from '@/utils/rawTx';
import type { Landing, NamedLeaf, UnilateralExitPlan } from './model/plan';
import { fundingAddressOf } from './funding';

// Everything read off a quote, for Recover Funds and the Unilateral Exit alike:
// the SDK quotes both through one API, so the screens differ but the figures
// do not. Steps render these and compute none of their own.

type Quote = PrepareRecoverFundsResponse;

/** A co-signed recovery: ready at once, and paying the destination directly rather than through the sweep. */
export const isCooperative = (tx: RecoveryTransaction): boolean => tx.kind === 'cooperative';

/** A leaf the operators co-sign out. A stranded leaf quotes like a balance one. */
export const isCooperativeLeaf = (leaf: RecoverFundsLeaf): boolean => leaf.method === 'cooperative';

/** The part of a quote that lies outside the balance. */
const cooperativeValueSat = (quote: Quote): number =>
  quote.leaves.filter(isCooperativeLeaf).reduce((sum, leaf) => sum + leaf.valueSats, 0);

/**
 * What the funding pays, from another wallet. The SDK leaves funding unset when
 * nothing needs it: every leaf co-signed, or only the sweep left, which pays its
 * own fee from the refunds it spends.
 */
export const exitFeeSat = (quote: Quote): number => quote.funding?.singleUtxoSats ?? 0;

/** Whether the exit needs coins from another wallet, and so the phrase, the fee address and the wait for it. */
export const needsFunding = (quote: Quote): boolean => quote.funding !== undefined;

/** What an exit's fee address was paid, and where it is. Both absent when the exit never needed funding. */
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
      plan.quotedExitFeeSat ?? (inputs.length > 0 ? inputs.reduce((sum, input) => sum + input.valueSats, 0) : undefined),
    exitFeeAddress: plan.exitFeeAddress ?? (keyed ? fundingAddressOf(keyed.pubkey, plan.network) : undefined),
  };
}

/**
 * The record a build from `quote` keeps. A quote that needs funding is paid its
 * own exit fee at `address`, or with `sentSat`, what reached that address since
 * the build it replaces, on top of `paid`. One that needs none spends no coins,
 * so `paid` carries over: the user paid it, and whatever the exit left unspent
 * is still at that address.
 */
export function builtExitFeeRecord(
  quote: Quote,
  paid: ExitFeeRecord,
  address = paid.exitFeeAddress,
  sentSat?: number,
): ExitFeeRecord {
  if (!needsFunding(quote)) return paid;
  const quotedExitFeeSat = sentSat === undefined ? exitFeeSat(quote) : (paid.quotedExitFeeSat ?? 0) + sentSat;
  return { quotedExitFeeSat, exitFeeAddress: address };
}

/**
 * What comes off the value moved: the sweep's fee, the co-signed recoveries', and
 * what the operators' own refunds took from their leaves.
 * A rebuild is quoted on the refunds it has left to sweep, so an earlier quote
 * stays the floor; a quote at a higher rate replaces it.
 */
export function quotedSweepFeeSat(quote: Quote, resuming: UnilateralExitPlan | null): number {
  return Math.max(quote.sweepFeeSats + quote.cooperativeFeeSats + quote.refundFeeSats, resuming?.quotedSweepFeeSat ?? 0);
}

/**
 * The same figure once `built`: its co-signed fee leaves out the leaves the
 * operators did not co-sign. The sweep's stays the quote's, since the built
 * sweep also spends the funding's change, and its fee pays for those inputs too.
 * `floorSat` is what a rebuild carries over.
 */
export function builtSweepFeeSat(quote: Quote, built: RecoverFundsResponse, floorSat = 0): number {
  return Math.max(quote.sweepFeeSats + built.cooperativeFeeSats + built.refundFeeSats, floorSat);
}

/**
 * What `quote` puts on each of its leaves. The SDK quotes these fees only in
 * total, so each co-signed leaf takes an even share of the co-signed fee, and
 * each other leaf of the sweep's.
 */
export function leafFeesSat(quote: Quote): Map<string, number> {
  const cosigned = quote.leaves.filter(isCooperativeLeaf).length;
  const others = quote.leaves.length - cosigned;
  return new Map(
    quote.leaves.map(leaf => [
      leaf.leafId,
      isCooperativeLeaf(leaf) ? Math.ceil(quote.cooperativeFeeSats / cosigned) : Math.ceil((quote.sweepFeeSats + quote.refundFeeSats) / others),
    ]),
  );
}

/**
 * Leaves of `named` that no build holds and no ledger entry covers. It
 * defaults to `namedLeaves` alone, which loses no value: `namedLeavesOf` adds
 * a plan's failed leaves from before `namedLeaves`, and gives them none.
 */
export function unbuiltLeaves(plan: UnilateralExitPlan, named: NamedLeaf[] = plan.namedLeaves ?? []): NamedLeaf[] {
  const accounted = new Set([
    ...plan.exit.leaves.map(leaf => leaf.leafId),
    ...(plan.landed ?? []).flatMap(entry => entry.leafIds),
  ]);
  return named.filter(leaf => !accounted.has(leaf.leafId));
}

/** Ledger entries of builds the plan replaced: none of this build's leaves or transactions. */
export function priorLandings(plan: UnilateralExitPlan): Landing[] {
  const leaves = new Set(plan.exit.leaves.map(leaf => leaf.leafId));
  const txids = new Set(plan.exit.transactions.map(tx => tx.txid));
  return (plan.landed ?? []).filter(
    entry => !(entry.txid && txids.has(entry.txid)) && !entry.leafIds.some(id => leaves.has(id)),
  );
}

export interface PaidOut {
  /** Each transaction that paid the destination, once, in block order. */
  txids: string[];
  paidSat: number;
  /** What the leaves those transactions paid were quoted at. */
  valueSat: number;
}

/** What ledger entries paid the destination. An entry still waiting, or one that paid it nothing, adds nothing. */
export function paidOut(entries: Landing[]): PaidOut {
  const paid = entries.filter(entry => entry.txid && (entry.paidSat ?? 0) > 0);
  const byTxid = new Map<string, Landing>();
  for (const entry of paid) if (entry.txid && !byTxid.has(entry.txid)) byTxid.set(entry.txid, entry);
  const ordered = [...byTxid.values()].sort(
    (a, b) => (a.blockHeight ?? Number.MAX_SAFE_INTEGER) - (b.blockHeight ?? Number.MAX_SAFE_INTEGER),
  );
  return {
    txids: ordered.flatMap(entry => entry.txid ?? []),
    paidSat: ordered.reduce((sum, entry) => sum + (entry.paidSat ?? 0), 0),
    valueSat: paid.reduce((sum, entry) => sum + entry.valueSat, 0),
  };
}

/**
 * What the destination address ends up with: the value moved less what comes
 * off it, until the sweep and any co-signed recoveries confirm and the figure
 * is read off them. Each leaf no build holds yet adds its value less what its
 * quote put on it, and builds the plan replaced add what they paid. The
 * funding is not counted: it pays the other fees, and what it has left comes
 * back only if the sweep Glow built is the one that lands.
 */
export function willReceiveSat(exit: Quote | UnilateralExitPlan, resuming: UnilateralExitPlan | null = null): number {
  if (!('exit' in exit)) {
    return Math.max(0, exit.recoverableValueSats - quotedSweepFeeSat(exit, resuming));
  }
  const landing = exit.exit.transactions.filter(tx => tx.kind === 'sweep' || isCooperative(tx));
  const outputs = landing.every(tx => tx.status.type === 'confirmed') ? landing.map(tx => outputTotalSat(tx.txHex)) : [];
  const landed = outputs.length > 0 && outputs.every(sat => sat !== null);
  const current = landed
    ? outputs.reduce<number>((sum, sat) => sum + (sat ?? 0), 0)
    : Math.max(0, exit.exit.recoverableValueSats - exit.quotedSweepFeeSat);
  const unbuilt = unbuiltLeaves(exit).reduce((sum, leaf) => sum + Math.max(0, leaf.valueSats - (leaf.feeSat ?? 0)), 0);
  return current + unbuilt + paidOut(priorLandings(exit)).paidSat;
}

/** Whether a quote moves anything worth more than it costs to move. */
export const isWorthExiting = (quote: Quote, receiveSat: number = willReceiveSat(quote)): boolean =>
  quote.leaves.length > 0 && quote.totalFeeSats < quote.recoverableValueSats && receiveSat > 0;

/** What the quote leaves behind: the leaves it skipped, whatever the reason. */
export const leftOutSat = (quote: Quote): number => quote.skipped.reduce((sum, leaf) => sum + leaf.valueSats, 0);

/** Every leaf the quote leaves behind is worth less than its own fee at this rate. */
const leftOutForFees = (quote: Quote): boolean =>
  quote.skipped.length > 0 && quote.skipped.every(leaf => leaf.reason.type === 'feeExceedsValue');

const RETRY_LATER_REASONS = new Set(['unverified', 'fundsNotFound']);

/**
 * A skip that may yet move, so its leaf is tried again rather than let go. A
 * leaf the operators' watchtower stopped quotes as unrecoverable until they
 * relabel it, then quotes co-signed. A quote saved without `exitChainState`
 * stops none.
 */
export const isProvisionalSkip = (skip: SkippedLeaf, quote: Quote): boolean =>
  RETRY_LATER_REASONS.has(skip.reason.type) ||
  (skip.reason.type === 'notRecoverable' && !!quote.exitChainState?.stoppedLeafIds?.includes(skip.leafId));

export type LeftOutReason = 'unavailable' | 'fees' | 'notRecoverable';

/**
 * The one reason an empty quote gives, null when it skipped nothing. A leaf
 * that may yet move outranks one the fee eats, and only skips that are all
 * unrecoverable say so.
 */
export function leftOutReason(quote: Quote): LeftOutReason | null {
  const { skipped } = quote;
  if (skipped.length === 0) return null;
  if (skipped.some(leaf => isProvisionalSkip(leaf, quote))) return 'unavailable';
  return skipped.some(leaf => leaf.reason.type === 'feeExceedsValue') ? 'fees' : 'notRecoverable';
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
  /** Everything left out costs more to move than it holds, which the Unilateral Exit's card says. */
  leftOutForFees: boolean;
  leftOutReason: LeftOutReason | null;
  /** Some of it is co-signed, so the fee is more than the sweep's. */
  isCooperative: boolean;
  isEmpty: boolean;
  isWorthMoving: boolean;
}

/** A quote's figures as both flows show them. `resuming` is the exit a rebuild re-quotes. */
export function quoteFigures(
  quote: Quote,
  { resuming = null }: { resuming?: UnilateralExitPlan | null } = {},
): QuoteFigures {
  const recoverableSat = cooperativeValueSat(quote);
  const coopFeeSat = quote.cooperativeFeeSats;
  const receiveSat = willReceiveSat(quote, resuming);
  const recoverableReceiveSat = Math.max(0, recoverableSat - coopFeeSat);
  return {
    fundsSat: quote.recoverableValueSats,
    balanceSat: quote.recoverableValueSats - recoverableSat,
    recoverableSat,
    networkFeeSat: quotedSweepFeeSat(quote, resuming),
    exitFeeSat: exitFeeSat(quote),
    needsFunding: needsFunding(quote),
    willReceiveSat: receiveSat,
    recoverableReceiveSat,
    balanceReceiveSat: Math.max(0, receiveSat - recoverableReceiveSat),
    leftOutSat: leftOutSat(quote),
    leftOutForFees: leftOutForFees(quote),
    leftOutReason: leftOutReason(quote),
    isCooperative: recoverableSat > 0 || coopFeeSat > 0,
    isEmpty: quote.leaves.length === 0,
    isWorthMoving: isWorthExiting(quote, receiveSat),
  };
}
