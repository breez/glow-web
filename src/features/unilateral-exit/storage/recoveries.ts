import { logger, LogCategory } from '@/services/logger';
import { asKeptRecovery, PLAN_VERSION, type UnilateralExitPlan, type WalletKey } from '../model/plan';

/**
 * Co-signed recoveries Glow broadcast and follows until they confirm. The sdk
 * records no payment for one, so this is the only record of it. Plan-shaped,
 * mode `recover`, cooperative transactions only, and kept beside the plan and
 * pending slots: they need no funding key, so they never hold up an exit.
 */
const recoveriesKey = ({ identityPubkey, network }: WalletKey): string =>
  `recovery-cosigned:${identityPubkey.slice(0, 16)}:${network}`;

export function saveRecoveries(wallet: WalletKey, recoveries: UnilateralExitPlan[]): void {
  try {
    localStorage.setItem(recoveriesKey(wallet), JSON.stringify(recoveries));
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to persist the co-signed recoveries', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function loadRecoveries(wallet: WalletKey): UnilateralExitPlan[] {
  const raw = localStorage.getItem(recoveriesKey(wallet));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as UnilateralExitPlan[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(r => r?.version === PLAN_VERSION && Array.isArray(r.exit?.transactions)).map(asKeptRecovery);
  } catch {
    return [];
  }
}
