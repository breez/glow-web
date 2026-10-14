import { logger, LogCategory } from '@/services/logger';
import type { ExitMode, NamedLeaf, UnilateralExitPlan, WalletKey } from '../model/plan';
import { exitFeeRecordOf, isCooperative, paidOut, type PaidOut } from '../quote';

/**
 * A finished exit, kept once its plan slot is handed to the next one. The plan
 * lives at a single key per wallet, so without this a second exit erases the
 * record of the first.
 */
export interface ArchivedExit {
  /**
   * The key it is stored under: the last build's own sweep or first co-signed
   * recovery (`recoveryTxid`), not necessarily a transaction that landed.
   */
  id: string;
  destination: string;
  deliveredSat: number;
  completedAt: number;
  // Absent on exits archived before they were recorded.
  network?: string;
  /** What left Spark, recoverable funds included. */
  exitedSat?: number;
  /** The part of `exitedSat` that was outside the balance when the exit began. Absent on a recovery, all of which was. */
  recoverableFundsSat?: number;
  /** What was sent to the exit fee address, from another wallet. */
  exitFeePaidSat?: number;
  /** What the last build's transactions paid in fees (`totalFeeSats`). Absent on records from before it was kept. */
  networkFeeSat?: number;
  /**
   * What the exit left at its fee address as it finished. Kept rather than read
   * again: the address is shared, so a later read would count another exit's.
   */
  unspentExitFeeSat?: number;
  /**
   * Where the exit fee was sent. The part the exit did not spend stays there
   * when a watchtower's refund lands first, rather than reaching the destination.
   */
  exitFeeAddress?: string;
  mode?: ExitMode;
  /**
   * Each transaction in a block that paid the destination, in block order.
   * Absent on records from before the ledger, whose `id` stands in.
   */
  txids?: string[];
  /** Leaves the exit named that a quote found unrecoverable, kept so the Recoverable Funds row still leaves them out. */
  droppedLeaves?: NamedLeaf[];
}

const key = ({ identityPubkey, network }: WalletKey): string =>
  `unilateral-exit-archive:${identityPubkey.slice(0, 16)}:${network}`;

/**
 * The transaction that delivers a plan's money: its sweep, or for one with only
 * co-signed recoveries the first of those. Null for a plan with neither.
 */
export const recoveryTxid = (plan: UnilateralExitPlan): string | null =>
  plan.exit.transactions.find(tx => tx.kind === 'sweep')?.txid ??
  plan.exit.transactions.find(isCooperative)?.txid ??
  null;

/** Leaves a plan or record dropped as unrecoverable, which Glow's fresh quotes leave out. */
export const droppedLeafIds = (records: { droppedLeaves?: NamedLeaf[] }[]): Set<string> =>
  new Set(records.flatMap(record => record.droppedLeaves ?? []).map(leaf => leaf.leafId));

export function loadArchive(wallet: WalletKey): ArchivedExit[] {
  const raw = localStorage.getItem(key(wallet));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ArchivedExit[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * What landed of the leaves outside the balance when the exit began. Not the
 * final build's co-signed part: a leaf the watchtower moved mid-exit comes
 * back co-signed, and was balance. A plan from before `recoverableLeafIds`
 * has only its first build's figure, capped at what exited.
 */
function recoverableLandedSat(plan: UnilateralExitPlan, valueSat: number): number {
  const outside = new Set(plan.recoverableLeafIds ?? []);
  return plan.recoverableLeafIds
    ? paidOut((plan.landed ?? []).filter(entry => entry.leafIds.length > 0 && entry.leafIds.every(id => outside.has(id)))).valueSat
    : Math.min(plan.recoverableFundsSat ?? 0, valueSat);
}

function archivedExitOf(
  plan: UnilateralExitPlan,
  id: string,
  { txids, paidSat, valueSat }: PaidOut,
  unspentExitFeeSat?: number,
): ArchivedExit {
  // What its builds recorded as paid, not what the address holds: a rebuild
  // takes in every confirmed coin there, the exit's own change included, so
  // summing those counts the same sats twice.
  const { quotedExitFeeSat, exitFeeAddress } = exitFeeRecordOf(plan);
  const recoverableSat = recoverableLandedSat(plan, valueSat);
  return {
    id,
    destination: plan.destination,
    deliveredSat: paidSat,
    completedAt: Date.now(),
    network: plan.network,
    exitedSat: valueSat,
    recoverableFundsSat: plan.mode === 'recover' ? undefined : recoverableSat || undefined,
    exitFeePaidSat: quotedExitFeeSat,
    networkFeeSat: plan.exit.totalFeeSats,
    unspentExitFeeSat,
    exitFeeAddress,
    mode: plan.mode,
    txids,
    droppedLeaves: plan.droppedLeaves?.length ? plan.droppedLeaves : undefined,
  };
}

/**
 * Records a finished exit, newest first, from its ledger of what landed and
 * what it left at its fee address. Keyed on `recoveryTxid`, so an engine that
 * reports the same completion on every pass does not stack up duplicates.
 */
export function archiveExit(wallet: WalletKey, plan: UnilateralExitPlan, unspentExitFeeSat?: number): ArchivedExit[] {
  const paid = paidOut(plan.landed ?? []);
  if (paid.txids.length === 0) {
    logger.warn(LogCategory.SDK, 'Finished exit delivered nothing to archive');
    return loadArchive(wallet);
  }
  // A plan that ended with no transactions of its own falls back to what landed.
  const id = recoveryTxid(plan) ?? paid.txids[0];

  const existing = loadArchive(wallet);
  if (existing.some(entry => entry.id === id)) return existing;

  const next = [archivedExitOf(plan, id, paid, unspentExitFeeSat), ...existing];
  try {
    localStorage.setItem(key(wallet), JSON.stringify(next));
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to archive a finished unilateral exit', {
      error: e instanceof Error ? e.message : String(e),
    });
    return existing;
  }
  return next;
}
