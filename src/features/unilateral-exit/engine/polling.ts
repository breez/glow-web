import { isStalled } from '../leftovers';
import type { UnilateralExitPlan } from '../model/plan';
import { advancePlan, advanceRecoveries } from './passes';
import { state, wallet } from './state';

const POLL_SECS_MAINNET = 30;
const POLL_SECS_REGTEST = 5;

/** Regtest moves as fast as blocks are mined by hand, so it polls far more often. */
export function pollIntervalMs(network: string): number {
  const override = Number(import.meta.env.VITE_UNILATERAL_EXIT_POLL_SECS);
  if (Number.isFinite(override) && override > 0) return override * 1_000;
  return (network === 'regtest' ? POLL_SECS_REGTEST : POLL_SECS_MAINNET) * 1_000;
}

let timer: ReturnType<typeof setInterval> | null = null;
let timerMs = 0;

export const stopPolling = (): void => {
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

/** A diverged exit that needs the user's sign-in waits for the tracker's button, so it has no passes to run. */
export const planRuns = ({ status }: UnilateralExitPlan): boolean =>
  !(status.type === 'needsUpdate' && status.why === 'signIn');

/**
 * While all that is left is co-signed recoveries stuck unverified, nothing
 * moves between Glow's retries, which are blocks apart: polling then runs
 * about once a block. Coming back to the app still runs a pass at once.
 */
const STALLED_POLL_FACTOR = 20;

export const syncPolling = (): void => {
  const plan = state.plan && planRuns(state.plan) ? state.plan : null;
  if (!wallet || (!plan && !state.pending && state.recoveries.length === 0)) return stopPolling();
  const stalled = !state.pending && [plan, ...state.recoveries].every(p => !p || isStalled(p));
  startPolling(pollIntervalMs(wallet.network) * (stalled ? STALLED_POLL_FACTOR : 1));
};

export async function advanceNow(): Promise<void> {
  await Promise.all([advancePlan(), advanceRecoveries()]);
}
