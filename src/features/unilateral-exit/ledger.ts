import type { PrepareRecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import type { ChainClient } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { inputOutpoints, outputTotalSat } from '@/utils/rawTx';
import { namedLeavesOf, type Landing, type UnilateralExitPlan } from './model/plan';
import { isCooperative } from './quote';

/**
 * Adds what the build landed to the ledger. A sweep confirms by its own txid,
 * so its hex says what it paid. The SDK confirms a co-signed recovery once any
 * spend of its output is in a block, so that entry waits for the spender.
 */
export function recordLanded(plan: UnilateralExitPlan): UnilateralExitPlan {
  const before = plan.landed ?? [];
  const landed = [...before];
  const { transactions, leaves } = plan.exit;
  const covered = new Set(before.flatMap(entry => entry.leafIds));
  const recorded = new Set(before.flatMap(entry => entry.txid ?? []));
  const valueOf = (ids: string[]) =>
    leaves.filter(leaf => ids.includes(leaf.leafId)).reduce((sum, leaf) => sum + leaf.valueSats, 0);

  for (const tx of transactions) {
    if (tx.status.type !== 'confirmed') continue;
    if (tx.kind === 'sweep' && !recorded.has(tx.txid)) {
      const paidSat = outputTotalSat(tx.txHex);
      if (paidSat === null) continue;
      // A leaf already waiting on a read is not counted twice.
      const leafIds = transactions.flatMap(refund =>
        refund.kind === 'refund' && refund.nodeId && tx.dependsOn.includes(refund.txid) && !covered.has(refund.nodeId)
          ? [refund.nodeId]
          : [],
      );
      leafIds.forEach(id => covered.add(id));
      landed.push({ leafIds, valueSat: valueOf(leafIds), txid: tx.txid, paidSat, blockHeight: tx.status.blockHeight });
    } else if (isCooperative(tx) && tx.nodeId && !covered.has(tx.nodeId)) {
      const [outpoint] = inputOutpoints(tx.txHex);
      if (!outpoint) continue;
      covered.add(tx.nodeId);
      landed.push({ leafIds: [tx.nodeId], valueSat: valueOf([tx.nodeId]), outpoint });
    }
  }
  return landed.length === before.length ? plan : { ...plan, landed };
}

/** Whether the ledger still waits on a read of what paid an entry out. */
export const hasWaitingLanding = (plan: UnilateralExitPlan): boolean => (plan.landed ?? []).some(entry => !entry.txid);

/**
 * The output whose spender paid `leafId` out, read off the build being
 * replaced: a co-signed recovery's input, the sweep's input from the leaf's
 * refund, or the output of a leaf whose co-signing failed.
 */
function landingOutpoint(plan: UnilateralExitPlan, leafId: string): string | undefined {
  const { transactions, failed } = plan.exit;
  const cosigned = transactions.find(tx => isCooperative(tx) && tx.nodeId === leafId);
  const fromCosigned = cosigned && inputOutpoints(cosigned.txHex)[0];
  if (fromCosigned) return fromCosigned;
  const refund = transactions.find(tx => tx.kind === 'refund' && tx.nodeId === leafId);
  const sweep = transactions.find(tx => tx.kind === 'sweep');
  const fromSweep = refund && sweep && inputOutpoints(sweep.txHex).find(outpoint => outpoint.startsWith(`${refund.txid}:`));
  if (fromSweep) return fromSweep;
  const failure = failed.find(f => f.leafId === leafId);
  return failure && `${failure.outputTxid}:${failure.outputVout}`;
}

/**
 * The ledger with a waiting entry for each of `ids` that `quote` lists nowhere,
 * which means it landed; with no quote, each of them. Recorded now, because
 * the build about to be replaced is the last place its outpoint exists.
 */
export function withLanded(
  plan: UnilateralExitPlan,
  quote: PrepareRecoverFundsResponse | null,
  ids: string[] = namedLeavesOf(plan).map(leaf => leaf.leafId),
): Landing[] | undefined {
  const listed = new Set(quote ? [...quote.leaves, ...quote.skipped].map(leaf => leaf.leafId) : []);
  const covered = new Set((plan.landed ?? []).flatMap(entry => entry.leafIds));
  const values = new Map([...namedLeavesOf(plan), ...plan.exit.leaves].map(leaf => [leaf.leafId, leaf.valueSats]));
  const added = ids.flatMap(leafId => {
    if (listed.has(leafId) || covered.has(leafId)) return [];
    const outpoint = landingOutpoint(plan, leafId);
    return outpoint ? [{ leafIds: [leafId], valueSat: values.get(leafId) ?? 0, outpoint }] : [];
  });
  return added.length > 0 ? [...(plan.landed ?? []), ...added] : plan.landed;
}

/** Six blocks is the SDK's own re-check depth. */
const UNREAD_LANDING_BLOCKS = 6;

/**
 * Reads what paid each waiting entry out, one at a time to go easy on the
 * chain service's rate limit. An entry nothing spent in a block for six blocks
 * is dropped, so an exit never waits forever on an output it misjudged.
 */
export async function settleLanded(
  plan: UnilateralExitPlan,
  chain: ChainClient,
  tipHeight: number,
): Promise<UnilateralExitPlan> {
  if (!hasWaitingLanding(plan)) return plan;
  const destination = plan.destination.toLowerCase();
  const landed: Landing[] = [];
  for (const entry of plan.landed ?? []) {
    if (entry.txid) {
      landed.push(entry);
      continue;
    }
    // With nothing to read it by, an entry could only hold the exit up.
    const split = entry.outpoint?.lastIndexOf(':') ?? -1;
    if (!entry.outpoint || split < 0) continue;
    try {
      const spend = await chain.confirmedSpender(entry.outpoint.slice(0, split), Number(entry.outpoint.slice(split + 1)));
      if (spend) {
        const paidSat = spend.outputs
          .filter(output => output.address?.toLowerCase() === destination)
          .reduce((sum, output) => sum + output.value, 0);
        landed.push({ ...entry, txid: spend.txid, blockHeight: spend.blockHeight, paidSat, unreadSince: undefined });
        continue;
      }
      const unreadSince = entry.unreadSince ?? tipHeight;
      if (tipHeight - unreadSince < UNREAD_LANDING_BLOCKS) landed.push({ ...entry, unreadSince });
      else logger.warn(LogCategory.SDK, 'Gave up on reading what spent an exit output');
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to read what spent an exit output', {
        error: e instanceof Error ? e.message : String(e),
      });
      landed.push(entry);
    }
  }
  return { ...plan, landed };
}
