import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { LogCategory, logger } from '@/services/logger';
import type { UnilateralExitPlan } from './driver';

export type ExitStateExporter = Pick<BreezSdk, 'exportUnilateralExitState'>;
export type ExitStateImporter = Pick<BreezSdk, 'importUnilateralExitState'>;

/**
 * The exit state an exit runs against: the copy frozen when it was built, or
 * the rolling backup before one exists. A finished exit's copy describes leaves
 * since spent, so restoring it would quote money that has already arrived.
 */
export function exitStateForExit(
  plan: UnilateralExitPlan | null,
  rolling: string | null,
): string | null {
  if (plan?.phase === 'complete') return null;
  return plan?.exitStateSnapshot ?? rolling ?? null;
}

/**
 * Refreshes the rolling backup, except while an exit is under way: the
 * operators stop reporting the leaves it moves, so a fresh export would drop
 * exactly what it still needs.
 */
export async function captureExitState(
  sdk: ExitStateExporter,
  plan: UnilateralExitPlan | null,
  save: (exitState: string) => Promise<void>,
): Promise<void> {
  if (plan && plan.phase !== 'complete') return;
  try {
    const { exitState } = await sdk.exportUnilateralExitState();
    await save(exitState);
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to back up unilateral exit state', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * A listener that takes a fresh backup when an exit lands. A finished exit
 * leaves a backup describing leaves it has since spent, and the engine marks
 * the landing by archiving the exit and releasing its plan. The first state it
 * sees is only a baseline, so loading an existing archive does not count.
 */
export function backUpWhenExitLands(
  sdk: ExitStateExporter,
  save: (exitState: string) => Promise<void>,
): (state: { plan: UnilateralExitPlan | null; archive: readonly unknown[] }) => void {
  let archived: number | null = null;
  return ({ plan, archive }) => {
    const landed = archived !== null && archive.length > archived;
    archived = archive.length;
    if (landed) void captureExitState(sdk, plan, save);
  };
}

/** Importing only adds data the wallet lacks, so a failure is not a reason to stop. */
export async function restoreExitState(
  sdk: ExitStateImporter,
  plan: UnilateralExitPlan | null,
  rolling: string | null,
): Promise<void> {
  const exitState = exitStateForExit(plan, rolling);
  if (!exitState) return;
  try {
    await sdk.importUnilateralExitState({ exitState });
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to restore unilateral exit state', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * The rolling backup lives in IndexedDB: it runs to megabytes, past what
 * localStorage allows. Encrypted at rest with a key held in the same database,
 * which keeps it off the disk in the clear but readable by anything in this
 * origin. It discloses the wallet's balance and history.
 */
const DB_NAME = 'glow-exit-state';
const DB_VERSION = 2;
const STATE_STORE = 'exitState';
const KEY_STORE = 'encryption';
const KEY_ID = 'aes-key';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readRecord = <T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });

const writeRecord = (db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

async function encryptionKey(db: IDBDatabase): Promise<CryptoKey> {
  const stored = await readRecord<CryptoKey>(db, KEY_STORE, KEY_ID);
  if (stored) return stored;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await writeRecord(db, KEY_STORE, KEY_ID, key);
  return key;
}

export async function saveExitState(walletId: string, exitState: string): Promise<void> {
  const db = await openDb();
  try {
    const key = await encryptionKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(exitState),
    );
    await writeRecord(db, STATE_STORE, walletId, { iv, ciphertext, savedAt: Date.now() });
  } finally {
    db.close();
  }
}

export async function loadExitState(walletId: string): Promise<string | null> {
  const db = await openDb();
  try {
    const record = await readRecord<{ iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer }>(
      db,
      STATE_STORE,
      walletId,
    );
    if (!record) return null;
    const key = await encryptionKey(db);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      key,
      record.ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to read the exit state backup', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  } finally {
    db.close();
  }
}
