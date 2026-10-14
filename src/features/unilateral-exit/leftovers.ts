import type {
  PrepareRecoverFundsResponse,
  RecoverFundsLeaf,
  RecoverFundsResponse,
  RecoveryTransaction,
} from '@breeztech/breez-sdk-spark';
import type { ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { outputTotalSat } from '@/utils/rawTx';
import {
  buildFromQuote,
  EmptyRecoveryError,
  fundingInputsOf,
  mergeFunding,
  planFromBuild,
  readFundingKey,
  RebuildLaterError,
  type BuildFunding,
} from './building';
import { leftoverTopUp, requiredFundingOf } from './exitFee';
import { loadExitState, restoreExitState } from './exitState';
import { MnemonicNeedsPasskeyError, type FundingKey } from './funding';
import { hasWaitingLanding, withLanded } from './ledger';
import {
  isUnilateralLanded,
  leftoverIdsOf,
  topUpOf,
  type ExitTopUp,
  type NamedLeaf,
  type UnilateralExitPlan,
} from './model/plan';
import {
  exitFeeRecordOf,
  exitFeeSat,
  isCooperative,
  isCooperativeLeaf,
  leafFeesSat,
  needsFunding,
  stopClock,
  type ExitFeeRecord,
  type StopClock,
} from './quote';
import { leavingSkips, quoteLeaves, withDropped, type ExitSdk } from './quoting';
import { cosignedInFlight, isUnverifiedCosigned } from './recoveries';

/** The leaves Glow prepares again by itself. In the plan slot, the leaves the exit left out as well. */
const retryTargetsOf = (plan: UnilateralExitPlan, withLeftovers = false): string[] => {
  const stuck = plan.exit.transactions.flatMap(tx => (isUnverifiedCosigned(tx) && tx.nodeId ? [tx.nodeId] : []));
  return withLeftovers ? [...stuck, ...leftoverIdsOf(plan).filter(id => !stuck.includes(id))] : stuck;
};

const RETRY_BLOCKS = 6;
const RETRY_MAX_BLOCKS = 144;
/** About a week. */
const RELEASE_BLOCKS = 1_008;

/**
 * Six blocks after the clock starts, then at doubling gaps up to a day, so a
 * recovery that never moves costs one prepare a day.
 */
export function retryDue(plan: UnilateralExitPlan, tipHeight: number): boolean {
  const since = plan.retrySince;
  if (since === undefined) return false;
  const last = Math.max(since, plan.retriedAt ?? since);
  const gap = Math.min(RETRY_MAX_BLOCKS, Math.max(RETRY_BLOCKS, last - since));
  return tipHeight - last >= gap;
}

/**
 * What is still stuck after about a week is let go, so the exit can finish and
 * the leaf shows as Recoverable Funds again. Not while a unilateral step is in
 * flight: a leftover waits for the rest to land, and its own build is not cut
 * short.
 */
export const releaseDue = (plan: UnilateralExitPlan, tipHeight: number): boolean =>
  plan.retrySince !== undefined && tipHeight - plan.retrySince >= RELEASE_BLOCKS && isUnilateralLanded(plan.exit);

/** Starts the clock on the first checked pass that finds a target, and stops it once none is left. */
export function paceRetry(plan: UnilateralExitPlan, tipHeight: number, withLeftovers: boolean): UnilateralExitPlan {
  if (retryTargetsOf(plan, withLeftovers).length > 0) {
    return plan.retrySince === undefined ? { ...plan, retrySince: tipHeight } : plan;
  }
  if (plan.retrySince === undefined && plan.retriedAt === undefined) return plan;
  return { ...plan, retrySince: undefined, retriedAt: undefined };
}

/**
 * Nothing can move but through a retry: every transaction confirmed except
 * co-signed recoveries stuck unverified, and nothing waits on a read or on the
 * exit fee. The engine polls less often then.
 */
export const isStalled = (plan: UnilateralExitPlan): boolean =>
  plan.status.type === 'running' &&
  !hasWaitingLanding(plan) &&
  plan.exit.transactions.every(tx => tx.status.type === 'confirmed' || isUnverifiedCosigned(tx)) &&
  (plan.exit.transactions.some(isUnverifiedCosigned) || leftoverIdsOf(plan).length > 0);

/** What a co-signed recovery takes off its leaf, read off what it pays. */
const cosignedCostSat = (valueSats: number, tx: RecoveryTransaction): number =>
  valueSats - (outputTotalSat(tx.txHex) ?? valueSats);

function mergeCosignedTransactions(
  exit: RecoverFundsResponse,
  built: RecoverFundsResponse | null,
  fresh: Map<string, RecoveryTransaction>,
  gone: Set<string>,
): { transactions: RecoveryTransaction[]; costSat: number } {
  const values = new Map([...exit.leaves, ...(built?.leaves ?? [])].map(leaf => [leaf.leafId, leaf.valueSats]));
  const costOf = (tx: RecoveryTransaction) => {
    const valueSats = tx.nodeId ? values.get(tx.nodeId) : undefined;
    return valueSats === undefined ? 0 : cosignedCostSat(valueSats, tx);
  };

  let costSat = 0;
  const swapped = new Set<string>();
  const transactions = exit.transactions.flatMap(tx => {
    if (!isCooperative(tx) || tx.status.type === 'confirmed' || !tx.nodeId) return [tx];
    if (gone.has(tx.nodeId)) {
      costSat -= costOf(tx);
      return [];
    }
    const next = fresh.get(tx.nodeId);
    if (!next) return [tx];
    swapped.add(tx.nodeId);
    if (next.txid === tx.txid) return [tx];
    costSat += costOf(next) - costOf(tx);
    return [next];
  });
  for (const [leafId, tx] of fresh) {
    if (swapped.has(leafId)) continue;
    costSat += costOf(tx);
    transactions.push(tx);
  }
  return { transactions, costSat };
}

function mergeCosignedLeaves(
  exit: RecoverFundsResponse,
  built: RecoverFundsResponse | null,
  fresh: Map<string, RecoveryTransaction>,
  gone: Set<string>,
): Pick<RecoverFundsResponse, 'leaves' | 'failed' | 'recoverableValueSats'> {
  const held = new Set(exit.leaves.map(leaf => leaf.leafId));
  const added = (built?.leaves ?? []).filter(leaf => fresh.has(leaf.leafId) && !held.has(leaf.leafId));
  const removed = exit.leaves.filter(leaf => gone.has(leaf.leafId));
  const sum = (leaves: RecoverFundsLeaf[]) => leaves.reduce((total, leaf) => total + leaf.valueSats, 0);
  return {
    leaves: [...exit.leaves.filter(leaf => !gone.has(leaf.leafId)), ...added],
    failed: exit.failed.filter(failure => !gone.has(failure.leafId) && !fresh.has(failure.leafId)),
    recoverableValueSats: exit.recoverableValueSats + sum(added) - sum(removed),
  };
}

/**
 * `plan` with each co-signed recovery of `built` in place of its leaf's
 * unconfirmed one, or added, and each leaf in `gone` taken out with its
 * unconfirmed recovery. `checkRecoverFunds` reads each co-signed recovery on
 * its own, so a plan holding two builds' recoveries checks as one.
 */
function withCosigned(
  plan: UnilateralExitPlan,
  built: RecoverFundsResponse | null,
  gone: Set<string>,
  dropped: NamedLeaf[],
): UnilateralExitPlan {
  const { exit } = plan;
  const fresh = new Map(
    (built?.transactions ?? []).flatMap(tx => (isCooperative(tx) && tx.nodeId && !gone.has(tx.nodeId) ? [[tx.nodeId, tx] as const] : [])),
  );
  const { transactions, costSat } = mergeCosignedTransactions(exit, built, fresh, gone);
  return {
    ...plan,
    quotedSweepFeeSat: Math.max(0, plan.quotedSweepFeeSat + costSat),
    namedLeaves: plan.namedLeaves?.filter(leaf => !gone.has(leaf.leafId)),
    droppedLeaves: withDropped(plan.droppedLeaves, dropped),
    exit: { ...exit, transactions, ...mergeCosignedLeaves(exit, built, fresh, gone) },
  };
}

/** Finished once nothing is built and nothing the exit named is still to come. */
const completeIfEmpty = (plan: UnilateralExitPlan): UnilateralExitPlan =>
  plan.exit.transactions.length > 0 || leftoverIdsOf(plan).length > 0 ? plan : { ...plan, status: { type: 'done' } };

const askingFee = (plan: UnilateralExitPlan, topUp: ExitTopUp): UnilateralExitPlan => ({
  ...plan,
  status: { type: 'needsExitFee', topUp },
});

/** Asks for no more exit fee: an exit that waited on it runs on. */
const withoutTopUp = (plan: UnilateralExitPlan): UnilateralExitPlan =>
  plan.status.type === 'needsExitFee' ? { ...plan, status: { type: 'running' } } : plan;

/** A co-signed build the operators refused entirely changes nothing: what was stuck stays. */
const buildCosigned = (sdk: ExitSdk, quote: PrepareRecoverFundsResponse): Promise<RecoverFundsResponse | null> =>
  buildFromQuote(sdk, quote, null).catch(e => {
    if (e instanceof EmptyRecoveryError) return null;
    throw e;
  });

/** `plan` with each named leaf `quote` prices carrying the fee that quote puts on it. */
const withQuotedFees = (plan: UnilateralExitPlan, quote: PrepareRecoverFundsResponse): UnilateralExitPlan => {
  const fees = leafFeesSat(quote);
  return { ...plan, namedLeaves: plan.namedLeaves?.map(leaf => (fees.has(leaf.leafId) ? { ...leaf, feeSat: fees.get(leaf.leafId) } : leaf)) };
};

const askTopUp = (plan: UnilateralExitPlan, quote: PrepareRecoverFundsResponse): ExitTopUp => ({
  required: { sat: exitFeeSat(quote), inputs: 1 },
  // With no fee address yet, only the key can say where to pay.
  needsSignIn: exitFeeRecordOf(plan).exitFeeAddress ? undefined : true,
});

/**
 * Builds `quote` as the next part of an exit that has landed, in place of the
 * build before it, whose ledger keeps what that one paid out. Its sweep fee is
 * no floor for this part's, which pays its own.
 */
async function buildNextPart(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  quote: PrepareRecoverFundsResponse,
  funding: BuildFunding | null,
  fee: ExitFeeRecord,
): Promise<UnilateralExitPlan> {
  const built = await buildFromQuote(sdk, quote, funding);
  const { network, fundingAddressIndex, mode } = plan;
  const next = planFromBuild(quote, built, { ...plan, quotedSweepFeeSat: 0 }, { network, fundingAddressIndex, mode, ...fee });
  return { ...next, exitStateSnapshot: plan.exitStateSnapshot };
}

/**
 * Applies a quote of the leaves Glow prepares again by itself. Co-signed ones
 * are built at once and merged into the plan. In the plan slot a unilateral
 * one waits for the exit's unilateral steps to land: it is then built as the
 * exit's next part when it needs no funding, and asks for more exit fee when
 * it does. A co-signed recovery still in flight holds neither back.
 */
async function applyRetryQuote(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  quote: PrepareRecoverFundsResponse,
  targets: string[],
  inSlot: boolean,
  clock?: StopClock,
): Promise<UnilateralExitPlan> {
  const listed = new Set([...quote.leaves, ...quote.skipped].map(leaf => leaf.leafId));
  const landedIds = targets.filter(id => !listed.has(id));
  const { leaving, dropped } = leavingSkips(quote, targets, clock);
  const gone = new Set([...landedIds, ...leaving]);
  const unilateral = quote.leaves.some(leaf => !isCooperativeLeaf(leaf));
  const landed = isUnilateralLanded(plan.exit);
  // The next part replaces the build, so it has to hand back every co-signed recovery still in flight.
  const carries = cosignedInFlight(plan).every(id => targets.includes(id));
  if (inSlot && unilateral && landed && carries && !needsFunding(quote)) {
    return buildNextPart(plan, sdk, quote, null, exitFeeRecordOf(plan));
  }

  // On their own, so none waits on a unilateral leaf's fee (guide: recovering without funding).
  const cosigned = quote.leaves.filter(isCooperativeLeaf).map(leaf => leaf.leafId);
  const cosignedQuote = cosigned.length === 0 ? null : unilateral ? await quoteLeaves(sdk, cosigned, plan) : quote;
  const built = cosignedQuote && cosignedQuote.leaves.length > 0 ? await buildCosigned(sdk, cosignedQuote) : null;
  const asked = topUpOf(plan);
  const asksFee = inSlot && unilateral && needsFunding(quote) && (landed || !!asked);
  const next = asksFee ? askingFee(plan, asked ?? askTopUp(plan, quote)) : withoutTopUp(plan);
  return completeIfEmpty(withCosigned({ ...withQuotedFees(next, quote), landed: withLanded(plan, quote, landedIds) }, built, gone, dropped));
}

/**
 * Prepares again by name, at the plan's own rate and destination, the
 * co-signed recoveries stuck unverified and, in the plan slot, the leaves the
 * exit left out. At that rate the SDK hands back a recovery it kept, so a new
 * one means the funds turned up in another output. Needs no key, so it runs in
 * the background on any wallet, kept recoveries included.
 */
async function retryCosigned(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  tipHeight: number,
  identityPubkey?: string,
): Promise<UnilateralExitPlan> {
  let paced: UnilateralExitPlan = { ...plan, retriedAt: tipHeight };
  const targets = retryTargetsOf(plan, !!identityPubkey);
  try {
    // A leftover can be unilateral, which is quoted from the frozen leaf data.
    if (identityPubkey) await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));
    const quote = await quoteLeaves(sdk, targets, plan);
    const clock = stopClock(plan.stoppedSince, quote, tipHeight);
    if (clock.since) paced = { ...paced, stoppedSince: clock.since };
    return await applyRetryQuote(paced, sdk, quote, targets, !!identityPubkey, clock);
  } catch (e) {
    // An empty build means the operators did not co-sign: what was stuck stays.
    if (!(e instanceof EmptyRecoveryError)) {
      logger.warn(LogCategory.SDK, `Failed to build a stuck co-signed recovery again: ${e instanceof Error ? e.message : String(e)}`);
    }
    return paced;
  }
}

