import type { RecoveryTransaction } from '@breeztech/breez-sdk-spark';
import { isCooperative, paidOut, priorLandings, unbuiltLeaves, willReceiveSat } from '../quote';
import { leftoverIdsOf, type UnilateralExitPlan } from './plan';

/**
 * Where the money is. A leaf sits in Spark until its refund is on-chain, then
 * in an output only the owner can spend, and reaches the destination when the
 * sweep confirms. A co-signed leaf reaches it when its own recovery confirms.
 */
export interface ExitStages {
  inSpark: number;
  onChain: number;
  delivered: number;
  willReceive: number;
}

export function exitStages(plan: UnilateralExitPlan): ExitStages {
  const { transactions, leaves } = plan.exit;
  const confirmedFor = (matches: (tx: RecoveryTransaction) => boolean) =>
    new Set(transactions.filter(tx => matches(tx) && tx.status.type === 'confirmed').map(tx => tx.nodeId));
  const refunded = confirmedFor(tx => tx.kind === 'refund');
  const recovered = confirmedFor(isCooperative);
  const valueOf = (ids: Set<string | undefined>) =>
    leaves.filter(leaf => ids.has(leaf.leafId)).reduce((sum, leaf) => sum + leaf.valueSats, 0);
  const total = leaves.reduce((sum, leaf) => sum + leaf.valueSats, 0);
  // Leaf values throughout, so the total holds still and willReceive is the one net figure.
  const swept = transactions.some(tx => tx.kind === 'sweep' && tx.status.type === 'confirmed');
  const onChain = swept ? 0 : valueOf(refunded);
  const paidSat = valueOf(recovered) + (swept ? valueOf(refunded) : 0);
  // A leaf no build holds yet has not started to move.
  const waitingSat = unbuiltLeaves(plan).reduce((sum, leaf) => sum + leaf.valueSats, 0);
  // Leaves earlier builds paid out are delivered, though this build never held them.
  const delivered = paidSat + paidOut(priorLandings(plan)).valueSat;
  return { inSpark: total - onChain - paidSat + waitingSat, onChain, delivered, willReceive: willReceiveSat(plan) };
}

/**
 * Blocks until the last step could confirm: the longest path left through the
 * set, each step costing its remaining timelock plus a block to confirm in.
 * Null once nothing is left to send. Relies on the sdk returning the set in
 * broadcast order, so a dependency is always reached before what depends on it.
 */
export function blocksToFinish(all: RecoveryTransaction[], tipHeight: number): number | null {
  const after = new Map<string, number>();
  let longest: number | null = null;

  for (const tx of all) {
    if (tx.status.type === 'confirmed') {
      after.set(tx.txid, 0);
      continue;
    }
    // A ready step's timelock has matured; a started one counts down from the
    // height the sdk gives; one not yet started lies wholly ahead of whatever
    // its dependency waits on.
    const timelock =
      tx.status.type === 'ready'
        ? 0
        : tx.status.type === 'waitingForTimelock' && tx.status.spendableAtHeight !== undefined
          ? Math.max(0, tx.status.spendableAtHeight - tipHeight)
          : (tx.csvTimelockBlocks ?? 0);
    const waits = tx.dependsOn.map(id => after.get(id) ?? 0);
    const blocks = (waits.length > 0 ? Math.max(...waits) : 0) + timelock + 1;

    after.set(tx.txid, blocks);
    longest = longest === null ? blocks : Math.max(longest, blocks);
  }
  return longest;
}

export interface PlanProgress {
  confirmed: number;
  total: number;
  isComplete: boolean;
}

/**
 * `isComplete` follows the sdk's verdict: every transaction confirmed, co-signed
 * ones included. A transaction an earlier build landed counts as one of them,
 * and a leaf no build holds yet as one still to go.
 */
export function planProgress(plan: UnilateralExitPlan): PlanProgress {
  const { transactions } = plan.exit;
  const prior = paidOut(priorLandings(plan)).txids.length;
  const confirmed = transactions.filter(tx => tx.status.type === 'confirmed').length + prior;
  const total = transactions.length + prior + leftoverIdsOf(plan).length;
  return { confirmed, total, isComplete: plan.phase === 'complete' };
}

export interface NextAction {
  blocks: number;
  /** How many steps that wait releases. */
  transactions: number;
}

/**
 * The next timelock to mature, and what it frees. A step that is ready is
 * already being sent, so it is not something to wait for.
 */
export function nextAction(all: RecoveryTransaction[], tipHeight: number): NextAction | null {
  const waits = all.flatMap(tx =>
    tx.status.type === 'waitingForTimelock' && tx.status.spendableAtHeight !== undefined
      ? [Math.max(0, tx.status.spendableAtHeight - tipHeight)]
      : [],
  );
  if (waits.length === 0) return null;
  const blocks = Math.min(...waits);
  return { blocks, transactions: waits.filter(w => w === blocks).length };
}
