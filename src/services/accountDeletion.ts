import { Preferences } from '@capacitor/preferences';
import { closeLogDatabase } from './logStorage';

/**
 * Hosted guide explaining how funds are tied to the passkey, how to
 * remove the passkey on each platform, and why the recovery phrase
 * must be saved first. Linked from the delete-account flow and the
 * logout confirm dialog.
 */
export const ACCOUNT_DELETION_GUIDE_URL = 'https://breez-glow.vercel.app/delete-account.html';

/**
 * Erase every client-side artifact of the account: localStorage,
 * Capacitor Preferences, and all IndexedDB databases (SDK storage,
 * encrypted log sessions). Callers must disconnect the SDK first so
 * its database connections are closed; a still-open connection turns
 * that database's delete into a deferred no-op (see deleteDatabase).
 * Best-effort per store: never throws.
 */
export async function wipeAllLocalData(): Promise<void> {
  try { localStorage.clear(); } catch { /* best-effort */ }
  try { sessionStorage.clear(); } catch { /* best-effort */ }
  try { await Preferences.clear(); } catch { /* best-effort */ }
  closeLogDatabase();
  try {
    const dbs = typeof indexedDB !== 'undefined' && indexedDB.databases
      ? await indexedDB.databases()
      : [];
    await Promise.allSettled(
      dbs.flatMap((db) => (db.name ? [deleteDatabase(db.name)] : [])),
    );
  } catch { /* best-effort */ }
}

// Resolves on `blocked` too: an open connection elsewhere defers the
// actual delete until it closes, and waiting here would hang the flow.
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
