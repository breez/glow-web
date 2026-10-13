import { singleKeyCpfpSigner } from '@breeztech/breez-sdk-spark';
import type {
  CooperativeRecoveryFailure,
  CpfpInput,
  PrepareRecoverFundsResponse,
  RecoverFundsResponse,
} from '@breeztech/breez-sdk-spark';
import type { ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { requiredFundingOf } from './exitFee';
import { loadExitState, restoreExitState } from './exitState';
import { deriveFundingKey, readWalletMnemonic, type FundingKey } from './funding';
import { withLanded } from './ledger';
import {
  namedLeavesOf,
  planFromExitResponse,
  type Funding,
  type NamedLeaf,
  type PendingExit,
  type PlanMeta,
  type UnilateralExitPlan,
} from './model/plan';
import {
  builtExitFeeRecord,
  builtSweepFeeSat,
  isCooperativeLeaf,
  isWorthExiting,
  leafFeesSat,
  needsFunding,
  type ExitFeeRecord,
} from './quote';
import { leavingSkips, quoteFresh, stillNamed, withDropped, type ExitSdk } from './quoting';

/**
 * A build that came back with no transactions: every co-signed leaf failed, or
 * landed meanwhile. Or a fee bump that left out a leaf it had to replace.
 * Shown as a retry; the failures go to the log.
 */
export class EmptyRecoveryError extends Error {
  readonly failed: CooperativeRecoveryFailure[];

  constructor(failed: CooperativeRecoveryFailure[], message = 'Please try again.') {
    super(message);
    this.name = 'EmptyRecoveryError';
    this.failed = failed;
  }
}

/** A rebuild found nothing to build yet: the chain has not shown where a leaf's funds went. */
export class RebuildLaterError extends Error {
  constructor() {
    super('Nothing is left to rebuild. The exit updates on its next check.');
    this.name = 'RebuildLaterError';
  }
}

const describeFailure = ({ error }: CooperativeRecoveryFailure): string =>
  error.type === 'replacementFeeTooLow'
    ? `replacementFeeTooLow (needs ${error.requiredFeeRateSatPerVbyte} sat/vB)`
    : `${error.type}: ${error.message}`;

/** Coins at the exit fee address and the key that signs for them. */
export interface BuildFunding {
  inputs: CpfpInput[];
  secretKey: Uint8Array;
}

/**
 * The one build call, for every start and rebuild. A quote that needs funding
 * spends `funding` and signs for it; one that needs none takes no inputs and
 * no signer, whatever it is handed.
 */
export async function buildFromQuote(
  sdk: Pick<ExitSdk, 'recoverFunds'>,
  prepared: PrepareRecoverFundsResponse,
  funding: BuildFunding | null,
): Promise<RecoverFundsResponse> {
  let built: RecoverFundsResponse;
  if (!needsFunding(prepared) || !funding) {
    built = await sdk.recoverFunds({ prepared });
  } else {
    // Holds the key in wasm memory until freed.
    const signer = singleKeyCpfpSigner(funding.secretKey);
    try {
      built = await sdk.recoverFunds({ prepared, fundingInputs: funding.inputs }, signer);
    } finally {
      signer.free();
    }
  }
  if (built.failed.length > 0) {
    logger.warn(LogCategory.SDK, 'The operators did not co-sign every recovery', {
      failures: built.failed.map(describeFailure).join('; '),
    });
  }
  if (built.transactions.length === 0) throw new EmptyRecoveryError(built.failed);
  return built;
}

/** Coins at the exit fee address, as a build spends them. */
export const fundingInputsOf = (coins: { txid: string; vout: number; value: number }[], pubkey: string): CpfpInput[] =>
  coins.map(({ txid, vout, value }) => ({ type: 'p2wpkh', txid, vout, valueSats: value, pubkey }));

const outpointOf = (input: CpfpInput): string => `${input.txid}:${input.vout}`;

/** The funding an earlier build spent, with fresh coins beside it: the sdk follows a spent outpoint to what it became. */
export const mergeFunding = (stored: CpfpInput[], fresh: CpfpInput[]): CpfpInput[] => {
  const seen = new Set(stored.map(outpointOf));
  return [...stored, ...fresh.filter(input => !seen.has(outpointOf(input)))];
};

export const readFundingKey = async (
  { network, fundingAddressIndex }: Pick<PendingExit, 'network' | 'fundingAddressIndex'>,
  interactive: boolean,
): Promise<FundingKey> => deriveFundingKey(await readWalletMnemonic({ interactive }), network, fundingAddressIndex);

/** What a plan keeps besides the build: where the money goes, how it was funded, and what kind of record it is. */
export type BuildMeta = Pick<PlanMeta, 'network' | 'fundingAddressIndex' | 'mode'> & ExitFeeRecord;

/**
 * The fee floor a rebuild of `resuming` carries, less the share of each leaf
 * it built that `built` leaves unbuilt and `named` still holds: that leaf's
 * own fee counts its share from here, so the floor must not count it again.
 */
function carriedFloorSat(resuming: UnilateralExitPlan, built: RecoverFundsResponse, named: NamedLeaf[]): number {
  const wasBuilt = new Set(resuming.exit.leaves.map(leaf => leaf.leafId));
  const isBuilt = new Set(built.leaves.map(leaf => leaf.leafId));
  const unbuilt = new Set(named.map(leaf => leaf.leafId).filter(id => wasBuilt.has(id) && !isBuilt.has(id)));
  const shareSat = namedLeavesOf(resuming)
    .filter(leaf => unbuilt.has(leaf.leafId))
    .reduce((sum, leaf) => sum + (leaf.feeSat ?? 0), 0);
  return Math.max(0, resuming.quotedSweepFeeSat - shareSat);
}

/**
 * The plan a build of `quote` makes. A rebuild of `resuming` carries over the
 * leaves it names, its ledger, the leaves it dropped, adding those the quote
 * found unrecoverable, and its fee floor; a first build records which part of
 * it was already outside the balance. The retry clock carries too: a rebuild
 * hands back the same stuck recovery.
 */
export function planFromBuild(
  quote: PrepareRecoverFundsResponse,
  built: RecoverFundsResponse,
  resuming: UnilateralExitPlan | null,
  meta: BuildMeta,
): UnilateralExitPlan {
  const named = resuming ? namedLeavesOf(resuming).map(leaf => leaf.leafId) : [];
  // The SDK builds no recovery for a co-signed leaf whose recovery is already
  // in a block, so one the build neither holds nor failed has landed. Recorded
  // now, while the replaced build still says what its recovery spends.
  const held = new Set([...built.leaves, ...built.failed].map(leaf => leaf.leafId));
  const priced = { ...quote, leaves: quote.leaves.filter(leaf => held.has(leaf.leafId) || !isCooperativeLeaf(leaf)) };
  // Off the whole quote, landed leaves included, since its fees cover them too.
  const fees = leafFeesSat(quote);
  const namedLeaves = resuming
    ? stillNamed(resuming, priced, fees)
    : priced.leaves.map(({ leafId, valueSats }) => ({ leafId, valueSats, feeSat: fees.get(leafId) }));
  return planFromExitResponse(built, {
    ...meta,
    destination: quote.destination,
    feeRateSatPerVbyte: quote.feeRateSatPerVbyte,
    quotedSweepFeeSat: builtSweepFeeSat(quote, built, resuming ? carriedFloorSat(resuming, built, namedLeaves) : 0),
    namedLeaves,
    landed: resuming ? withLanded(resuming, priced) : undefined,
    droppedLeaves: resuming ? withDropped(resuming.droppedLeaves, leavingSkips(quote, named).dropped) : undefined,
    retrySince: resuming?.retrySince,
    retriedAt: resuming?.retriedAt,
    recoverableLeafIds: resuming ? resuming.recoverableLeafIds : priced.leaves.filter(isCooperativeLeaf).map(leaf => leaf.leafId),
    recoverableFundsSat: resuming?.recoverableFundsSat,
  });
}

export type StartOutcome =
  | { type: 'started'; plan: UnilateralExitPlan }
  | { type: 'short'; required: Funding }
  | { type: 'nothingToExit' };

/**
 * Builds a pending exit from its confirmed fee coins, on the user's tap. It
 * quotes again first, so it exits what the wallet holds now: a payment or a
 * leaf swap since the first quote would fail a build that names the leaves
 * that quote picked. Leaves a kept co-signed recovery holds (`kept`) are left
 * to it.
 *
 * The key is read before anything else, while the tap is fresh enough for a
 * passkey prompt. `key` is one the wizard already derived.
 */
export async function startExit(
  pending: PendingExit,
  coins: ChainUtxo[],
  sdk: ExitSdk,
  identityPubkey: string,
  key?: FundingKey,
  kept: Set<string> = new Set(),
): Promise<StartOutcome> {
  const { network, destination, feeRateSatPerVbyte, fundingAddressIndex, mode } = pending;
  const { publicKeyHex, secretKey } = key ?? (await readFundingKey(pending, true));
  await restoreExitState(sdk, null, await loadExitState(identityPubkey).catch(() => null));

  const quote = await quoteFresh(sdk, { feeRateSatPerVbyte, destination }, mode, kept);
  if (!isWorthExiting(quote)) return { type: 'nothingToExit' };

  let exit: RecoverFundsResponse;
  try {
    exit = await buildFromQuote(sdk, quote, { inputs: fundingInputsOf(coins, publicKeyHex), secretKey });
  } catch (e) {
    const required = requiredFundingOf(e instanceof Error ? e.message : String(e));
    if (required === null) throw e;
    return { type: 'short', required: { sat: required, inputs: coins.length } };
  }

  // Frozen now: from here the operators stop reporting the leaves this exit moves.
  const exitStateSnapshot = await sdk
    .exportUnilateralExitState()
    .then(r => r.exitState)
    .catch(() => undefined);
  // The user paid the fee even if this quote no longer needs it. Glow then
  // builds without it and keeps the pending exit's record of where it went.
  const fee = builtExitFeeRecord(quote, { quotedExitFeeSat: pending.required.sat, exitFeeAddress: pending.fundingAddress });
  const plan = planFromBuild(quote, exit, null, { network, fundingAddressIndex, mode, ...fee });
  return { type: 'started', plan: { ...plan, exitStateSnapshot } };
}
