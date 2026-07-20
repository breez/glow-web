/**
 * Secure log storage service for persisting logs across sessions.
 *
 * Features:
 * - Encrypts logs using AES-GCM with a derived key
 * - Stores up to MAX_SESSIONS sessions in IndexedDB
 * - Single unified log stream per session
 * - Automatic cleanup of oldest sessions when limit reached
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

/**
 * Get or create encryption key
 * Key is stored in IndexedDB and persists across sessions
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  if (encryptionKey) return encryptionKey;

  const database = await openDatabase();

  // Try to load existing key
  const existingKey = await new Promise<CryptoKey | null>((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, 'readonly');
    const store = transaction.objectStore(KEY_STORE_NAME);
    const request = store.get('main');

    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      if (request.result?.key) {
        try {
          const imported = await crypto.subtle.importKey(
            'raw',
            request.result.key,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
          );
          resolve(imported);
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    };
  });

  if (existingKey) {
    encryptionKey = existingKey;
    return existingKey;
  }

  // Generate new key
  const newKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  // Export and store key
  const exportedKey = await crypto.subtle.exportKey('raw', newKey);

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(KEY_STORE_NAME);
    const request = store.put({ id: 'main', key: exportedKey });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

  encryptionKey = newKey;
  return newKey;
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
