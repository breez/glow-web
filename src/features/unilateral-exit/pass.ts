import type { ChainClient, ChainUtxo } from '@/services/chain';
import { broadcastReadyTransactions } from './broadcast';
import { checkAndPace } from './check';
import { readHeldSat, withHeldSat } from './exitFee';
import { recordLanded, settleLanded } from './ledger';
import { retryLeftovers } from './leftovers';
import { isActive, isLanded, leftoverIdsOf, type UnilateralExitPlan } from './model/plan';
import type { ExitSdk } from './quoting';
import { rebuildIfNeeded } from './rebuild';

/**
 * One pass over an exit. `identityPubkey` marks the plan slot, the one place a
 * leaf the exit left out stays part of it. `feeCoins` are what its fee
 * address holds while a leftover waits on more exit fee, as last read; absent
 * when that read failed.
 */
export async function advanceUnilateralExit(
  plan: UnilateralExitPlan,
  chain: ChainClient,
  sdk?: ExitSdk,
  identityPubkey?: string,
  feeCoins?: ChainUtxo[],
): Promise<{ plan: UnilateralExitPlan; tipHeight: number }> {
  const tipHeight = await chain.tipHeight();
  // Finished, whatever a check would now say: it only waits for its ledger to
  // be read, and then to be archived.
  if (plan.status.type === 'done') return { plan: await settleLanded(recordLanded(plan), chain, tipHeight), tipHeight };

  const check = await checkAndPace(plan, sdk, tipHeight, !!identityPubkey);
  let next = check.plan;
  if (sdk && identityPubkey) next = await rebuildIfNeeded(next, sdk, identityPubkey, tipHeight, check.checked);
  next = withHeldSat(next, feeCoins);
  // Skipped in a pass that rebuilt, which already prepared every leaf again.
  if (check.checked && sdk && isActive(next) && next.exit === check.plan.exit) {
    next = await retryLeftovers(next, sdk, tipHeight, check.retryNow, identityPubkey, feeCoins);
  }
  next = await readHeldSat(next, chain, feeCoins);
  // What the Done verdict waited on is settled, so the exit is finished.
  if (check.doneSet && isActive(next) && isLanded(next.exit) && leftoverIdsOf(next).length === 0) {
    next = { ...next, status: { type: 'done' } };
  }

  // Sent before the reads, so a failing chain service never holds a step back.
  const sent = isActive(next) ? await broadcastReadyTransactions(next, chain) : next;
  return { plan: await settleLanded(sent, chain, tipHeight), tipHeight };
}
