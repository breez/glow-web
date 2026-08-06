/**
 * Log storage for persisting logs across sessions: up to MAX_SESSIONS
 * sessions in IndexedDB, one unified stream each, oldest pruned first.
 *
 * Logs are AES-GCM encrypted, but the key lives in the same database, so
 * this only protects against a raw read of the storage files. Anything
 * running in the origin decrypts at will: treat the store as readable by
 * the device, and keep secrets out of the logs (see logger's scrubber).
 */

const DB_NAME = 'glow-logs';
const DB_VERSION = 2; // Bumped version for schema change
const STORE_NAME = 'sessions';
const KEY_STORE_NAME = 'encryption';
const MAX_SESSIONS = 10;

export interface LogSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  logs: string;
}

interface EncryptedLogSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  encryptedLogs: ArrayBuffer;
  iv: ArrayBuffer;
}

let db: IDBDatabase | null = null;
let encryptionKey: CryptoKey | null = null;
let currentSessionId: string | null = null;

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Open IndexedDB database
 */
async function openDatabase(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Delete old store if exists (schema changed)
      if (database.objectStoreNames.contains(STORE_NAME)) {
        database.deleteObjectStore(STORE_NAME);
      }

      // Create sessions store
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('startedAt', 'startedAt', { unique: false });

      // Create encryption key store if not exists
      if (!database.objectStoreNames.contains(KEY_STORE_NAME)) {
        database.createObjectStore(KEY_STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function storeEncryptionKey(database: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(KEY_STORE_NAME);
    const request = store.put({ id: 'main', key });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Get or create the encryption key, persisted across sessions.
 *
 * The key is non-extractable and stored as a `CryptoKey`: raw bytes in
 * the record would hand a storage dump the ciphertext and the key to
 * open it in one file.
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  if (encryptionKey) return encryptionKey;

  const database = await openDatabase();

  const stored = await new Promise<unknown>((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, 'readonly');
    const store = transaction.objectStore(KEY_STORE_NAME);
    const request = store.get('main');

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.key ?? null);
  });

  if (stored instanceof CryptoKey) {
    encryptionKey = stored;
    return stored;
  }

  // Records written before the key was non-extractable hold raw bytes.
  // Import them (so existing sessions still decrypt) and overwrite the
  // record with the CryptoKey, which drops the bytes from storage.
  const migrated = stored
    ? await crypto.subtle
        .importKey('raw', stored as BufferSource, { name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ])
        .catch(() => null)
    : null;

  const key =
    migrated ??
    (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]));

  await storeEncryptionKey(database, key);

  encryptionKey = key;
  return key;
}

/**
 * Encrypt text using AES-GCM
 */
async function encrypt(text: string, iv: Uint8Array): Promise<ArrayBuffer> {
  const key = await getEncryptionKey();
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, data);
}

/**
 * Decrypt data using AES-GCM
 */
async function decrypt(data: ArrayBuffer, iv: ArrayBuffer): Promise<string> {
  const key = await getEncryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    data
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Get all session IDs sorted by date (oldest first)
 */
async function getSessionIds(): Promise<string[]> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('startedAt');
    const request = index.getAllKeys();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      // Keys from index query may not be in order, so we need to fetch and sort
      const allRequest = store.getAll();
      allRequest.onerror = () => reject(allRequest.error);
      allRequest.onsuccess = () => {
        const sessions = allRequest.result as EncryptedLogSession[];
        sessions.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
        resolve(sessions.map((s) => s.id));
      };
    };
  });
}

/**
 * Delete oldest sessions to maintain MAX_SESSIONS limit
 */
async function pruneOldSessions(): Promise<void> {
  const sessionIds = await getSessionIds();

  if (sessionIds.length < MAX_SESSIONS) return;

  const database = await openDatabase();
  const toDelete = sessionIds.slice(0, sessionIds.length - MAX_SESSIONS + 1);

  await Promise.all(
    toDelete.map(
      (id) =>
        new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          const request = store.delete(id);

          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        })
    )
  );
}

/**
 * Start a new logging session
 */
export async function startSession(): Promise<string> {
  await pruneOldSessions();

  currentSessionId = generateSessionId();
  const database = await openDatabase();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const session: EncryptedLogSession = {
    id: currentSessionId,
    startedAt: new Date().toISOString(),
    encryptedLogs: await encrypt('', iv),
    iv: iv.buffer,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(session);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

  return currentSessionId;
}

/**
 * Get current session ID, starting a new session if needed
 */
export async function getCurrentSessionId(): Promise<string> {
  if (!currentSessionId) {
    return startSession();
  }
  return currentSessionId;
}

/**
 * Save logs for current session (unified log stream)
 */
export async function saveSessionLogs(logs: string): Promise<void> {
  const sessionId = await getCurrentSessionId();
  const database = await openDatabase();

  // Get existing session to retrieve IV
  const existing = await new Promise<EncryptedLogSession | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(sessionId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });

  const iv = existing ? new Uint8Array(existing.iv) : crypto.getRandomValues(new Uint8Array(12));

  const session: EncryptedLogSession = {
    id: sessionId,
    startedAt: existing?.startedAt || new Date().toISOString(),
    encryptedLogs: await encrypt(logs, iv),
    iv: iv.buffer,
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(session);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * End current session
 */
export async function endSession(): Promise<void> {
  if (!currentSessionId) return;

  const sessionId = currentSessionId;
  const database = await openDatabase();

  const existing = await new Promise<EncryptedLogSession | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(sessionId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });

  if (existing) {
    existing.endedAt = new Date().toISOString();

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(existing);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  currentSessionId = null;
}

/**
 * Get all sessions decrypted
 */
export async function getAllSessions(): Promise<LogSession[]> {
  const database = await openDatabase();

  const encryptedSessions = await new Promise<EncryptedLogSession[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  // Sort by startedAt (oldest first)
  encryptedSessions.sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );

  const sessions: LogSession[] = [];

  for (const encrypted of encryptedSessions) {
    try {
      const logs = await decrypt(encrypted.encryptedLogs, encrypted.iv);

      sessions.push({
        id: encrypted.id,
        startedAt: encrypted.startedAt,
        endedAt: encrypted.endedAt,
        logs,
      });
    } catch {
      // Skip sessions that can't be decrypted (key may have changed)
      console.warn(`Failed to decrypt session ${encrypted.id}`);
    }
  }

  return sessions;
}

/**
 * Clear all stored sessions
 */
export async function clearAllSessions(): Promise<void> {
  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

  currentSessionId = null;
}

/**
 * Check if IndexedDB is available
 */
export function isStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Close the module-held database handle so account deletion can
 * delete the database without hitting a `blocked` event. Later log
 * calls reopen it transparently via openDatabase().
 */
export function closeLogDatabase(): void {
  db?.close();
  db = null;
  currentSessionId = null;
}
