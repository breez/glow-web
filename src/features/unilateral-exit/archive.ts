import { logger, LogCategory } from '@/services/logger';
import { exitFeeRecordOf, isCooperative, paidOut } from './quote';
import type { ExitMode, UnilateralExitPlan, WalletKey } from './driver';

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
 * Records a finished exit, newest first, from its ledger of what landed. Keyed
 * on `recoveryTxid`, so an engine that reports the same completion on every
 * pass does not stack up duplicates.
 */
export function archiveExit(wallet: WalletKey, plan: UnilateralExitPlan): ArchivedExit[] {
  const { txids, paidSat, valueSat } = paidOut(plan.landed ?? []);
  if (txids.length === 0) {
    logger.warn(LogCategory.SDK, 'Finished exit delivered nothing to archive');
    return loadArchive(wallet);
  }
  // A plan that ended with no transactions of its own falls back to what landed.
  const id = recoveryTxid(plan) ?? txids[0];

  const existing = loadArchive(wallet);
  if (existing.some(entry => entry.id === id)) return existing;

  // What the exit was quoted to need, not what the address holds: a rebuild
  // takes in every confirmed coin there, the exit's own change included, so
  // summing those counts the same sats twice.
  const { quotedExitFeeSat, exitFeeAddress } = exitFeeRecordOf(plan);
  const next = [
    {
      id,
      destination: plan.destination,
      deliveredSat: paidSat,
      completedAt: Date.now(),
      network: plan.network,
      exitedSat: valueSat,
      // Not the final build's co-signed part: a leaf the watchtower moved
      // mid-exit is co-signed back, and was still part of the balance exited.
      // Capped, since part of what was outside the balance may not have landed.
      recoverableFundsSat: plan.mode === 'recover' ? undefined : Math.min(plan.recoverableFundsSat ?? 0, valueSat) || undefined,
      exitFeePaidSat: quotedExitFeeSat,
      exitFeeAddress,
      mode: plan.mode,
      txids,
    },
    ...existing,
  ];
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
