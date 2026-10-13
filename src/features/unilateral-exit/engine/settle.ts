import { logger, LogCategory } from '@/services/logger';
import type { ExitSdk } from '../quoting';
import { settleLeaves, unsettledLeaves } from '../storage/accounting';
import { syncPolling } from './polling';
import { emit, isRunningFor, refreshWallet, sdk, state, wallet } from './state';

// Sdks with a settle sync out. Keyed by instance, so a restart's new one is not held behind it.
const settling = new WeakSet<ExitSdk>();

/**
 * Syncs once for the leaves landed so far, which getInfo counts until a sync
 * recounts after they landed. The recount runs offline too, and a sync whose
 * exit-chain collection fails after it still rejects. So a rejection settles
 * as well, unless this run has ended: then it may come from the shutdown.
 */
export async function settle(): Promise<void> {
  const passWallet = wallet;
  const passSdk = sdk;
  const passRefresh = refreshWallet;
  const ids = unsettledLeaves(state).map(leaf => leaf.leafId);
  if (!passWallet || !passSdk || settling.has(passSdk) || ids.length === 0) return;
  settling.add(passSdk);
  try {
    try {
      await passSdk.syncWallet({});
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to sync after a recovery landed', {
        error: e instanceof Error ? e.message : String(e),
      });
      if (!isRunningFor(passWallet) || sdk !== passSdk) return;
    }
    // The row stops subtracting these once they settle, so the page reads the
    // recounted total first. A read that fails leaves them to the next pass.
    if (passRefresh && isRunningFor(passWallet) && !(await passRefresh().catch(() => false))) return;
  } finally {
    settling.delete(passSdk);
  }
  const accounting = settleLeaves(passWallet, ids);
  if (!isRunningFor(passWallet)) return;
  emit({ accounting, settledLeafIds: new Set([...state.settledLeafIds, ...ids]) });
  syncPolling();
}
