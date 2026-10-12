import { formatBlockWait } from '@/utils/blockTime';
import { formatWithSpaces } from '@/utils/formatNumber';
import {
  heldRecoveryLeaves,
  isPendingFunded,
  namedLeavesOf,
  nextAction,
  pendingTopUp,
  planProgress,
  type PendingExit,
  type UnilateralExitPlan,
} from './driver';
import { isCooperativeLeaf, isEstimate, willReceiveSat } from './quote';
import { recoveryTxid, type ArchivedExit } from './archive';
import type { UnilateralExitEngineState } from './engine';

/**
 * One row of the transaction list's exit group. An exit is not a payment the
 * sdk knows about, so the list is handed these rather than reading them off
 * `Payment`.
 */
export interface UnilateralExitEntry {
  id: string;
  title: string;
  subtitle: string | null;
  /** The subtitle asks for a tap, so it takes the amount's color, as "Tap to claim" does. */
  isAction?: boolean;
  amountSat: number;
  /** `amountSat` is what an exit still under way expects to deliver. */
  isEstimate?: boolean;
  /**
   * `active` is in flight, so it pulses and opens the flow. `recoverable` opens
   * Recover Funds, or beside an exit under way that exit's tracker. `recovery`
   * is a kept co-signed recovery: in flight like `active`, with a tracker of
   * its own. `archived` opens its details.
   */
  kind: 'recoverable' | 'active' | 'recovery' | 'archived';
  /** Unix seconds a finished exit landed, so its row dates itself like a payment. */
  timestamp?: number;
}

const activeSubtitle = (state: UnilateralExitEngineState): string | null => {
  const plan = state.plan;
  if (!plan) return null;
  if (plan.phase === 'redo') return 'Tap to continue';

  const { confirmed, total } = planProgress(plan);
  const blocks =
    state.tipHeight === null
      ? null
      : (nextAction(plan.exit.transactions, state.tipHeight)?.blocks ?? null);
  // The row's title already says these are transactions.
  const processed = `${confirmed} of ${total} processed`;
  return blocks === null ? processed : `${processed}, next ${formatBlockWait(blocks)}`;
};

/** What the row says while the exit waits on its fee, so the list answers what to do next. */
const pendingText = (
  state: UnilateralExitEngineState,
  pending: PendingExit,
): Pick<UnilateralExitEntry, 'title' | 'subtitle' | 'isAction'> => {
  const coins = state.pendingCoins;
  if (state.nothingToExit) return { title: 'Nothing to exit', subtitle: 'Tap to cancel', isAction: true };

  const stillToSend = pendingTopUp(pending, coins).stillToSendSat;
  if (stillToSend > 0) {
    const amount = `₿${formatWithSpaces(stillToSend)}`;
    return { title: 'Waiting for exit fee', subtitle: coins.length > 0 ? `Send ${amount} more` : `Send ${amount} to start` };
  }
  if (!isPendingFunded(pending, coins)) return { title: 'Exit fee sent', subtitle: 'Waiting for a confirmation' };
  return { title: 'Exit fee received', subtitle: 'Tap to start', isAction: true };
};

const archivedEntry = (exit: ArchivedExit): UnilateralExitEntry => ({
  id: exit.id,
  // The same words a withdrawal gets, since that is what landed on-chain.
  title: 'BTC Transfer',
  subtitle: null,
  amountSat: exit.deliveredSat,
  kind: 'archived',
  timestamp: Math.floor(exit.completedAt / 1000),
});

/** The list row of a kept co-signed recovery, which the wallet page also finds it by. */
export const recoveryEntryId = (recovery: UnilateralExitPlan): string => `recovery:${recoveryTxid(recovery) ?? ''}`;

// The same words as a finished one: it is already on its way on-chain.
const recoveryEntry = (recovery: UnilateralExitPlan): UnilateralExitEntry => ({
  id: recoveryEntryId(recovery),
  title: 'BTC Transfer',
  subtitle: 'Waiting for a confirmation',
  amountSat: willReceiveSat(recovery),
  isEstimate: isEstimate(recovery),
  kind: 'recovery',
});

const inFlight = (recoveries: UnilateralExitPlan[]) => recoveries.filter(r => r.phase !== 'complete');

/**
 * Whether a unilateral leaf of the exit has left the balance: getInfo counts
 * it as recoverable only once the operators see its branch on-chain. Walks up
 * from the leaf's refund through what it depends on.
 */
