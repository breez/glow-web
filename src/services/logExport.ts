import { logger, LogCategory } from './logger';
import { getAllSessions, isStorageAvailable } from './logStorage';
import JSZip from 'jszip';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

const getAllLogs = (): string => {
  return logger.getLogsAsString();
};

export const getAllLogsAsZip = async (): Promise<Blob> => {
  const zip = new JSZip();
  const now = new Date();
  const nowTimestamp = Math.floor(now.getTime() / 1000);

  const currentSessionHeader = [
    `Glow Wallet Log Export`,
    `Session: Current`,
    `Generated: ${now.toISOString()}`,
    '='.repeat(60),
    '',
  ].join('\n');
  zip.file(`${nowTimestamp}_glow_current.txt`, currentSessionHeader + '\n' + getAllLogs());

  if (isStorageAvailable()) {
    try {
      const sessions = await getAllSessions();
      for (const session of sessions) {
        const sessionTimestamp = Math.floor(new Date(session.startedAt).getTime() / 1000);
        const filename = `${sessionTimestamp}_glow_session.txt`;
        const sessionHeader = [
          `Glow Wallet Log Export`,
          `Session ID: ${session.id}`,
          `Started: ${session.startedAt}`,
          session.endedAt ? `Ended: ${session.endedAt}` : 'Status: Active',
          '='.repeat(60),
          '',
        ].join('\n');
        zip.file(filename, sessionHeader + '\n' + (session.logs || '(no logs)'));
      }
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to retrieve historical log sessions', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
};

const STORAGE_DIR = 'spark-wallet-example';

const dumpIndexedDBStore = (
  db: IDBDatabase,
  storeName: string,
): Promise<unknown[]> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const buildSdkDatabaseName = async (identityPubkey: string, network: string): Promise<string> => {
  const pubkeyBytes = new Uint8Array(identityPubkey.length / 2);
  for (let i = 0; i < pubkeyBytes.length; i++) {
    pubkeyBytes[i] = parseInt(identityPubkey.substring(i * 2, i * 2 + 2), 16);
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', pubkeyBytes);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${STORAGE_DIR}/${network}/${hashHex.substring(0, 8)}`;
};

const openExistingDatabase = (name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => {
      req.transaction!.abort();
      reject(new Error('Database does not exist'));
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const exportDatabaseState = async (identityPubkey: string, network: string): Promise<void> => {
  const dbName = await buildSdkDatabaseName(identityPubkey, network);
  let db: IDBDatabase;
  try {
    db = await openExistingDatabase(dbName);
  } catch {
    logger.error(LogCategory.SDK, 'SDK database not found for export', { dbName });
    throw new Error(`SDK database '${dbName}' does not exist`);
  }

  try {
    const objectStores: Record<string, unknown[]> = {};
    for (const name of db.objectStoreNames) {
      objectStores[name] = await dumpIndexedDBStore(db, name);
    }

    const json = JSON.stringify({
      database: dbName,
      version: db.version,
      generatedAt: new Date().toISOString(),
      objectStores,
    }, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const timestamp = Math.floor(Date.now() / 1000);
    const filename = `${timestamp}_sdk_state.json`;

    if (canShareFiles()) {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Glow SDK Database Export' });
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
        }
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  } finally {
    db.close();
  }
};

export const canShareFiles = (): boolean => {
  return typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function';
};

// Convert a Blob to a base64 string (without the data URL prefix).
// @capacitor/filesystem writeFile takes base64 for binary payloads.
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

// Write the zip to the app cache directory and hand its URI to the
// native system share sheet. Used on iOS + Android via Capacitor.
const shareFileNative = async (blob: Blob, filename: string): Promise<void> => {
  const base64 = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });
  await Share.share({
    title: 'Glow Wallet Logs',
    url: uri,
    dialogTitle: 'Share logs',
  });
};

export const shareOrDownloadLogs = async (): Promise<void> => {
  const blob = await getAllLogsAsZip();
  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `${timestamp}_glow_logs.zip`;

  // Native platforms (iOS + Android): write to cache and open the system
  // share sheet via @capacitor/share. This is the preferred path because
  // Android WebView's navigator.share({ files }) is unreliable, and the
  // iOS WKWebView support varies by version — one consistent code path
  // is easier to reason about than two.
  if (Capacitor.isNativePlatform()) {
    try {
      await shareFileNative(blob, filename);
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      logger.warn(LogCategory.UI, 'Native log share failed, falling back to browser path', {
        error: e instanceof Error ? e.message : String(e),
      });
      // Fall through to the browser-style navigator.share / download path.
    }
  }

  if (canShareFiles()) {
    const file = new File([blob], filename, { type: 'application/zip' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Glow Wallet Logs' });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        // Share failed (e.g., desktop browser) — fall through to download
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Delay cleanup to let browser start the download
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
};
