import { logger, LogCategory } from '@/services/logger';
import type { PendingExit, WalletKey } from '../model/plan';

const pendingKey = ({ identityPubkey, network }: WalletKey): string =>
  `unilateral-exit-pending:${identityPubkey.slice(0, 16)}:${network}`;

export function savePendingExit(wallet: WalletKey, pending: PendingExit): void {
  try {
    localStorage.setItem(pendingKey(wallet), JSON.stringify(pending));
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to persist the pending unilateral exit', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function loadPendingExit(wallet: WalletKey): PendingExit | null {
  const raw = localStorage.getItem(pendingKey(wallet));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingExit;
    return typeof parsed?.fundingAddress === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingExit(wallet: WalletKey): void {
  localStorage.removeItem(pendingKey(wallet));
}
