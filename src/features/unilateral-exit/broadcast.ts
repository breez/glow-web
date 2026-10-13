import type { RecoveryTransaction } from '@breeztech/breez-sdk-spark';
import type { ChainClient } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import type { UnilateralExitPlan } from './model/plan';
import { isCooperative } from './quote';

/**
 * What a pass sends: whatever the sdk resolved as ready against the chain tip,
 * timelock included. A co-signed recovery also goes out unverified, since the
 * network refuses it if its funds already moved.
 */
export const isSendable = (tx: RecoveryTransaction): boolean =>
  tx.status.type === 'ready' || (isCooperative(tx) && tx.status.type === 'unverified');

/**
 * Sends every step whose turn has come, again on every pass: a node already
 * holding one answers as if it were sent, and one the mempool has since dropped
 * is put back. A refusal is kept on the step and retried, since the operators'
 * watchtower may settle it with its own copy.
 */
export async function broadcastReadyTransactions(
  plan: UnilateralExitPlan,
  chain: ChainClient,
): Promise<UnilateralExitPlan> {
  const refusals = { ...plan.refusals };
  for (const tx of plan.exit.transactions.filter(isSendable)) {
    try {
      if (tx.cpfpTxHex) await chain.broadcastPackage(tx.txHex, tx.cpfpTxHex);
      else await chain.broadcast(tx.txHex);
      delete refusals[tx.txid];
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to broadcast recovery transaction ${tx.txid}: ${reason}`);
      refusals[tx.txid] = reason;
    }
  }
  return { ...plan, refusals };
}
