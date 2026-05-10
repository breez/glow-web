/**
 * Password-encrypted seed vault.
 *
 * PBKDF2 (600k iters, SHA-256) derives an AES-GCM-256 key from the
 * user's password; the mnemonic is encrypted under that key and the
 * ciphertext is persisted in IndexedDB. Wrong password is detected
 * via the AES-GCM authentication tag.
 */

const DB_NAME = 'glow-vault';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const RECORD_ID = 'primary';

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'SHA-256';
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type VaultErrorCode = 'wrong_password' | 'no_vault' | 'storage_unavailable' | 'crypto_error';

export class VaultError extends Error {
  constructor(public code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

interface VaultRecord {
  id: typeof RECORD_ID;
  version: 1;
  tier: 'password';
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  pbkdf2Salt: Uint8Array;
}

/**
 * Encryption material handed off between flow steps. CryptoKey is
 * non-extractable, so passing this around in component state is
 * preferable to passing the plaintext password.
 */
export interface VaultKeyMaterial {
  key: CryptoKey;
  salt: Uint8Array;
}

// --- Storage availability ---

/** True if IndexedDB and the Web Crypto subtle API are available. */
export function isVaultStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto?.subtle !== 'undefined';
}

function requireStorage(): void {
  if (!isVaultStorageAvailable()) {
    throw new VaultError('storage_unavailable', 'IndexedDB or Web Crypto is not available');
  }
}

// --- IndexedDB ---

let db: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      db = req.result;
      db.onclose = () => { db = null; };
      resolve(db);
    };
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

async function readRecord(): Promise<VaultRecord | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(RECORD_ID);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result ?? null);
  });
}

/**
 * Run a write op inside a single transaction, resolving on
 * `tx.oncomplete` so the caller doesn't see "success" until the data
 * is durable.
 */
async function withWriteTx(op: (store: IDBObjectStore) => void): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    op(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

// --- Crypto ---

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const baseKey = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as Uint8Array<ArrayBuffer>,
        iterations: PBKDF2_ITERATIONS,
        hash: PBKDF2_HASH,
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    passwordBytes.fill(0);
  }
}

// --- Public API ---

/** True if a vault exists in IndexedDB. Never throws. */
export async function hasVault(): Promise<boolean> {
  if (!isVaultStorageAvailable()) return false;
  try {
    return (await readRecord()) !== null;
  } catch {
    return false;
  }
}

/**
 * Derive a non-extractable AES-GCM key from a password. Lets callers
 * drop the plaintext password as soon as this resolves.
 */
export async function deriveVaultKey(password: string): Promise<VaultKeyMaterial> {
  requireStorage();
  if (!password) throw new VaultError('crypto_error', 'Password is required');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(password, salt);
  return { key, salt };
}

/**
 * Encrypt a mnemonic with already-derived material and persist.
 * Use this when the password and mnemonic are captured on different
 * screens, so the plaintext password never has to live in cross-screen state.
 */
export async function createVaultFromMaterial(
  mnemonic: string,
  material: VaultKeyMaterial,
): Promise<void> {
  requireStorage();
  if (await readRecord()) {
    throw new VaultError('crypto_error', 'Vault already exists. Delete the existing vault first.');
  }
  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const mnemonicBytes = new TextEncoder().encode(mnemonic);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
      material.key,
      mnemonicBytes,
    );
    // Best-effort scrub. JS strings stay reachable, the encoded bytes don't.
    mnemonicBytes.fill(0);

    const record: VaultRecord = {
      id: RECORD_ID,
      version: 1,
      tier: 'password',
      ciphertext,
      iv,
      pbkdf2Salt: material.salt,
    };
    await withWriteTx((store) => store.put(record));
  } catch (e) {
    throw new VaultError(
      'crypto_error',
      `Failed to create vault: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Derive material from a password and persist a fresh vault in one call. */
export async function createVault(mnemonic: string, password: string): Promise<void> {
  await createVaultFromMaterial(mnemonic, await deriveVaultKey(password));
}

/** Decrypt the persisted vault. Wrong password surfaces as `wrong_password`. */
export async function unlockVault(password: string): Promise<string> {
  requireStorage();
  if (!password) throw new VaultError('wrong_password', 'Wrong password');

  const record = await readRecord();
  if (!record) throw new VaultError('no_vault', 'No vault found');

  try {
    const key = await deriveKey(password, record.pbkdf2Salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer> },
      key,
      record.ciphertext,
    );
    const decryptedBytes = new Uint8Array(decrypted);
    const mnemonic = new TextDecoder().decode(decryptedBytes);
    decryptedBytes.fill(0);
    return mnemonic;
  } catch (e) {
    // AES-GCM tag failure on wrong password produces OperationError.
    if (e instanceof Error && e.name === 'OperationError') {
      throw new VaultError('wrong_password', 'Wrong password');
    }
    throw new VaultError(
      'crypto_error',
      `Failed to unlock vault: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Wipe the vault. Never throws. */
export async function deleteVault(): Promise<void> {
  if (!isVaultStorageAvailable()) return;
  try {
    await withWriteTx((store) => store.clear());
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Test-only: drop the cached connection so the next call reopens
 * fresh. Pairs with `indexedDB.deleteDatabase` between test cases.
 */
export function _resetForTesting(): void {
  db?.close();
  db = null;
}
