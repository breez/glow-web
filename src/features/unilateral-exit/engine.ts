import { createChainClient, type ChainClient } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { advanceUnilateralExit, clearPlan, loadPlan, savePlan } from './driver';
import { archiveExit, loadArchive, type ArchivedExit } from './archive';
import type { ExitSdk, UnilateralExitPlan, WalletKey } from './driver';

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
  /** Exits that already finished, newest first. Outlives the plan slot. */
  archive: ArchivedExit[];
  tipHeight: number | null;
  isAdvancing: boolean;
}

type Listener = (state: UnilateralExitEngineState) => void;

let state: UnilateralExitEngineState = { plan: null, archive: [], tipHeight: null, isAdvancing: false };
let wallet: WalletKey | null = null;
let chain: ChainClient | null = null;
let sdk: ExitSdk | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
// Bumped whenever the wallet or its plan is replaced. A pass that started under
// an older generation is for something no longer current, so it must not write.
let generation = 0;
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

export async function advanceNow(): Promise<void> {
  if (!wallet || !chain || !state.plan || state.isAdvancing) return;
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
 * the exit back, rebuild it, or learn that it has finished.
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
  emit({ plan: loadPlan(target), archive: loadArchive(target) });
  if (!state.plan) return;

  void advanceNow();
  startPolling();
}

export function stopUnilateralExitEngine(): void {
  generation++;
  stopPolling();
  wallet = null;
  chain = null;
  sdk = null;
  emit({ plan: null, archive: [], tipHeight: null, isAdvancing: false });
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

export function dismissUnilateralExitPlan(): void {
  if (!wallet) return;
  clearPlan(wallet);
  emit({ plan: null });
}