function branchOnChain(plan: UnilateralExitPlan, leafId: string): boolean {
  const byTxid = new Map(plan.exit.transactions.map(tx => [tx.txid, tx]));
  const queue = plan.exit.transactions.filter(tx => tx.kind === 'refund' && tx.nodeId === leafId);
  const seen = new Set<string>();
  for (let tx = queue.shift(); tx; tx = queue.shift()) {
    if (seen.has(tx.txid)) continue;
    seen.add(tx.txid);
    if ((tx.kind === 'node' || tx.kind === 'refund') && tx.status.type === 'confirmed') return true;
    queue.push(...tx.dependsOn.flatMap(txid => byTxid.get(txid) ?? []));
  }
  return false;
}

/**
 * The plan's leaves that getInfo counts as recoverable, by ID. A co-signed leaf
 * and a recovery's leaves were outside the balance from the start; a leaf the
 * last rebuild skipped has left it too. A leaf whose co-signing failed is left
 * out, so it stays in the Recoverable Funds row.
 */
function planLeavesOutside(plan: UnilateralExitPlan): Map<string, number> {
  const failed = new Set(plan.exit.failed.map(f => f.leafId));
  const built = new Map(plan.exit.leaves.map(leaf => [leaf.leafId, leaf]));
  const outside = new Map<string, number>();
  for (const { leafId, valueSats } of namedLeavesOf(plan)) {
    if (failed.has(leafId)) continue;
    const leaf = built.get(leafId);
    const counted = !leaf || isCooperativeLeaf(leaf) || plan.mode === 'recover' || branchOnChain(plan, leafId);
    if (counted) outside.set(leafId, leaf?.valueSats ?? valueSats);
  }
  return outside;
}

/** What getInfo's recoverable total holds that the plan and the kept recoveries are already moving. */
function inFlightSat({ plan, recoveries }: UnilateralExitEngineState): number {
  const moving = plan ? planLeavesOutside(plan) : new Map<string, number>();
  for (const leaf of inFlight(recoveries).flatMap(heldRecoveryLeaves)) moving.set(leaf.leafId, leaf.valueSats);
  return [...moving.values()].reduce((sum, sat) => sum + sat, 0);
}

/**
 * What getInfo's `recoverableSat` holds beyond what is already on its way. A
 * pending exit's start takes every leaf in, so the row waits for it. Beside a
 * running exit the row has nothing to offer yet, so it asks for no tap.
 */
const recoverableEntry = (state: UnilateralExitEngineState, recoverableSat: number): UnilateralExitEntry | null => {
  if (state.pending) return null;
  const leftSat = recoverableSat - inFlightSat(state);
  if (leftSat <= 0) return null;
  const canRecover = !state.plan;
  return {
    id: 'recoverable',
    title: 'Recoverable Funds',
    subtitle: canRecover ? 'Tap to recover' : null,
    isAction: canRecover,
    amountSat: leftSat,
    kind: 'recoverable',
  };
};

const liveEntry = (state: UnilateralExitEngineState): UnilateralExitEntry | null => {
  const { plan, pending } = state;
  if (!plan && pending) {
    return {
      id: 'pending',
      ...pendingText(state, pending),
      amountSat: pending.willReceiveSat,
      isEstimate: isEstimate(pending),
      kind: 'active',
    };
  }
  if (!plan || plan.phase === 'complete') return null;
  return {
    id: 'active',
    title: plan.phase === 'redo' ? 'Update needed' : 'Transactions in progress',
    subtitle: activeSubtitle(state),
    isAction: plan.phase === 'redo',
    amountSat: willReceiveSat(plan),
    isEstimate: isEstimate(plan),
    kind: 'active',
  };
};

/**
 * The group's rows: kept co-signed recoveries, the exit's live row, what is
 * left to recover, then finished exits. getInfo's `recoverableSat` counts
 * in-flight leaves until they confirm, so the Recoverable Funds row shows only
 * what the exit and the kept recoveries leave of it.
 */
export function unilateralExitEntries(
  state: UnilateralExitEngineState,
  recoverableSat = 0,
): UnilateralExitEntry[] {
  const live = liveEntry(state);
  const recoverable = recoverableEntry(state, recoverableSat);
  return [
    ...inFlight(state.recoveries).map(recoveryEntry),
    ...(live ? [live] : []),
    ...(recoverable ? [recoverable] : []),
    ...state.archive.map(archivedEntry),
  ];
}

/**
 * The group's heading. Once the user has started a unilateral exit, running or
 * finished, what turns up later is recovered as part of it, so only a wallet
 * that never started one heads the group Recovery.
 */
export function exitGroupTitle({ plan, pending, archive }: UnilateralExitEngineState): string {
  const exited = [plan, pending, ...archive].some(record => record && record.mode !== 'recover');
  return exited ? 'Unilateral Exit' : 'Recovery';
}