async function buildFromFeeCoins(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  quote: PrepareRecoverFundsResponse,
  coins: ChainUtxo[],
  key: FundingKey,
): Promise<UnilateralExitPlan> {
  const { quotedExitFeeSat, exitFeeAddress } = exitFeeRecordOf(plan);
  const address = exitFeeAddress ?? key.address;
  const asked = topUpOf(plan);
  const funding = {
    inputs: mergeFunding(plan.exit.fundingInputs, fundingInputsOf(coins, key.publicKeyHex)),
    secretKey: key.secretKey,
  };
  // The fee paid grows by what was sent for this part, which can be more than
  // asked, not by what the address already held.
  const sentSat = coins.reduce((sum, coin) => sum + coin.value, 0) - (asked?.heldSat ?? 0);
  try {
    return await buildNextPart(plan, sdk, quote, funding, {
      quotedExitFeeSat: (quotedExitFeeSat ?? 0) + Math.max(0, sentSat),
      exitFeeAddress: address,
    });
  } catch (e) {
    const sat = requiredFundingOf(e instanceof Error ? e.message : String(e));
    if (sat === null) throw e;
    const short = askingFee(withQuotedFees(plan, quote), { required: { sat, inputs: coins.length }, heldSat: asked?.heldSat });
    return { ...short, exitFeeAddress: address };
  }
}

