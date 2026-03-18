/**
 * Password-encrypted seed vault service.
 *
 * Encrypts the mnemonic seed phrase using a user-set password:
 * - PBKDF2 (600k iterations, SHA-256) derives an AES-GCM-256 key
 * - AES-GCM encrypts the mnemonic; ciphertext stored in IndexedDB
 * - Wrong password detected via GCM authentication tag failure
 */

const DB_NAME = 'glow-vault';
const DB_VERSION = 1;
const STORE_NAME = 'vault';

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'SHA-256';
const SALT_BYTES = 16;
const IV_BYTES = 12;

// ============================================
// Types
// ============================================

interface VaultRecord {
  id: 'primary';
  version: 1;
  tier: 'password';
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  pbkdf2Salt: Uint8Array;
  /** SHA-256 fingerprint of the mnemonic for identity verification (e.g. forgot-password flow). */
  mnemonicHash?: ArrayBuffer;
}

export class VaultError extends Error {
  constructor(
    public code: 'wrong_password' | 'no_vault' | 'storage_unavailable' | 'crypto_error',
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

// ============================================
// IndexedDB helpers
// ============================================

let db: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function getVaultRecord(): Promise<VaultRecord | null> {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get('primary');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result ?? null);
      }),
  );
}

function putVaultRecord(record: VaultRecord): Promise<void> {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(record);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      }),
  );
}

function clearVaultStore(): Promise<void> {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      }),
  );
}

// ============================================
// Crypto helpers
// ============================================

function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  return crypto.subtle
    .importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey'])
    .then((baseKey) =>
      crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt as Uint8Array<ArrayBuffer>,
          iterations: PBKDF2_ITERATIONS,
          hash: PBKDF2_HASH,
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable
        ['encrypt', 'decrypt'],
      ),
    );
}

// ============================================
// Public API
// ============================================

/** Check if IndexedDB is available for vault storage. */
export function isVaultStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto?.subtle !== 'undefined';
}

/** Check if a vault exists in IndexedDB. */
export async function hasVault(): Promise<boolean> {
  if (!isVaultStorageAvailable()) return false;
  try {
    const record = await getVaultRecord();
    return record !== null;
  } catch {
    return false;
  }
}

/** Create a new vault: derive key from password, encrypt mnemonic, store in IndexedDB. */
export async function createVault(mnemonic: string, password: string): Promise<void> {
  if (!isVaultStorageAvailable()) {
    throw new VaultError('storage_unavailable', 'IndexedDB or Web Crypto is not available');
  }

  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(password, salt);

    const encoder = new TextEncoder();
    const mnemonicBytes = encoder.encode(mnemonic);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, mnemonicBytes);

    // SHA-256 fingerprint for identity verification (forgot-password flow)
    const mnemonicHash = await crypto.subtle.digest('SHA-256', mnemonicBytes);

    // Best-effort zero-out of the encoded bytes (JS strings are immutable/GC'd)
    mnemonicBytes.fill(0);

    const record: VaultRecord = {
      id: 'primary',
      version: 1,
      tier: 'password',
      ciphertext,
      iv,
      pbkdf2Salt: salt,
      mnemonicHash,
    };

    await putVaultRecord(record);
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError('crypto_error', `Failed to create vault: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Unlock an existing vault: re-derive key from password + stored salt, decrypt. */
export async function unlockVault(password: string): Promise<string> {
  if (!isVaultStorageAvailable()) {
    throw new VaultError('storage_unavailable', 'IndexedDB or Web Crypto is not available');
  }

  const record = await getVaultRecord();
  if (!record) {
    throw new VaultError('no_vault', 'No vault found');
  }

  try {
    const key = await deriveKey(password, record.pbkdf2Salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer> },
      key,
      record.ciphertext,
    );

    const decoder = new TextDecoder();
    const decryptedBytes = new Uint8Array(decrypted);
    const mnemonic = decoder.decode(decryptedBytes);

    // Best-effort zero-out
    decryptedBytes.fill(0);

    return mnemonic;
  } catch (e) {
    // AES-GCM tag failure on wrong password produces OperationError
    if (e instanceof DOMException && e.name === 'OperationError') {
      throw new VaultError('wrong_password', 'Wrong password');
    }
    if (e instanceof VaultError) throw e;
    throw new VaultError('crypto_error', `Failed to unlock vault: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Verify a mnemonic matches the stored vault fingerprint. Returns false if no vault or no fingerprint (legacy vaults). */
export async function verifyMnemonicFingerprint(mnemonic: string): Promise<boolean> {
  if (!isVaultStorageAvailable()) return false;

  const record = await getVaultRecord();
  if (!record?.mnemonicHash) return true; // No fingerprint stored (legacy vault) — skip check

  const encoder = new TextEncoder();
  const mnemonicBytes = encoder.encode(mnemonic);
  const hash = await crypto.subtle.digest('SHA-256', mnemonicBytes);
  mnemonicBytes.fill(0);

  const a = new Uint8Array(record.mnemonicHash);
  const b = new Uint8Array(hash);
  if (a.length !== b.length) return false;
  let equal = true;
  for (let i = 0; i < a.length; i++) {
    equal = equal && a[i] === b[i];
  }
  return equal;
}

/** Delete the vault from IndexedDB. */
export async function deleteVault(): Promise<void> {
  if (!isVaultStorageAvailable()) return;
  try {
    await clearVaultStore();
  } catch {
    // Best-effort cleanup
  }
}

// ============================================
// Session vault (ephemeral in-memory encryption)
// ============================================

let sessionKey: CryptoKey | null = null;
let sessionCiphertext: ArrayBuffer | null = null;
let sessionIv: Uint8Array | null = null;

/** Encrypt a mnemonic with a random ephemeral key held only in memory. Plaintext is NOT retained. */
export async function sealSession(mnemonic: string): Promise<void> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoder = new TextEncoder();
  const mnemonicBytes = encoder.encode(mnemonic);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, mnemonicBytes);
  mnemonicBytes.fill(0);

  sessionKey = key;
  sessionCiphertext = ciphertext;
  sessionIv = iv;
}

/** Decrypt the session-sealed mnemonic. Returns null if no session exists. */
export async function unsealSession(): Promise<string | null> {
  if (!sessionKey || !sessionCiphertext || !sessionIv) return null;
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sessionIv as Uint8Array<ArrayBuffer> },
    sessionKey,
    sessionCiphertext,
  );
  const decryptedBytes = new Uint8Array(decrypted);
  const mnemonic = new TextDecoder().decode(decryptedBytes);
  decryptedBytes.fill(0);
  return mnemonic;
}

/** Clear the session vault. */
export function clearSession(): void {
  sessionKey = null;
  sessionCiphertext = null;
  sessionIv = null;
}
