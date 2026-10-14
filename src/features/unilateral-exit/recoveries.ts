import type { CooperativeRecoveryFailure, PrepareRecoverFundsResponse, RecoveryTransaction } from '@breeztech/breez-sdk-spark';
import { buildFromQuote, EmptyRecoveryError, planFromBuild } from './building';
import { FEE_RETRY } from './exitFee';
import type { UnilateralExitPlan } from './model/plan';
import { isCooperative, isCooperativeLeaf, needsFunding } from './quote';
import { coversLeaves, emptyQuote, quoteLeaves, type ExitSdk } from './quoting';

/**
 * Quotes a kept co-signed recovery's leaves again at `feeRateSatPerVbyte`, to
 * its own address. A partial replacement beside the original would list the
 * same leaves twice, so a quote that cannot co-sign every leaf comes back empty.
 */
export async function quoteRecoveryBump(
  sdk: Pick<ExitSdk, 'prepareRecoverFunds'>,
  recovery: UnilateralExitPlan,
  feeRateSatPerVbyte: number,
): Promise<PrepareRecoverFundsResponse> {
  const ids = recovery.exit.leaves.map(leaf => leaf.leafId);
  const quote = await quoteLeaves(sdk, ids, { feeRateSatPerVbyte, destination: recovery.destination });
  const whole = !needsFunding(quote) && quote.leaves.every(isCooperativeLeaf) && coversLeaves(quote.leaves, ids);
  return whole ? quote : emptyQuote(quote);
}

/** A bump's retry. A replacement fee too low needs a higher one, which Back reopens the fee picker for. */
const bumpRetry = (failed: CooperativeRecoveryFailure[]): string =>
  failed.some(({ error }) => error.type === 'replacementFeeTooLow') ? FEE_RETRY : 'Please try again.';

/**
 * Builds the bump, which replaces `recovery` once kept. Nothing is broadcast
 * yet, so a build that left out a leaf (a replacement fee too low, operators
 * unavailable, or a leaf that landed meanwhile) is dropped rather than kept.
 * What the recovery dropped and what landed elsewhere carry over.
 */
export async function buildRecoveryBump(
  sdk: Pick<ExitSdk, 'recoverFunds'>,
  recovery: UnilateralExitPlan,
  quote: PrepareRecoverFundsResponse,
): Promise<UnilateralExitPlan> {
  const built = await buildFromQuote(sdk, quote, null).catch((e: unknown) => {
    throw e instanceof EmptyRecoveryError ? new EmptyRecoveryError(e.failed, bumpRetry(e.failed)) : e;
  });
  if (!coversLeaves(built.leaves, recovery.exit.leaves.map(leaf => leaf.leafId))) {
    throw new EmptyRecoveryError(built.failed, bumpRetry(built.failed));
  }
  const { network, fundingAddressIndex, mode, landed, droppedLeaves } = recovery;
  return { ...planFromBuild(quote, built, null, { network, fundingAddressIndex, mode }), landed, droppedLeaves };
}

/** A co-signed recovery whose input is not in a block. It may never be, so Glow prepares it again. */
export const isUnverifiedCosigned = (tx: RecoveryTransaction): boolean => isCooperative(tx) && tx.status.type === 'unverified';

/** Leaves whose co-signed recovery has not confirmed. */
export const cosignedInFlight = (plan: UnilateralExitPlan): string[] =>
  plan.exit.transactions.flatMap(tx => (isCooperative(tx) && tx.status.type !== 'confirmed' && tx.nodeId ? [tx.nodeId] : []));
