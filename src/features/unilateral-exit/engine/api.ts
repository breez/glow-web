import type { PrepareRecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { createChainClient, type ChainClient } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { startExit } from '../building';
import { isPendingFunded } from '../exitFee';
import type { FundingKey } from '../funding';
import { releasesLeaves } from '../listEntries';
import { asKeptRecovery, type NamedLeaf, type PendingExit, type UnilateralExitPlan, type WalletKey } from '../model/plan';
import type { StopClock, StoppedSince } from '../quote';
import type { ExitSdk } from '../quoting';
import { loadAccounting, recordDropped, recordStopped } from '../storage/accounting';
import { loadArchive } from '../storage/archive';
import { clearPendingExit, loadPendingExit, savePendingExit } from '../storage/pending';
import { loadPlan, savePlan } from '../storage/plan';
import { loadRecoveries, saveRecoveries } from '../storage/recoveries';
import { advanceRecoveries, lastHeldCoins, withRecovery } from './passes';
import { advanceNow, stopPolling, syncPolling } from './polling';
import {
  chain,
  emit,
  endRun,
  excludedLeafIds,
  generation,
  idle,
  isRunningFor,
  nextGeneration,
  refreshWallet,
  sdk,
  startRun,
  state,
  wallet,
} from './state';

// The key the wizard derived, so a passkey wallet starts without a second
// prompt while the app stays open. Never stored.
let heldKey: FundingKey | null = null;

/**
 * The clock a start's quote is read by, as a Recover Funds review reads its
 * own: the dates the accounting keeps, with each leaf the quote stops for the
 * first time dated at the tip. Without a tip there is none.
 */
async function startClock(target: WalletKey, client: ChainClient, quote: PrepareRecoverFundsResponse): Promise<StopClock | undefined> {
  const tipHeight = await client.tipHeight().catch(() => null);
  return tipHeight === null ? undefined : { since: noteStopped(target, quote, tipHeight), tipHeight };
}

/**
 * Starts the pending exit from the user's tap, with the coins the address was
 * last read to hold. Nothing awaits before the key is read, so a passkey
 * prompt still counts as the tap's.
 */
export async function startPendingExit(): Promise<void> {
  const pending = state.pending;
  if (!wallet || !sdk || !chain || !pending || state.isStarting || !isPendingFunded(pending, state.pendingCoins)) return;
  const passGeneration = generation;
  const passWallet = wallet;
  const passChain = chain;
  const confirmed = state.pendingCoins.filter(coin => coin.confirmed);
  emit({ isStarting: true, startError: null, nothingToExit: null });
  try {
    const key = heldKey?.address === pending.fundingAddress ? heldKey : undefined;
    const outcome = await startExit(pending, confirmed, sdk, passWallet.identityPubkey, key, excludedLeafIds(state), quote =>
      startClock(passWallet, passChain, quote),
    );
    if (generation !== passGeneration) return;
    switch (outcome.type) {
      case 'started':
        // In this order, so stopping part-way never loses the exit or its coins.
        setUnilateralExitPlan(passWallet, outcome.plan);
        clearPendingExit(passWallet);
        heldKey = null;
        emit({ pending: null, pendingCoins: [], isStarting: false });
        return;
      case 'short': {
        const next = { ...pending, required: outcome.required };
        savePendingExit(passWallet, next);
        emit({ pending: next, isStarting: false });
        return;
      }
      case 'nothingToExit':
        emit({ nothingToExit: { reason: outcome.reason }, isStarting: false });
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error(LogCategory.SDK, 'Failed to start the unilateral exit', { error });
    if (generation === passGeneration) emit({ startError: error, isStarting: false });
  }
}

/**
 * Without `driver` a pass only re-sends what it already holds: it cannot read
 * the exit back, rebuild it, learn that it has finished, or start a pending one.
 * `refresh` reads getInfo again for the wallet page.
 */
export function startUnilateralExitEngine(
  target: WalletKey,
  client: ChainClient = createChainClient(target.network),
  driver?: ExitSdk | null,
  refresh?: () => Promise<boolean>,
): void {
  startRun(target, client, driver ?? null, refresh ?? null);
  const plan = loadPlan(target);
  // Left behind by a start that saved its plan and stopped before clearing it.
  if (plan) clearPendingExit(target);
  const pending = plan ? null : loadPendingExit(target);
  const recoveries = loadRecoveries(target);
  const accounting = loadAccounting(target);
  // What the fee address last held, so a restart whose read fails does not show it as empty.
  const pendingCoins = lastHeldCoins({ plan, pending }) ?? [];
  emit({ ...idle, plan, pending, pendingCoins, archive: loadArchive(target), recoveries, accounting });
  syncPolling();
  if (plan || pending || recoveries.length > 0) void advanceNow();
}

export function stopUnilateralExitEngine(): void {
  endRun();
  stopPolling();
  emit(idle);
}

/** Stores the plan for `target` and, if the engine is running for it, starts driving it. */
export function setUnilateralExitPlan(target: WalletKey, plan: UnilateralExitPlan): void {
  savePlan(target, plan);
  if (!isRunningFor(target)) return;
  // A build can record a leaf landed, which the SDK took out of the total, so
  // the page reads getInfo again for the row.
  const releases = releasesLeaves(state, { ...state, plan });
  // A pass still out for the old plan is discarded when it lands, so this one
  // does not wait for it.
  nextGeneration();
  emit({ plan, isAdvancing: false });
  if (releases) void refreshWallet?.().catch(() => false);
  syncPolling();
  void advanceNow();
}

/**
 * Stores a fresh exit before its fee is paid and starts watching the address.
 * `key` is held in memory only, for the start.
 */
export function setPendingExit(target: WalletKey, pending: PendingExit, key?: FundingKey): void {
  savePendingExit(target, pending);
  heldKey = key ?? null;
  if (!isRunningFor(target)) return;
  nextGeneration();
  emit({ pending, pendingCoins: [], nothingToExit: null, startError: null, isStarting: false });
  syncPolling();
  void advanceNow();
}

/**
 * Keeps a co-signed recovery Glow just built, in place of one it replaces, and
 * if the engine is running for `target`, starts following it.
 */
export function keepRecovery(target: WalletKey, recovery: UnilateralExitPlan): void {
  const running = isRunningFor(target);
  const recoveries = withRecovery(running ? state.recoveries : loadRecoveries(target), asKeptRecovery(recovery));
  saveRecoveries(target, recoveries);
  if (!running) return;
  emit({ recoveries });
  syncPolling();
  void advanceRecoveries();
}

/**
 * Leaves a Recover Funds quote found unrecoverable that no record holds. Kept
 * so the row and later quotes leave them out, as they do a record's.
 */
export function noteDropped(target: WalletKey, leaves: NamedLeaf[]): void {
  if (leaves.length === 0) return;
  const accounting = recordDropped(target, leaves);
  if (isRunningFor(target)) emit({ accounting });
}

/** Dates the leaves a Recover Funds quote stops, and returns every date kept, to read that quote against. */
export function noteStopped(target: WalletKey, quote: PrepareRecoverFundsResponse, tipHeight: number): StoppedSince | undefined {
  const accounting = recordStopped(target, quote, tipHeight);
  if (isRunningFor(target)) emit({ accounting });
  return accounting.stoppedSince;
}

/** Coins already at the fee address stay there, and the next exit uses the same address. */
export function cancelPendingExit(): void {
  if (!wallet) return;
  nextGeneration();
  clearPendingExit(wallet);
  heldKey = null;
  emit({ pending: null, pendingCoins: [], nothingToExit: null, startError: null, isStarting: false });
  syncPolling();
}
