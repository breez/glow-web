import type { ChainClient, ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { lastReadCoins, readFeeAddress, readFeeCoins, withFeeCoins } from '../exitFee';
import { sweepLeftoverFee } from '../feeSweep';
import { hasWaitingLanding } from '../ledger';
import { releasesLeaves } from '../listEntries';
import { topUpOf, type UnilateralExitPlan, type WalletKey } from '../model/plan';
import { advanceUnilateralExit } from '../pass';
import { exitFeeRecordOf } from '../quote';
import { retireRecord } from '../storage/accounting';
import { archiveExit, recoveryTxid } from '../storage/archive';
import { savePendingExit } from '../storage/pending';
import { clearPlan, savePlan } from '../storage/plan';
import { saveRecoveries } from '../storage/recoveries';
import { planRuns, syncPolling } from './polling';
import { chain, emit, generation, refreshWallet, sdk, state, wallet, type UnilateralExitEngineState } from './state';

// The plan's pass has `isAdvancing`; the kept recoveries' pass runs beside it.
let recoveriesBusy = false;

/** `list` with `recovery` in place of an entry it replaces: the same recovery, or one of no other leaves. */
export function withRecovery(list: UnilateralExitPlan[], recovery: UnilateralExitPlan): UnilateralExitPlan[] {
  const id = recoveryTxid(recovery);
  const leaves = new Set(recovery.exit.leaves.map(leaf => leaf.leafId));
  const replaced = (kept: UnilateralExitPlan) =>
    recoveryTxid(kept) === id || (kept.exit.leaves.length > 0 && kept.exit.leaves.every(leaf => leaves.has(leaf.leafId)));
  return [...list.filter(kept => !replaced(kept)), recovery];
}

/** The fee address the engine watches: the pending exit's, or the plan's while a leaf it left out waits on more exit fee. */
export const watchedAddress = ({ pending, plan }: Pick<UnilateralExitEngineState, 'pending' | 'plan'>): string | undefined =>
  pending?.fundingAddress ?? (plan?.status.type === 'needsExitFee' ? exitFeeRecordOf(plan).exitFeeAddress : undefined);

/** What the watched address was last read to hold: in this session, or as its owner stored it. */
export function lastHeldCoins({ pending, plan }: Pick<UnilateralExitEngineState, 'pending' | 'plan'>): ChainUtxo[] | undefined {
  const stored = pending ? pending.feeCoins : plan ? topUpOf(plan)?.feeCoins : undefined;
  return lastReadCoins(watchedAddress({ pending, plan })) ?? stored;
}

/**
 * Reads what the fee address holds, or null when it could not. The screens
 * then keep what it was last read to hold. Nothing starts without the user.
 */
async function watchPending(): Promise<ChainUtxo[] | null> {
  const address = watchedAddress(state);
  if (!chain || !wallet || !address) return null;
  const passGeneration = generation;
  const passWallet = wallet;
  try {
    const coins = await readFeeAddress(chain, address);
    if (generation !== passGeneration) return coins;
    // A plan's coins are stored with the plan its pass saves.
    const pending = state.pending && { ...state.pending, feeCoins: coins };
    if (pending) savePendingExit(passWallet, pending);
    emit({ pendingCoins: coins, ...(pending ? { pending } : {}) });
    return coins;
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to read the exit fee address', {
      error: e instanceof Error ? e.message : String(e),
    });
    const known = lastHeldCoins(state);
    if (known && generation === passGeneration) emit({ pendingCoins: known });
    return null;
  }
}

/** Done, with nothing of its ledger left to read and no sweep of its fee address still out. */
const isFinished = (plan: UnilateralExitPlan): boolean =>
  plan.status.type === 'done' && !hasWaitingLanding(plan) && !plan.feeSweep;

/**
 * Reads getInfo again before the row stops subtracting a leaf, as it does once
 * one lands: the SDK has taken that leaf out of the total, which the page
 * otherwise reads at its next sync, offering the leaf again until then. A
 * read that fails leaves the row to that sync.
 */
async function rereadFor(next: Partial<Pick<UnilateralExitEngineState, 'plan' | 'recoveries'>>): Promise<void> {
  if (refreshWallet && releasesLeaves(state, { ...state, ...next })) await refreshWallet().catch(() => false);
}

/** What a finished exit left at its fee address, or undefined when it had none or it cannot be read. */
async function unspentExitFeeSat(plan: UnilateralExitPlan, client: ChainClient): Promise<number | undefined> {
  const address = exitFeeRecordOf(plan).exitFeeAddress;
  if (!address) return undefined;
  const coins = (await readFeeCoins(client, address)) ?? lastReadCoins(address);
  return coins?.filter(coin => coin.confirmed).reduce((sum, coin) => sum + coin.value, 0);
}