/**
 * Builds the leaves a landed exit left out, from the confirmed `coins` at its
 * fee address, as the exit's next part. From the fee screen's button
 * (`interactive`) the key is read first, while the tap is fresh enough for a
 * passkey prompt. In the background a passkey wallet waits for that tap.
 */
export async function buildLeftover(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  coins: ChainUtxo[],
  { interactive = false }: { interactive?: boolean } = {},
): Promise<UnilateralExitPlan> {
  // Built over a unilateral step in flight, it would replace a transaction Glow follows.
  if (!isUnilateralLanded(plan.exit)) throw new RebuildLaterError();
  const tapKey = interactive ? await readFundingKey(plan, interactive) : null;
  await restoreExitState(sdk, plan, await loadExitState(identityPubkey).catch(() => null));

  // A co-signed recovery still in flight is named too: at the plan's rate the
  // SDK hands back the one it kept, so the next part carries it.
  const targets = [...cosignedInFlight(plan), ...leftoverIdsOf(plan)];
  const quote = await quoteLeaves(sdk, targets, plan);
  if (!needsFunding(quote)) return applyRetryQuote(withoutTopUp(plan), sdk, quote, targets, true);

  let key: FundingKey;
  try {
    key = tapKey ?? (await readFundingKey(plan, interactive));
  } catch (e) {
    if (interactive || !(e instanceof MnemonicNeedsPasskeyError)) throw e;
    return askingFee(withQuotedFees(plan, quote), { ...(topUpOf(plan) ?? askTopUp(plan, quote)), needsSignIn: true });
  }
  return buildFromFeeCoins(plan, sdk, quote, coins, key);
}

