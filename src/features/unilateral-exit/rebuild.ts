import type { PrepareRecoverFundsResponse, RecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';
import { isSendable } from './broadcast';
import { buildFromQuote, EmptyRecoveryError, planFromBuild, readFundingKey, RebuildLaterError } from './building';
import { loadExitState, restoreExitState } from './exitState';
import { MnemonicNeedsPasskeyError, type FundingKey } from './funding';
import { withLanded } from './ledger';
import { hasUnverifiedStep, namedLeavesOf, type UnilateralExitPlan } from './model/plan';
import { exitFeeRecordOf, isCooperative, isCooperativeLeaf, isProvisionalSkip, needsFunding } from './quote';
import { leavingSkips, quoteNamed, withDropped, type ExitSdk } from './quoting';

/** A leaf the exit built to go out unilaterally that `quote` co-signs: the operators' watchtower moved it. */
const watchtowerMoved = (plan: UnilateralExitPlan, quote: PrepareRecoverFundsResponse): boolean => {
  const unilateral = new Set(plan.exit.leaves.filter(leaf => leaf.method === 'unilateral').map(leaf => leaf.leafId));
  return quote.leaves.some(leaf => isCooperativeLeaf(leaf) && unilateral.has(leaf.leafId));
};

function finishedPlan(plan: UnilateralExitPlan, quote: PrepareRecoverFundsResponse | null): UnilateralExitPlan {
  const { leaving, dropped } = quote ? leavingSkips(quote) : { leaving: new Set<string>(), dropped: [] };
  return {
    ...plan,
    landed: withLanded(plan, quote),
    namedLeaves: leaving.size > 0 ? namedLeavesOf(plan).filter(leaf => !leaving.has(leaf.leafId)) : plan.namedLeaves,
    droppedLeaves: withDropped(plan.droppedLeaves, dropped),
    phase: 'complete',
    needsRebuild: undefined,
  };
}

async function rebuildFrom(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  prepared: PrepareRecoverFundsResponse,
  key: FundingKey | null,
): Promise<UnilateralExitPlan> {
  let rebuilt: RecoverFundsResponse;
  try {
    rebuilt = await buildFromQuote(sdk, prepared, key && { inputs: plan.exit.fundingInputs, secretKey: key.secretKey });
  } catch (e) {
    // Everything it named landed between the quote and the build. What the
    // quote skipped did not.
    if (e instanceof EmptyRecoveryError && e.failed.length === 0) return finishedPlan(plan, { ...prepared, leaves: [] });
    throw e;
  }

  // A leaf the watchtower moved comes back co-signed, and that fee comes off
  // what arrives too. The fee record carries over: at the same rate and with
  // the same funding, the user paid the fee address what they paid before.
  const { network, fundingAddressIndex, mode } = plan;
  const next = planFromBuild(prepared, rebuilt, plan, { network, fundingAddressIndex, mode, ...exitFeeRecordOf(plan) });
  return { ...next, exitStateSnapshot: plan.exitStateSnapshot };
}

/**
 * Builds the exit again over whatever the chain now holds, naming its leaves
 * and keeping its destination, fee rate and funding. When the quote has no
 * leaves left, the plan comes back `complete`, its ledger naming what landed
 * since the build; a leaf that may yet move (`isProvisionalSkip`) throws
 * `RebuildLaterError` instead.
 *
 * Glow reads the recovery phrase only when the rebuild has funding to sign
 * for, and quotes first to find out. From the tracker's button (`interactive`)
 * Glow reads it first instead, while the tap is fresh enough for a passkey
 * prompt. In the background Glow cannot prompt, so on a passkey wallet the
 * read fails and the tracker offers the rebuild as that button. `onCause`
 * hears why the exit diverged, as far as the quote shows, before the key read
 * or the build can fail.
 */
export async function rebuildExit(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  { interactive = false, onCause }: { interactive?: boolean; onCause?: (cause: UnilateralExitPlan['redoCause']) => void } = {},
): Promise<UnilateralExitPlan> {
  const named = new Set(namedLeavesOf(plan).map(leaf => leaf.leafId));
  if (named.size === 0) return finishedPlan(plan, null);

  const tapKey = interactive ? await readFundingKey(plan, interactive) : null;
  await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));

  const prepared = await quoteNamed(sdk, plan);
  onCause?.(watchtowerMoved(plan, prepared) ? 'watchtower' : undefined);
  if (prepared.leaves.length === 0) {
    // A leaf left out as too dear or unrecoverable leaves the exit, so it
    // finishes. Only an unrecoverable one stays hidden; Recover Funds offers a
    // dear one once this exit is done.
    const waiting = prepared.skipped.some(leaf => named.has(leaf.leafId) && isProvisionalSkip(leaf, prepared));
    if (waiting) throw new RebuildLaterError();
    return finishedPlan(plan, prepared);
  }

  const key = needsFunding(prepared) ? (tapKey ?? (await readFundingKey(plan, interactive))) : null;
  return rebuildFrom(plan, sdk, prepared, key);
}

