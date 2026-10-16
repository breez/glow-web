import type { PrepareRecoverFundsResponse, RecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';
import { isSendable } from './broadcast';
import { buildFromQuote, EmptyRecoveryError, planFromBuild, readFundingKey, RebuildLaterError } from './building';
import { loadExitState, restoreExitState } from './exitState';
import { MnemonicNeedsPasskeyError, type FundingKey } from './funding';
import { withLanded } from './ledger';
import {
  awaitsUpdate,
  hasUnverifiedStep,
  isActive,
  isDiverged,
  namedLeavesOf,
  type ExitStatus,
  type UnilateralExitPlan,
} from './model/plan';
import { exitFeeRecordOf, isCooperative, isProvisionalSkip, needsFunding, stopClock, type StopClock } from './quote';
import { leavingSkips, quoteNamed, withDropped, type ExitSdk } from './quoting';

function finishedPlan(plan: UnilateralExitPlan, quote: PrepareRecoverFundsResponse | null, clock?: StopClock): UnilateralExitPlan {
  const { leaving, dropped } = quote ? leavingSkips(quote, undefined, clock) : { leaving: new Set<string>(), dropped: [] };
  return {
    ...plan,
    landed: withLanded(plan, quote),
    namedLeaves: leaving.size > 0 ? namedLeavesOf(plan).filter(leaf => !leaving.has(leaf.leafId)) : plan.namedLeaves,
    droppedLeaves: withDropped(plan.droppedLeaves, dropped),
    status: { type: 'done' },
  };
}

async function rebuildFrom(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  prepared: PrepareRecoverFundsResponse,
  key: FundingKey | null,
  clock?: StopClock,
): Promise<UnilateralExitPlan> {
  let rebuilt: RecoverFundsResponse;
  try {
    rebuilt = await buildFromQuote(sdk, prepared, key && { inputs: plan.exit.fundingInputs, secretKey: key.secretKey });
  } catch (e) {
    // Everything it named landed between the quote and the build. What the
    // quote skipped did not.
    if (e instanceof EmptyRecoveryError && e.failed.length === 0) return finishedPlan(plan, { ...prepared, leaves: [] }, clock);
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
 * Builds the exit again over what the chain holds now, keeping its leaves,
 * destination, rate and funding: `done` when nothing is left, or
 * `RebuildLaterError` while a leaf may yet move. Reads the phrase only to sign
 * funding, or first when `interactive`, since only a tap can prompt for a passkey.
 */
export async function rebuildExit(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  { interactive = false, tipHeight }: { interactive?: boolean; tipHeight?: number } = {},
): Promise<UnilateralExitPlan> {
  const named = new Set(namedLeavesOf(plan).map(leaf => leaf.leafId));
  if (named.size === 0) return finishedPlan(plan, null);

  const tapKey = interactive ? await readFundingKey(plan, interactive) : null;
  await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));

  const prepared = await quoteNamed(sdk, plan);
  const clock = tipHeight === undefined ? undefined : stopClock(plan.stoppedSince, prepared, tipHeight);
  const dated = clock?.since ? { ...plan, stoppedSince: clock.since } : plan;
  if (prepared.leaves.length === 0) {
    // A leaf left out as too dear or unrecoverable leaves the exit, so it
    // finishes. Only an unrecoverable one stays hidden; Recover Funds offers a
    // dear one once this exit is done.
    const waiting = prepared.skipped.some(leaf => named.has(leaf.leafId) && isProvisionalSkip(leaf, prepared, clock));
    if (waiting) throw new RebuildLaterError(dated.stoppedSince);
    return finishedPlan(dated, prepared, clock);
  }

  const key = needsFunding(prepared) ? (tapKey ?? (await readFundingKey(plan, interactive))) : null;
  return rebuildFrom(dated, sdk, prepared, key, clock);
}

/** `plan` keeping the dates a rebuild that found nothing to build gave the leaves its quote stopped. */
const withLaterDates = (plan: UnilateralExitPlan, e: unknown): UnilateralExitPlan =>
  e instanceof RebuildLaterError && e.stoppedSince ? { ...plan, stoppedSince: e.stoppedSince } : plan;

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
  try {
    return await rebuildExit(plan, sdk, identityPubkey, { tipHeight });
  } catch (e) {
    if (e instanceof MnemonicNeedsPasskeyError) {
      // Waiting on the user to sign in is the designed path, not a fault: the
      // tracker offers the rebuild as a button.
      return { ...plan, status: { type: 'needsUpdate', why: 'signIn' } };
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
    const status: ExitStatus =
      since !== undefined && tipHeight > since ? { type: 'needsUpdate', why: 'rebuildFailed' } : { type: 'rebuilding' };
    return { ...withLaterDates(plan, e), rebuildFailingSince: since, status };
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
    return { ...(await rebuildExit(plan, sdk, identityPubkey, { tipHeight })), unverifiedRebuiltAt: tipHeight };
  } catch (e) {
    // Only the tap settles the step, but the exit stays active: pausing it
    // would leave the other leaves' steps unsent until the operators' copy
    // takes its fee from the funds.
    if (e instanceof MnemonicNeedsPasskeyError) {
      return { ...plan, status: { type: 'needsUpdate', why: 'signIn', cause: 'unverified' }, unverifiedRebuiltAt: tipHeight };
    }
    if (!(e instanceof RebuildLaterError)) {
      logger.warn(LogCategory.SDK, `Failed to rebuild over an unverified step: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { ...withLaterDates(plan, e), unverifiedRebuiltAt: tipHeight };
  }
}

export async function rebuildIfNeeded(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  tipHeight: number,
  checked: boolean,
): Promise<UnilateralExitPlan> {
  if (isDiverged(plan)) return rebuildDiverged(plan, sdk, identityPubkey, tipHeight);
  const canRebuild =
    checked &&
    isActive(plan) &&
    // Once the passkey is asked for, only the tap rebuilds.
    !awaitsUpdate(plan) &&
    // A rebuild now would conflict with what is in the mempool at the same fee.
    // A co-signed recovery does not: at that rate the SDK hands back the one it
    // kept.
    !plan.exit.transactions.some(tx => isSendable(tx) && !isCooperative(tx));
  if (!canRebuild) return plan;
  if (hasUnverifiedStep(plan) && plan.unverifiedRebuiltAt !== tipHeight) return rebuildUnverified(plan, sdk, identityPubkey, tipHeight);
  return plan;
}
