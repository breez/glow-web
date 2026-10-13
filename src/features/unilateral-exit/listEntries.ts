import { formatBlockWait } from '@/utils/blockTime';
import { formatWithSpaces } from '@/utils/formatNumber';
import {
  awaitsUpdate,
  canBumpRecovery,
  heldRecoveryLeaves,
  isPendingFunded,
  isUnilateralLanded,
  leftoverTopUp,
  nextAction,
  pendingTopUp,
  planProgress,
  type PendingExit,
  type UnilateralExitPlan,
} from './driver';
import { isCooperativeLeaf, unbuiltLeaves, willReceiveSat } from './quote';
import { recoveryTxid, type ArchivedExit } from './archive';
import { landedLeavesOf, unsettledLeaves } from './accounting';
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
  if (awaitsUpdate(plan)) return 'Tap to update';

  const { confirmed, total } = planProgress(plan);
  // A diverged exit's timelocks belong to the set its rebuild replaces.
  const blocks =
    state.tipHeight === null || plan.phase === 'redo'
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

/**
 * What the row says while a leaf the exit left out waits on more exit fee.
 * Unconfirmed coins count toward what is still to send, as for a pending exit.
 */
const topUpText = (
  state: UnilateralExitEngineState,
  plan: UnilateralExitPlan,
): Pick<UnilateralExitEntry, 'title' | 'subtitle' | 'isAction'> => {
  const coins = state.pendingCoins;
  const received = leftoverTopUp(plan, coins.filter(coin => coin.confirmed)).stillToSendSat === 0;
  if (plan.topUp?.needsSignIn) {
    const title = received ? 'Exit fee received' : 'Waiting for exit fee';
    // The tap builds nothing over a unilateral step in flight, so it is not asked for yet.
    if (!isUnilateralLanded(plan.exit)) return { title, subtitle: 'Waiting for a confirmation' };
    return { title, subtitle: 'Tap to update', isAction: true };
  }
  const stillToSend = leftoverTopUp(plan, coins).stillToSendSat;
  if (stillToSend > 0) return { title: 'Waiting for exit fee', subtitle: `Send ₿${formatWithSpaces(stillToSend)} more` };
  if (!received) return { title: 'Exit fee sent', subtitle: 'Waiting for a confirmation' };
  return { title: 'Exit fee received', subtitle: null };
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

/** What a kept recovery's tracker opens Rebuild at a higher fee for, or null where it offers none. */
export const bumpTxidOf = (recovery: UnilateralExitPlan): string | null =>
  canBumpRecovery(recovery) ? recoveryTxid(recovery) : null;

// The same words as a finished one: it is already on its way on-chain.
const recoveryEntry = (recovery: UnilateralExitPlan): UnilateralExitEntry => ({
  id: recoveryEntryId(recovery),
  title: 'BTC Transfer',
  subtitle: 'Waiting for a confirmation',
  amountSat: willReceiveSat(recovery),
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
 * and a recovery's leaves were outside the balance from the start; a leaf no
 * build holds, skipped or not co-signed, has left it too.
 */
function planLeavesOutside(plan: UnilateralExitPlan): Map<string, number> {
  const outside = new Map(unbuiltLeaves(plan).map(leaf => [leaf.leafId, leaf.valueSats]));
  for (const leaf of plan.exit.leaves) {
    const counted = isCooperativeLeaf(leaf) || plan.mode === 'recover' || branchOnChain(plan, leaf.leafId);
    if (counted) outside.set(leaf.leafId, leaf.valueSats);
  }
  return outside;
}

/**
 * What getInfo's recoverable total holds that is accounted for already: what
 * the plan and the kept recoveries are moving, what any record landed that no
 * sync has recounted since, and the leaves any record dropped as unrecoverable,
 * which getInfo goes on counting.
 */
function accountedSat(state: UnilateralExitEngineState): number {
  const { plan, recoveries, archive, accounting } = state;
  const accounted = plan ? planLeavesOutside(plan) : new Map<string, number>();
  for (const leaf of inFlight(recoveries).flatMap(heldRecoveryLeaves)) accounted.set(leaf.leafId, leaf.valueSats);
  for (const record of [plan, ...recoveries]) {
    for (const leaf of record ? landedLeavesOf(record) : []) accounted.delete(leaf.leafId);
  }
  const dropped = [plan, ...recoveries, ...archive, accounting].flatMap(record => record?.droppedLeaves ?? []);
  for (const leaf of [...unsettledLeaves(state), ...dropped]) accounted.set(leaf.leafId, leaf.valueSats);
  return [...accounted.values()].reduce((sum, sat) => sum + sat, 0);
}

/**
 * What getInfo's `recoverableSat` holds beyond what is accounted for. A
 * pending exit's start takes every leaf in, so the row waits for it. Beside a
 * running exit the row has nothing to offer yet, so it asks for no tap.
 */
const recoverableEntry = (state: UnilateralExitEngineState, recoverableSat: number): UnilateralExitEntry | null => {
  if (state.pending) return null;
  const leftSat = recoverableSat - accountedSat(state);
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
      kind: 'active',
    };
  }
  if (!plan) return null;
  // Ahead of the update tap: an exit waiting on its fee says what to send.
  if (plan.topUp) return { id: 'active', ...topUpText(state, plan), amountSat: willReceiveSat(plan), kind: 'active' };
  // A finished exit waiting on a read of what landed keeps its row until the
  // archive's takes over, so the exit never drops out of the list meanwhile.
  return {
    id: 'active',
    title: awaitsUpdate(plan) ? 'Update needed' : 'Transactions in progress',
    subtitle: activeSubtitle(state),
    isAction: awaitsUpdate(plan),
    amountSat: willReceiveSat(plan),
    kind: 'active',
  };
};

/**
 * The group's rows: kept co-signed recoveries, the exit's live row, what is
 * left to recover, then finished exits. getInfo's `recoverableSat` counts
 * in-flight leaves, and landed ones until a sync recounts, so the Recoverable
 * Funds row shows only what the records and their accounting leave of it.
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
