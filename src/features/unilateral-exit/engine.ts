import { createChainClient, type ChainClient, type ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import {
  advanceUnilateralExit,
  clearPendingExit,
  clearPlan,
  loadPendingExit,
  isPendingFunded,
  loadPlan,
  savePendingExit,
  savePlan,
  startExit,
} from './driver';
import { archiveExit, loadArchive, type ArchivedExit } from './archive';
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
  tipHeight: null,
  isAdvancing: false,
};

let state: UnilateralExitEngineState = idle;
let wallet: WalletKey | null = null;
let chain: ChainClient | null = null;
let sdk: ExitSdk | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
// Bumped whenever the wallet or its plan is replaced. A pass that started under
// an older generation is for something no longer current, so it must not write.
let generation = 0;
// The key the wizard derived, so a passkey wallet starts without a second
// prompt while the app stays open. Never stored.
let heldKey: FundingKey | null = null;
const listeners = new Set<Listener>();

const emit = (next: Partial<UnilateralExitEngineState>): void => {
  state = { ...state, ...next };
  listeners.forEach(listener => listener(state));
};

const startPolling = (): void => {
  if (timer !== null || !wallet) return;
  timer = setInterval(() => void advanceNow(), pollIntervalMs(wallet.network));
};

const stopPolling = (): void => {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
};

export const getUnilateralExitState = (): UnilateralExitEngineState => state;

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
    const outcome = await startExit(pending, confirmed, sdk, passWallet.identityPubkey, key);
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
  if (!state.plan) return watchPending();
  if (!wallet || !chain || state.isAdvancing) return;
  if (state.plan.phase !== 'active') {
    stopPolling();
    return;
  }

  const passGeneration = generation;
  const passWallet = wallet;
  emit({ isAdvancing: true });
  try {
    const { plan, tipHeight } = await advanceUnilateralExit(
      state.plan,
      chain,
      sdk ?? undefined,
      passWallet.identityPubkey,
    );
    // Whoever replaced the wallet or plan while this pass was out owns the state now.
    if (generation !== passGeneration) return;
    // A finished exit hands its slot back: the record lives in the archive from
    // here, and the wizard has to be free to quote the next one.
    if (plan.phase === 'complete') {
      const archive = archiveExit(passWallet, plan);
      clearPlan(passWallet);
      emit({ plan: null, archive, tipHeight, isAdvancing: false });
      stopPolling();
      return;
    }

    savePlan(passWallet, plan);
    emit({ plan, tipHeight, isAdvancing: false });
    if (plan.phase !== 'active') stopPolling();
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Recovery engine pass failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    if (generation === passGeneration) emit({ isAdvancing: false });
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
  emit({ ...idle, plan, pending, archive: loadArchive(target) });
  if (!plan && !pending) return;

  void advanceNow();
  startPolling();
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
  if (wallet?.identityPubkey !== target.identityPubkey || wallet.network !== target.network) return;
  // A pass still out for the old plan is discarded when it lands, so this one
  // does not wait for it.
  generation++;
  emit({ plan, isAdvancing: false });
  startPolling();
  void advanceNow();
}

/**
 * Stores a fresh exit before its fee is paid and starts watching the address.
 * `key` is held in memory only, for the start.
 */
export function setPendingExit(target: WalletKey, pending: PendingExit, key?: FundingKey): void {
  savePendingExit(target, pending);
  heldKey = key ?? null;
  if (wallet?.identityPubkey !== target.identityPubkey || wallet.network !== target.network) return;
  generation++;
  emit({ pending, pendingCoins: [], nothingToExit: false, startError: null, isStarting: false });
  startPolling();
  void advanceNow();
}

/** Coins already at the fee address stay there, and the next exit uses the same address. */
export function cancelPendingExit(): void {
  if (!wallet) return;
  generation++;
  stopPolling();
  clearPendingExit(wallet);
  heldKey = null;
  emit({ pending: null, pendingCoins: [], nothingToExit: false, startError: null, isStarting: false });
}

export function dismissUnilateralExitPlan(): void {
  if (!wallet) return;
  clearPlan(wallet);
  emit({ plan: null });
}