function archiveOrSavePlan(passWallet: WalletKey, plan: UnilateralExitPlan, tipHeight: number, unspentSat?: number): void {
  // A finished exit hands its slot back: the record lives in the archive from
  // here, and the wizard has to be free to quote the next one. Archived while
  // a read waits, the record would miss what landed. Cleared only once what
  // it accounted for is stored, so a restart finds one or the other.
  const accounting = isFinished(plan) ? retireRecord(passWallet, plan) : null;
  if (accounting) {
    const archive = archiveExit(passWallet, plan, unspentSat);
    clearPlan(passWallet);
    emit({ plan: null, archive, accounting, tipHeight, isAdvancing: false, pendingCoins: [], endedPlans: state.endedPlans + 1 });
  } else {
    savePlan(passWallet, plan);
    const coinsDone = plan.status.type !== 'needsExitFee' && state.pendingCoins.length > 0;
    emit({ plan, tipHeight, isAdvancing: false, ...(coinsDone ? { pendingCoins: [] } : {}) });
  }
  syncPolling();
}

export async function advancePlan(): Promise<void> {
  const current = state.plan;
  if (!current) {
    await watchPending();
    return;
  }
  if (!wallet || !chain || state.isAdvancing) return;
  if (!planRuns(current)) {
    syncPolling();
    return;
  }

  const passGeneration = generation;
  const passWallet = wallet;
  const passSdk = sdk;
  const passChain = chain;
  emit({ isAdvancing: true });
  try {
    // Read before the pass, which builds the leftover once its fee confirms.
    // With no address yet there is nothing to read, and no coins to hand on.
    // Nor after a failed read: what was last read, or nothing, would set what
    // the address held before the ask too low.
    const coins = current.status.type === 'needsExitFee' ? await watchPending() : null;
    const passed = await advanceUnilateralExit(current, chain, passSdk ?? undefined, passWallet.identityPubkey, coins ?? undefined);
    const { tipHeight } = passed;
    // The fee address is shared, so nothing leaves it while a saved exit waits on it.
    const plan =
      passed.plan.status.type === 'done' && !state.pending ? await sweepLeftoverFee(passed.plan, passChain, tipHeight) : passed.plan;
    const unspentSat = isFinished(plan) ? await unspentExitFeeSat(plan, passChain) : undefined;
    // Whoever replaced the wallet or plan while this pass was out owns the state now.
    if (generation !== passGeneration) return;
    await rereadFor({ plan });
    if (generation !== passGeneration) return;
    archiveOrSavePlan(passWallet, coins && !state.pending ? withFeeCoins(plan, coins) : plan, tipHeight, unspentSat);
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Recovery engine pass failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    if (generation === passGeneration) emit({ isAdvancing: false });
  }
}

function retireFinished(
  passWallet: WalletKey,
  before: UnilateralExitPlan[],
  passes: { plan: UnilateralExitPlan }[],
): Pick<UnilateralExitEngineState, 'recoveries' | 'archive' | 'accounting'> {
  let archive = state.archive;
  let accounting = state.accounting;
  const recoveries: UnilateralExitPlan[] = [];
  for (const [i, { plan }] of passes.entries()) {
    // One replaced while this pass was out, such as by a fee bump, belongs to
    // its replacement now, which archives what landed once.
    if (!state.recoveries.includes(before[i])) continue;
    // Archived while a read waits, the record would miss what landed. Kept
    // too while what it accounted for cannot be stored.
    const retired = isFinished(plan) ? retireRecord(passWallet, plan) : null;
    if (!retired) recoveries.push(plan);
    else {
      accounting = retired;
      archive = archiveExit(passWallet, plan);
    }
  }
  // One kept while this pass was out replaces what the pass holds for it.
  return { recoveries: state.recoveries.filter(r => !before.includes(r)).reduce(withRecovery, recoveries), archive, accounting };
}

/**
 * Checks and rebroadcasts each kept co-signed recovery, and archives the ones
 * done. A stuck one is built again by the pass itself, which needs no key, so
 * its leaves stay held (`keptLeafIds`) rather than going to the next quote.
 */
export async function advanceRecoveries(): Promise<void> {
  const client = chain;
  if (recoveriesBusy || !wallet || !client || state.recoveries.length === 0) return;
  recoveriesBusy = true;
  const passGeneration = generation;
  const passWallet = wallet;
  const passSdk = sdk;
  const before = state.recoveries;
  try {
    const passes = await Promise.all(before.map(r => advanceUnilateralExit(r, client, passSdk ?? undefined)));
    if (generation !== passGeneration) return;
    // One kept while this pass was out stays as it is.
    const passed = state.recoveries.map(r => passes[before.indexOf(r)]?.plan ?? r);
    await rereadFor({ recoveries: passed });
    if (generation !== passGeneration) return;
    const kept = retireFinished(passWallet, before, passes);
    saveRecoveries(passWallet, kept.recoveries);
    emit({ ...kept, tipHeight: passes[0]?.tipHeight ?? state.tipHeight });
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Co-signed recovery pass failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    recoveriesBusy = false;
    syncPolling();
  }
}
