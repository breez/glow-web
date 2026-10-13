import { createChainClient, type ChainClient, type ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import {
  advanceUnilateralExit,
  clearPendingExit,
  clearPlan,
  hasWaitingLanding,
  isStalled,
  keptLeafIds,
  loadPendingExit,
  isPendingFunded,
  loadPlan,
  loadRecoveries,
  savePendingExit,
  savePlan,
  saveRecoveries,
  startExit,
} from './driver';
import { archiveExit, droppedLeafIds, loadArchive, recoveryTxid, type ArchivedExit } from './archive';
import type { FundingKey } from './funding';
import type { ExitSdk, PendingExit, UnilateralExitPlan, WalletKey } from './driver';

const POLL_SECS_MAINNET = 30;
const POLL_SECS_REGTEST = 5;

/** Regtest moves as fast as blocks are mined by hand, so it polls far more often. */
export function pollIntervalMs(network: string): number {
  const override = Number(import.meta.env.VITE_UNILATERAL_EXIT_POLL_SECS);
  if (Number.isFinite(override) && override > 0) return override * 1_000;
  return (network === 'regtest' ? POLL_SECS_REGTEST : POLL_SECS_MAINNET) * 1_000;
}

export interface UnilateralExitEngineState {
  plan: UnilateralExitPlan | null;
  /** An exit waiting on its fee. Never held alongside `plan`. */
  pending: PendingExit | null;
  /** What the pending exit's fee address holds, confirmed or not. */
  pendingCoins: ChainUtxo[];
  /** A start found nothing in the wallet worth its exit fee at the exit's rate. */
  nothingToExit: boolean;
  isStarting: boolean;
  /** Why the last start failed, for the user to try again. */
  startError: string | null;
  /** Exits that already finished, newest first. Outlives the plan slot. */
  archive: ArchivedExit[];
  /**
   * Co-signed recoveries kept until they confirm, never in the plan slot. Each
   * pass checks and rebroadcasts them, builds a stuck one again, and archives
   * one once it is done.
   */
  recoveries: UnilateralExitPlan[];
  tipHeight: number | null;
  isAdvancing: boolean;
}

type Listener = (state: UnilateralExitEngineState) => void;

const idle: UnilateralExitEngineState = {
  plan: null,
  pending: null,
  pendingCoins: [],
  nothingToExit: false,
  isStarting: false,
  startError: null,
  archive: [],
  recoveries: [],
  tipHeight: null,
  isAdvancing: false,
};

let state: UnilateralExitEngineState = idle;
let wallet: WalletKey | null = null;
let chain: ChainClient | null = null;
let sdk: ExitSdk | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let timerMs = 0;
// Bumped whenever the wallet or its plan is replaced. A pass that started under
// an older generation is for something no longer current, so it must not write.
let generation = 0;
// The key the wizard derived, so a passkey wallet starts without a second
// prompt while the app stays open. Never stored.
let heldKey: FundingKey | null = null;
// The plan's pass has `isAdvancing`; the kept recoveries' pass runs beside it.
let recoveriesBusy = false;
const listeners = new Set<Listener>();

const emit = (next: Partial<UnilateralExitEngineState>): void => {
  state = { ...state, ...next };
  listeners.forEach(listener => listener(state));
};

const stopPolling = (): void => {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
};

const startPolling = (ms: number): void => {
  if (timer !== null && timerMs === ms) return;
  stopPolling();
  timerMs = ms;
  timer = setInterval(() => void advanceNow(), ms);
};

/** A redo that needs the user's sign-in waits for the tracker's button, so it has no passes to run. */
const planRuns = (plan: UnilateralExitPlan): boolean => plan.phase !== 'redo' || !plan.needsSignIn;

/**
 * While all that is left is co-signed recoveries stuck unverified, nothing
 * moves between Glow's retries, which are blocks apart: polling then runs
 * about once a block. Coming back to the app still runs a pass at once.
 */
const STALLED_POLL_FACTOR = 20;

const syncPolling = (): void => {
  const plan = state.plan && planRuns(state.plan) ? state.plan : null;
  if (!wallet || (!plan && !state.pending && state.recoveries.length === 0)) return stopPolling();
  const stalled = !state.pending && [plan, ...state.recoveries].every(p => !p || isStalled(p));
  startPolling(pollIntervalMs(wallet.network) * (stalled ? STALLED_POLL_FACTOR : 1));
};

/** getInfo counts a landed recovery's leaves as recoverable until a sync sees it in a block. */
const syncAfterLanding = (driver: ExitSdk | null): void => {
  if (!driver) return;
  driver.syncWallet({}).catch(e =>
    logger.warn(LogCategory.SDK, 'Failed to sync after a recovery landed', {
      error: e instanceof Error ? e.message : String(e),
    }),
  );
};

/** `list` with `recovery` in place of an entry it replaces: the same recovery, or one of no other leaves. */
function withRecovery(list: UnilateralExitPlan[], recovery: UnilateralExitPlan): UnilateralExitPlan[] {
  const id = recoveryTxid(recovery);
  const leaves = new Set(recovery.exit.leaves.map(leaf => leaf.leafId));
  const replaced = (kept: UnilateralExitPlan) =>
    recoveryTxid(kept) === id || (kept.exit.leaves.length > 0 && kept.exit.leaves.every(leaf => leaves.has(leaf.leafId)));
  return [...list.filter(kept => !replaced(kept)), recovery];
}

export const getUnilateralExitState = (): UnilateralExitEngineState => state;

/** What a fresh quote leaves out: the leaves kept recoveries hold, and those Glow dropped as unrecoverable. */
export const excludedLeafIds = ({ recoveries, archive }: Pick<UnilateralExitEngineState, 'recoveries' | 'archive'>): Set<string> =>
  new Set([...keptLeafIds(recoveries), ...droppedLeafIds([...recoveries, ...archive])]);

const isRunningFor = (target: WalletKey): boolean =>
  wallet?.identityPubkey === target.identityPubkey && wallet.network === target.network;

export function subscribeUnilateralExit(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** Reads what the pending exit's fee address holds. Nothing starts without the user. */
async function watchPending(): Promise<void> {
  const pending = state.pending;
  if (!chain || !pending) return;
  const passGeneration = generation;
  try {
    const coins = await chain.addressUtxos(pending.fundingAddress);
    if (generation === passGeneration) emit({ pendingCoins: coins });
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to read the exit fee address', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Starts the pending exit from the user's tap, with the coins the address was
 * last read to hold. Nothing awaits before the key is read, so a passkey
 * prompt still counts as the tap's.
 */
export async function startPendingExit(): Promise<void> {
  const pending = state.pending;
  if (!wallet || !sdk || !pending || state.isStarting || !isPendingFunded(pending, state.pendingCoins)) return;
  const passGeneration = generation;
  const passWallet = wallet;
  const confirmed = state.pendingCoins.filter(coin => coin.confirmed);
  emit({ isStarting: true, startError: null, nothingToExit: false });
  try {
    const key = heldKey?.address === pending.fundingAddress ? heldKey : undefined;
    const outcome = await startExit(pending, confirmed, sdk, passWallet.identityPubkey, key, excludedLeafIds(state));
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
        emit({ nothingToExit: true, isStarting: false });
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error(LogCategory.SDK, 'Failed to start the unilateral exit', { error });
    if (generation === passGeneration) emit({ startError: error, isStarting: false });
  }
}

export async function advanceNow(): Promise<void> {
  await Promise.all([advancePlan(), advanceRecoveries()]);
}

async function advancePlan(): Promise<void> {
  const current = state.plan;
  if (!current) return watchPending();
  if (!wallet || !chain || state.isAdvancing) return;
  if (!planRuns(current)) {
    syncPolling();
    return;
  }

  const passGeneration = generation;
  const passWallet = wallet;
  const passSdk = sdk;
  emit({ isAdvancing: true });
  try {
    const { plan, tipHeight } = await advanceUnilateralExit(
      current,
      chain,
      passSdk ?? undefined,
      passWallet.identityPubkey,
    );
    // Whoever replaced the wallet or plan while this pass was out owns the state now.
    if (generation !== passGeneration) return;
    // A finished exit hands its slot back: the record lives in the archive from
    // here, and the wizard has to be free to quote the next one. Archived while
    // a read waits, the record would miss what landed.
    if (plan.phase === 'complete' && !hasWaitingLanding(plan)) {
      const archive = archiveExit(passWallet, plan);
      clearPlan(passWallet);
      emit({ plan: null, archive, tipHeight, isAdvancing: false });
      syncPolling();
      syncAfterLanding(passSdk);
      return;
    }

    savePlan(passWallet, plan);
    emit({ plan, tipHeight, isAdvancing: false });
    syncPolling();
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Recovery engine pass failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    if (generation === passGeneration) emit({ isAdvancing: false });
  }
}

/**
 * Checks and rebroadcasts each kept co-signed recovery, and archives the ones
 * done. A stuck one is built again by the pass itself, which needs no key, so
 * its leaves stay held (`keptLeafIds`) rather than going to the next quote.
 */
async function advanceRecoveries(): Promise<void> {
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

    let archive = state.archive;
    let landed = false;
    let recoveries: UnilateralExitPlan[] = [];
    for (const [i, { plan }] of passes.entries()) {
      // One replaced while this pass was out, such as by a fee bump, belongs to
      // its replacement now, which archives what landed once.
      if (!state.recoveries.includes(before[i])) continue;
      // Archived while a read waits, the record would miss what landed.
      if (plan.phase !== 'complete' || hasWaitingLanding(plan)) recoveries.push(plan);
      else {
        archive = archiveExit(passWallet, plan);
        landed = true;
      }
    }
    // One kept while this pass was out replaces what the pass holds for it.
    recoveries = state.recoveries.filter(r => !before.includes(r)).reduce(withRecovery, recoveries);
    saveRecoveries(passWallet, recoveries);
    emit({ recoveries, archive, tipHeight: passes[0]?.tipHeight ?? state.tipHeight });
    if (landed) syncAfterLanding(passSdk);
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Co-signed recovery pass failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    recoveriesBusy = false;
    syncPolling();
  }
}

/**
 * Without `driver` a pass only re-sends what it already holds: it cannot read
 * the exit back, rebuild it, learn that it has finished, or start a pending one.
 */
export function startUnilateralExitEngine(
  target: WalletKey,
  client: ChainClient = createChainClient(target.network),
  driver?: ExitSdk | null,
): void {
  generation++;
  wallet = target;
  chain = client;
  sdk = driver ?? null;
  const plan = loadPlan(target);
  // Left behind by a start that saved its plan and stopped before clearing it.
  if (plan) clearPendingExit(target);
  const pending = plan ? null : loadPendingExit(target);
  const recoveries = loadRecoveries(target);
  emit({ ...idle, plan, pending, archive: loadArchive(target), recoveries });
  syncPolling();
  if (plan || pending || recoveries.length > 0) void advanceNow();
}

export function stopUnilateralExitEngine(): void {
  generation++;
  stopPolling();
  wallet = null;
  chain = null;
  sdk = null;
  emit(idle);
}

/** Stores the plan for `target` and, if the engine is running for it, starts driving it. */
export function setUnilateralExitPlan(target: WalletKey, plan: UnilateralExitPlan): void {
  savePlan(target, plan);
  if (!isRunningFor(target)) return;
  // A pass still out for the old plan is discarded when it lands, so this one
  // does not wait for it.
  generation++;
  emit({ plan, isAdvancing: false });
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
  generation++;
  emit({ pending, pendingCoins: [], nothingToExit: false, startError: null, isStarting: false });
  syncPolling();
  void advanceNow();
}

/**
 * Keeps a co-signed recovery Glow just built, in place of one it replaces, and
 * if the engine is running for `target`, starts following it.
 */
export function keepRecovery(target: WalletKey, recovery: UnilateralExitPlan): void {
  const running = isRunningFor(target);
  const recoveries = withRecovery(running ? state.recoveries : loadRecoveries(target), recovery);
  saveRecoveries(target, recoveries);
  if (!running) return;
  emit({ recoveries });
  syncPolling();
  void advanceRecoveries();
}

/** Coins already at the fee address stay there, and the next exit uses the same address. */
export function cancelPendingExit(): void {
  if (!wallet) return;
  generation++;
  clearPendingExit(wallet);
  heldKey = null;
  emit({ pending: null, pendingCoins: [], nothingToExit: false, startError: null, isStarting: false });
  syncPolling();
}

export function dismissUnilateralExitPlan(): void {
  if (!wallet) return;
  clearPlan(wallet);
  emit({ plan: null });
  syncPolling();
}
