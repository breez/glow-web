import { logger, LogCategory } from '@/services/logger';
import { saveExitState } from '../exitState';
import { PLAN_VERSION, type UnilateralExitPlan, type WalletKey } from '../model/plan';
import { planFromV4, type V4Plan } from './legacyPlan';

const storageKey = ({ identityPubkey, network }: WalletKey): string =>
  `recovery-plan:${identityPubkey.slice(0, 16)}:${network}`;

export function savePlan(wallet: WalletKey, plan: UnilateralExitPlan): void {
  try {
    localStorage.setItem(storageKey(wallet), JSON.stringify(plan));
    return;
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to persist recovery plan', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  // The snapshot can outgrow localStorage. Losing the plan would lose the exit,
  // so it is kept without the snapshot, which moves to the rolling backup that
  // a restore falls back to and that nothing refreshes while the exit runs.
  // ponytail: retried on every save while too big; keep the snapshot in
  // IndexedDB from the start if that ever costs.
  if (!plan.exitStateSnapshot) return;
  const { exitStateSnapshot, ...rest } = plan;
  try {
    localStorage.setItem(storageKey(wallet), JSON.stringify(rest));
    void saveExitState(wallet.identityPubkey, exitStateSnapshot).catch(e =>
      logger.error(LogCategory.SDK, 'Failed to move the exit snapshot to the rolling backup', {
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to persist recovery plan without its snapshot', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** A version 4 plan, from SDK 0.26, is converted rather than dropped: it may be part-way through an exit. */
export function loadPlan(wallet: WalletKey): UnilateralExitPlan | null {
  const raw = localStorage.getItem(storageKey(wallet));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UnilateralExitPlan | V4Plan;
    if (!Array.isArray(parsed?.exit?.transactions)) return null;
    if (parsed.version === 4) return planFromV4(parsed);
    return parsed.version === PLAN_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPlan(wallet: WalletKey): void {
  localStorage.removeItem(storageKey(wallet));
}
