import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { closeLogDatabase } from './logStorage';

/**
 * Hosted guide explaining how funds are tied to the passkey, how to
 * remove the passkey on each platform, and why the recovery phrase
 * must be saved first. Linked from the logout confirm dialog and the
 * post-deletion confirmation screen.
 */
export const ACCOUNT_DELETION_GUIDE_URL = 'https://breez-glow.vercel.app/delete-account.html';

/**
 * Erase every client-side artifact of the account: localStorage,
 * Capacitor Preferences, all IndexedDB databases (SDK storage,
 * encrypted log sessions), and exported log/db files in the native
 * cache. Callers must disconnect the SDK first so its database
 * connections are closed; a still-open connection turns that
 * database's delete into a deferred no-op (see deleteDatabase).
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
  await deleteExportedFiles();
}

// Log zips / db-state exports that logExport.ts wrote to the cache
// root for the share sheet. Native only: the web path never writes
// files.
async function deleteExportedFiles(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { files } = await Filesystem.readdir({ path: '', directory: Directory.Cache });
    await Promise.allSettled(
      files
        .filter((f) => f.name.endsWith('_glow_logs.zip') || f.name.endsWith('_sdk_state.json'))
        .map((f) => Filesystem.deleteFile({ path: f.name, directory: Directory.Cache })),
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
