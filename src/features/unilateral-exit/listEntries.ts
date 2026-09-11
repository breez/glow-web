import { formatBlockWait } from '@/utils/blockTime';
import { nextAction, planProgress, willReceiveSat } from './driver';
import type { ArchivedExit } from './archive';
import type { UnilateralExitEngineState } from './engine';

/**
 * One row of the transaction list's Unilateral Exit group. An exit is not a
 * payment the sdk knows about, so the list is handed these rather than reading
 * them off `Payment`.
 */
export interface UnilateralExitEntry {
  id: string;
  title: string;
  subtitle: string | null;
  amountSat: number;
  /** In flight, so the row pulses and opens the flow. A finished one opens its details. */
  isActive: boolean;
  /** Unix seconds a finished exit landed, so its row dates itself like a payment. */
  timestamp?: number;
}

const activeSubtitle = (state: UnilateralExitEngineState): string | null => {
  const plan = state.plan;
  if (!plan) return null;
  if (plan.phase === 'redo') return 'Open to continue it.';

  const { confirmed, total } = planProgress(plan);
  const blocks =
    state.tipHeight === null
      ? null
      : (nextAction(plan.exit.transactions, state.tipHeight)?.blocks ?? null);
  // The row's title already says these are transactions.
  const processed = `${confirmed} of ${total} processed`;
  return blocks === null ? processed : `${processed}, next ${formatBlockWait(blocks)}`;
};

const archivedEntry = (exit: ArchivedExit): UnilateralExitEntry => ({
  id: exit.id,
  // The same words a withdrawal gets, since that is what landed on-chain.
  title: 'BTC Transfer',
  subtitle: null,
  amountSat: exit.deliveredSat,
  isActive: false,
  timestamp: Math.floor(exit.completedAt / 1000),
});

/**
 * The group's rows, the exit in flight first. A completed exit stays as its own
 * row, so the group outlives the plan that produced it.
 */
export function unilateralExitEntries(state: UnilateralExitEngineState): UnilateralExitEntry[] {
  const archived = state.archive.map(archivedEntry);
  const plan = state.plan;
  if (!plan || plan.phase === 'complete') return archived;

  return [
    {
      id: 'active',
      title: plan.phase === 'redo' ? 'Update needed' : 'Transactions in progress',
      subtitle: activeSubtitle(state),
      amountSat: willReceiveSat(plan),
      isActive: true,
    },
    ...archived,
  ];
}