/** Whether a leftover's fee has confirmed, so its build can go ahead. Once a block: a confirmation comes with one. */
function leftoverFunded(plan: UnilateralExitPlan, confirmed: ChainUtxo[], tipHeight: number): boolean {
  const asked = topUpOf(plan);
  return (
    !!asked &&
    !asked.needsSignIn &&
    plan.retriedAt !== tipHeight &&
    isUnilateralLanded(plan.exit) &&
    leftoverTopUp(plan, confirmed).stillToSendSat === 0
  );
}

async function buildFundedLeftover(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  identityPubkey: string,
  confirmed: ChainUtxo[],
  tipHeight: number,
): Promise<UnilateralExitPlan> {
  const paced = { ...plan, retriedAt: tipHeight };
  try {
    return await buildLeftover(paced, sdk, identityPubkey, confirmed);
  } catch (e) {
    // An empty build too: this runs every block, so a silent loop would hide.
    const reason = e instanceof EmptyRecoveryError ? 'the build came back empty' : e instanceof Error ? e.message : String(e);
    logger.warn(LogCategory.SDK, `Failed to build what the exit left out: ${reason}`);
    return paced;
  }
}

/** Lets go of what is still stuck at the deadline, leftovers included. Not dropped, so it shows as Recoverable Funds again. */
const releaseStuck = (plan: UnilateralExitPlan, withLeftovers: boolean): UnilateralExitPlan =>
  completeIfEmpty({
    ...withCosigned(withoutTopUp(plan), null, new Set(retryTargetsOf(plan, withLeftovers)), []),
    retrySince: undefined,
    retriedAt: undefined,
  });

export async function retryLeftovers(
  plan: UnilateralExitPlan,
  sdk: ExitSdk,
  tipHeight: number,
  retryNow: boolean,
  identityPubkey?: string,
  feeCoins?: ChainUtxo[],
): Promise<UnilateralExitPlan> {
  const inSlot = !!identityPubkey;
  const confirmedFee = (feeCoins ?? []).filter(coin => coin.confirmed);
  if (identityPubkey && feeCoins && leftoverFunded(plan, confirmedFee, tipHeight)) {
    const next = await buildFundedLeftover(plan, sdk, identityPubkey, confirmedFee, tipHeight);
    // A build that keeps failing holds the leftover no longer than the week.
    return next.status.type === 'needsExitFee' && releaseDue(next, tipHeight) ? releaseStuck(next, inSlot) : next;
  }
  if (releaseDue(plan, tipHeight)) return releaseStuck(plan, inSlot);
  if (retryNow || retryDue(plan, tipHeight)) return retryCosigned(plan, sdk, tipHeight, identityPubkey);
  return plan;
}
