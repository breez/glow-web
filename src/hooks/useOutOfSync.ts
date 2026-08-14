import { useEffect, useState } from 'react';

/**
 * How long a connected session may go without a confirmed sync before the UI
 * stops presenting its cached balance as current.
 */
export const SYNC_GRACE_MS = 15000;

/**
 * True once a connected session has gone `graceMs` without a single confirmed
 * sync.
 *
 * Absence of the `synced` event is the only signal the app gets. The SDK has
 * no "sync failed" event, and `syncWallet` resolves Ok even when every leg
 * failed: `sync_wallet_internal` swallows each leg into a boolean and reports
 * the misses only as log lines. So a device that cannot reach the Spark
 * operators shows its (empty) local cache as a confident balance, with
 * nothing in the UI to say otherwise.
 *
 * The window only works because the app forces a sync on connect. Left to the
 * SDK's own 60s loop, the first `synced` of a session can legitimately be a
 * minute late, and any shorter window would fire on healthy launches.
 *
 * ponytail: a slow-but-working network can flash the warning before the first
 * sync lands; it self-clears on `synced`. Widen the window if that shows up in
 * the wild, or plumb a real per-leg failure signal out of the SDK.
 */
export function useOutOfSync(
  isConnected: boolean,
  hasSynced: boolean,
  graceMs: number = SYNC_GRACE_MS,
): boolean {
  const [graceElapsed, setGraceElapsed] = useState(false);

  // Re-arm on input change (React docs adjust-state-on-prop-change pattern),
  // so a reconnect or a later session starts out trusted instead of
  // inheriting a stale verdict.
  const [prevInputs, setPrevInputs] = useState({ isConnected, hasSynced });
  if (prevInputs.isConnected !== isConnected || prevInputs.hasSynced !== hasSynced) {
    setPrevInputs({ isConnected, hasSynced });
    setGraceElapsed(false);
  }

  useEffect(() => {
    if (!isConnected || hasSynced) return;
    const timer = setTimeout(() => setGraceElapsed(true), graceMs);
    return () => clearTimeout(timer);
  }, [isConnected, hasSynced, graceMs]);

  return isConnected && !hasSynced && graceElapsed;
}
