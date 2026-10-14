import type { ChainClient, ChainUtxo } from '@/services/chain';
import { keptLeafIds, type PendingExit, type UnilateralExitPlan, type WalletKey } from '../model/plan';
import type { LeftOutReason } from '../quote';
import type { ExitSdk } from '../quoting';
import { noAccounting, type ExitAccounting } from '../storage/accounting';
import { droppedLeafIds, type ArchivedExit } from '../storage/archive';

export interface UnilateralExitEngineState {
  plan: UnilateralExitPlan | null;
  /** An exit waiting on its fee. Never held alongside `plan`. */
  pending: PendingExit | null;
  /**
   * What the fee address holds, confirmed or not: the pending exit's, or the
   * plan's while a leaf it left out waits on more exit fee.
   */
  pendingCoins: ChainUtxo[];
  /**
   * A start found nothing worth its exit fee at the exit's rate, and why: null
   * when its quote skipped nothing either. Funds that may yet move
   * (`unavailable`) leave the start open, to try again later.
   */
  nothingToExit: { reason: LeftOutReason | null } | null;
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
  accounting: ExitAccounting;
  /** Live records' landed leaves a sync has recounted since. In memory only, so a restart syncs once more. */
  settledLeafIds: ReadonlySet<string>;
  tipHeight: number | null;
  isAdvancing: boolean;
}

type Listener = (state: UnilateralExitEngineState) => void;

export const idle: UnilateralExitEngineState = {
  plan: null,
  pending: null,
  pendingCoins: [],
  nothingToExit: null,
  isStarting: false,
  startError: null,
  archive: [],
  recoveries: [],
  accounting: noAccounting,
  settledLeafIds: new Set(),
  tipHeight: null,
  isAdvancing: false,
};

export let state: UnilateralExitEngineState = idle;
export let wallet: WalletKey | null = null;
export let chain: ChainClient | null = null;
export let sdk: ExitSdk | null = null;
export let refreshWallet: (() => Promise<boolean>) | null = null;
// Bumped whenever the wallet or its plan is replaced. A pass that started under
// an older generation is for something no longer current, so it must not write.
export let generation = 0;
const listeners = new Set<Listener>();

export function startRun(
  target: WalletKey,
  client: ChainClient,
  driver: ExitSdk | null,
  refresh: (() => Promise<boolean>) | null,
): void {
  generation++;
  wallet = target;
  chain = client;
  sdk = driver;
  refreshWallet = refresh;
}

export function endRun(): void {
  generation++;
  wallet = null;
  chain = null;
  sdk = null;
  refreshWallet = null;
}

export const nextGeneration = (): void => {
  generation++;
};

export const emit = (next: Partial<UnilateralExitEngineState>): void => {
  state = { ...state, ...next };
  listeners.forEach(listener => listener(state));
};

export const getUnilateralExitState = (): UnilateralExitEngineState => state;

export function subscribeUnilateralExit(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export const isRunningFor = (target: WalletKey): boolean =>
  wallet?.identityPubkey === target.identityPubkey && wallet.network === target.network;

/** A start found nothing it could move, now or later: only a cancel is left. */
export const startDeadEnded = ({ nothingToExit }: Pick<UnilateralExitEngineState, 'nothingToExit'>): boolean =>
  !!nothingToExit && nothingToExit.reason !== 'unavailable';

/** What a fresh quote leaves out: the leaves kept recoveries hold, and those Glow dropped as unrecoverable. */
export const excludedLeafIds = ({
  recoveries,
  archive,
  accounting,
}: Pick<UnilateralExitEngineState, 'recoveries' | 'archive' | 'accounting'>): Set<string> =>
  new Set([...keptLeafIds(recoveries), ...droppedLeafIds([...recoveries, ...archive, accounting])]);