/**
 * The chain diverging is routine: the operators' watchtower publishes its
 * own copy of a refund. The exit is rebuilt over what is now on-chain.
 */
async function rebuildDiverged(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  tipHeight: number,
): Promise<UnilateralExitPlan> {
  let cause: UnilateralExitPlan['redoCause'];
  try {
    return await rebuildExit(plan, sdk, identityPubkey, {
      onCause: found => {
        cause = found;
      },
    });
  } catch (e) {
    if (e instanceof MnemonicNeedsPasskeyError) {
      // Waiting on the user to sign in is the designed path, not a fault: the
      // exit stays in `redo` and the tracker offers the rebuild as a button.
      return { ...plan, needsSignIn: true, redoCause: cause };
    }
    // Waiting on the chain is not a failure: the next pass tries again, so
    // only another error asks for the tap, and only once failures span a
    // block, since a rate limit or a brief outage passes within one.
    const failed = !(e instanceof RebuildLaterError);
    if (failed) {
      const error = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.SDK, `Failed to rebuild the exit: ${error}`);
    }
    const since = failed ? (plan.rebuildFailingSince ?? tipHeight) : undefined;
    const rebuildFailed = since !== undefined && tipHeight > since ? true : undefined;
    return { ...plan, rebuildFailingSince: since, rebuildFailed, redoCause: rebuildFailed ? cause : undefined };
  }
}

/**
 * Builds an exit again over a step the SDK could not read, which is how the
 * guide settles one: a fresh build reads the chain again. Same rate and
 * funding as a Redo rebuild.
 */
async function rebuildUnverified(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  tipHeight: number,
): Promise<UnilateralExitPlan> {
  try {
    return { ...(await rebuildExit(plan, sdk, identityPubkey)), unverifiedRebuiltAt: tipHeight };
  } catch (e) {
    // Only the tap settles the step, but the exit stays active: pausing it
    // would leave the other leaves' steps unsent until the operators' copy
    // takes its fee from the funds.
    if (e instanceof MnemonicNeedsPasskeyError) {
      return { ...plan, needsSignIn: true, redoCause: 'unverified', unverifiedRebuiltAt: tipHeight };
    }
    if (!(e instanceof RebuildLaterError)) {
      logger.warn(LogCategory.SDK, `Failed to rebuild over an unverified step: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { ...plan, unverifiedRebuiltAt: tipHeight };
  }
}

/**
 * Builds a converted 0.26 exit again with this SDK. Best effort: until it
 * works, the converted set keeps running as it is, and one with nothing left
 * to build simply finishes that way.
 */
async function rebuildConverted(plan: UnilateralExitPlan, sdk: ExitSdk, identityPubkey: string): Promise<UnilateralExitPlan> {
  try {
    const rebuilt = await rebuildExit(plan, sdk, identityPubkey);
    return rebuilt.phase === 'complete' ? { ...plan, needsRebuild: undefined, landed: rebuilt.landed } : rebuilt;
  } catch (e) {
    // The set runs as it is, except a step it could not read, which only the
    // tap's rebuild settles.
    if (e instanceof MnemonicNeedsPasskeyError) {
      return { ...plan, needsSignIn: true, redoCause: hasUnverifiedStep(plan) ? 'unverified' : undefined };
    }
    if (!(e instanceof RebuildLaterError)) {
      logger.warn(LogCategory.SDK, `Failed to rebuild the converted exit: ${e instanceof Error ? e.message : String(e)}`);
    }
    return plan;
  }
}

export async function rebuildIfNeeded(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  tipHeight: number,
  checked: boolean,
): Promise<UnilateralExitPlan> {
  if (plan.phase === 'redo') return rebuildDiverged(plan, sdk, identityPubkey, tipHeight);
  const canRebuild =
    checked &&
    !plan.needsSignIn &&
    plan.phase === 'active' &&
    // A rebuild now would conflict with what is in the mempool at the same fee.
    // A co-signed recovery does not: at that rate the SDK hands back the one it
    // kept.
    !plan.exit.transactions.some(tx => isSendable(tx) && !isCooperative(tx));
  if (!canRebuild) return plan;
  if (plan.needsRebuild) return rebuildConverted(plan, sdk, identityPubkey);
  if (hasUnverifiedStep(plan) && plan.unverifiedRebuiltAt !== tipHeight) return rebuildUnverified(plan, sdk, identityPubkey, tipHeight);
  return plan;
}
