import { formatBlockWait } from '@/utils/blockTime';
import { formatWithSpaces } from '@/utils/formatNumber';
import {
  isPendingFunded,
  nextAction,
  pendingTopUp,
  planProgress,
  type PendingExit,
  type UnilateralExitPlan,
} from './driver';
import { isEstimate, willReceiveSat } from './quote';
import type { ArchivedExit } from './archive';
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
   * the flow too but nothing is under way yet. `recovery` is a kept co-signed
   * recovery: in flight like `active`, but its tracker is not the exit flow's.
   * `archived` opens its details.
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

// The same words as a finished one: it is already on its way on-chain.
const recoveryEntry = (recovery: UnilateralExitPlan): UnilateralExitEntry => ({
  id: `recovery:${recovery.exit.transactions[0]?.txid ?? ''}`,
  title: 'BTC Transfer',
  subtitle: 'Waiting for a confirmation',
  amountSat: willReceiveSat(recovery),
  isEstimate: isEstimate(recovery),
  kind: 'recovery',
});

const inFlight = (recoveries: UnilateralExitPlan[]) => recoveries.filter(r => r.phase !== 'complete');

const liveEntry = (state: UnilateralExitEngineState, recoverableSat: number): UnilateralExitEntry | null => {
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
  if (!plan) {
    const keptSat = inFlight(state.recoveries).reduce((sum, r) => sum + r.exit.recoverableValueSat, 0);
    const leftSat = recoverableSat - keptSat;
    if (leftSat <= 0) return null;
    return {
      id: 'recoverable',
      title: 'Recoverable Funds',
      subtitle: 'Tap to recover',
      isAction: true,
      amountSat: leftSat,
      kind: 'recoverable',
    };
  }
  if (plan.phase === 'complete') return null;
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
 * The group's rows: kept co-signed recoveries, the exit's live row, then
 * finished exits. getInfo's `recoverableSat` counts in-flight leaves until
 * they confirm, so the Recoverable Funds row shows what the kept recoveries
 * leave of it, and only while no exit is saved: a pending exit's start takes
 * every leaf in, and a running one waits to land before taking more.
 */
export function unilateralExitEntries(
  state: UnilateralExitEngineState,
  recoverableSat = 0,
): UnilateralExitEntry[] {
  const live = liveEntry(state, recoverableSat);
  return [
    ...inFlight(state.recoveries).map(recoveryEntry),
    ...(live ? [live] : []),
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
