import type {
  BreezSdk,
  CpfpFundingKind,
  PrepareRecoverFundsResponse,
  RecoverFundsLeaf,
} from '@breeztech/breez-sdk-spark';
import { namedLeavesOf, type ExitMode, type NamedLeaf, type UnilateralExitPlan } from './model/plan';
import { isProvisionalSkip } from './quote';

/** The slice of the sdk a pass drives. */
export type ExitSdk = Pick<
  BreezSdk,
  | 'checkRecoverFunds'
  | 'prepareRecoverFunds'
  | 'recoverFunds'
  | 'importUnilateralExitState'
  | 'exportUnilateralExitState'
  | 'syncWallet'
>;

/** Passed on every quote: the sdk needs it only while unilateral steps are left, and ignores it otherwise. */
const P2WPKH: CpfpFundingKind = { type: 'p2wpkh' };

/** Quotes exactly `leafIds`, whatever each costs to move. */
export function quoteLeaves(
  sdk: Pick<ExitSdk, 'prepareRecoverFunds'>,
  leafIds: string[],
  { feeRateSatPerVbyte, destination }: { feeRateSatPerVbyte: number; destination: string },
): Promise<PrepareRecoverFundsResponse> {
  // The sdk refuses a selection that names nothing.
  if (leafIds.length === 0) return Promise.reject(new Error('No leaves to recover'));
  return sdk.prepareRecoverFunds({
    feeRateSatPerVbyte,
    fundingKind: P2WPKH,
    destination,
    selection: { type: 'specific', leafIds },
  });
}

/**
 * Quotes the plan's own leaves again, by name: the dependable way to pick an
 * exit back up, a leaf waiting out its refund timelock included.
 */
export const quoteNamed = (
  sdk: Pick<ExitSdk, 'prepareRecoverFunds'>,
  plan: UnilateralExitPlan,
  { feeRateSatPerVbyte = plan.feeRateSatPerVbyte, destination = plan.destination } = {},
): Promise<PrepareRecoverFundsResponse> =>
  quoteLeaves(
    sdk,
    namedLeavesOf(plan).map(leaf => leaf.leafId),
    { feeRateSatPerVbyte, destination },
  );

/** `quote` with nothing left in it to build. */
export const emptyQuote = (quote: PrepareRecoverFundsResponse): PrepareRecoverFundsResponse => ({
  ...quote,
  funding: undefined,
  leaves: [],
  recoverableValueSats: 0,
  totalFeeSats: 0,
  cooperativeFeeSats: 0,
  cpfpFeeSats: 0,
  fanoutFeeSats: 0,
  sweepFeeSats: 0,
});

export const coversLeaves = (leaves: RecoverFundsLeaf[], ids: string[]): boolean => {
  const got = new Set(leaves.map(leaf => leaf.leafId));
  return ids.every(id => got.has(id));
};

/**
 * A quote of what the wallet holds now: everything for an exit, only what left
 * the balance for a recovery. Either selection also takes leaves a kept
 * recovery is already moving, and building those would compete with it, so
 * the rest is quoted again by name. Nothing left gives an empty quote.
 */
export async function quoteFresh(
  sdk: Pick<ExitSdk, 'prepareRecoverFunds'>,
  { feeRateSatPerVbyte, destination }: { feeRateSatPerVbyte: number; destination: string },
  mode: ExitMode | undefined,
  kept: Set<string>,
): Promise<PrepareRecoverFundsResponse> {
  const first = await sdk.prepareRecoverFunds({
    feeRateSatPerVbyte,
    fundingKind: P2WPKH,
    destination,
    selection: mode === 'recover' ? { type: 'recoverableOnly' } : { type: 'all' },
  });
  const skipped = first.skipped.filter(leaf => !kept.has(leaf.leafId));
  if (!first.leaves.some(leaf => kept.has(leaf.leafId))) return { ...first, skipped };

  // Only leaves the first quote kept: a named leaf is taken whatever it costs.
  const rest = first.leaves.filter(leaf => !kept.has(leaf.leafId)).map(leaf => leaf.leafId);
  if (rest.length === 0) return { ...emptyQuote(first), skipped };
  const second = await quoteLeaves(sdk, rest, { feeRateSatPerVbyte, destination });
  const own = new Set(second.skipped.map(leaf => leaf.leafId));
  return { ...second, skipped: [...second.skipped, ...skipped.filter(leaf => !own.has(leaf.leafId))] };
}

/** Skips that take a leaf out of the exit. Only an unrecoverable one is hidden as well. */
const LEAVES_EXIT_SKIPS = new Set(['notRecoverable', 'feeExceedsValue']);

/**
 * The leaves among `ids` that `quote` takes out of the exit, and the ones of
 * them to hide. A leaf too dear at the exit's rate stays on offer, for a
 * recovery at a lower one.
 */
export function leavingSkips(quote: PrepareRecoverFundsResponse, ids?: string[]): { leaving: Set<string>; dropped: NamedLeaf[] } {
  const skips = quote.skipped.filter(
    leaf => LEAVES_EXIT_SKIPS.has(leaf.reason.type) && !isProvisionalSkip(leaf, quote) && (!ids || ids.includes(leaf.leafId)),
  );
  return {
    leaving: new Set(skips.map(leaf => leaf.leafId)),
    dropped: skips.flatMap(({ leafId, valueSats, reason }) => (reason.type === 'notRecoverable' ? [{ leafId, valueSats }] : [])),
  };
}

export const withDropped = (dropped: NamedLeaf[] | undefined, added: NamedLeaf[]): NamedLeaf[] | undefined => {
  if (added.length === 0) return dropped;
  const ids = new Set(added.map(leaf => leaf.leafId));
  return [...(dropped ?? []).filter(leaf => !ids.has(leaf.leafId)), ...added];
};

/**
 * What `resuming` still names once `quote` has priced its leaves: a leaf it
 * lists nowhere has landed, and one it skips as unrecoverable or too dear has
 * left the exit. A leaf skipped for now keeps the fee its last quote put on it.
 */
export function stillNamed(resuming: UnilateralExitPlan, quote: PrepareRecoverFundsResponse, fees: Map<string, number>): NamedLeaf[] {
  const { leaving } = leavingSkips(quote);
  const kept = quote.skipped.filter(leaf => !leaving.has(leaf.leafId));
  const priced = new Map([...kept, ...quote.leaves].map(leaf => [leaf.leafId, leaf.valueSats]));
  const named = namedLeavesOf(resuming).flatMap(({ leafId, feeSat }) => {
    const valueSats = priced.get(leafId);
    return valueSats === undefined ? [] : [{ leafId, valueSats, feeSat: fees.get(leafId) ?? feeSat }];
  });
  const seen = new Set(named.map(leaf => leaf.leafId));
  const added = quote.leaves.filter(leaf => !seen.has(leaf.leafId));
  return [...named, ...added.map(({ leafId, valueSats }) => ({ leafId, valueSats, feeSat: fees.get(leafId) }))];
}
