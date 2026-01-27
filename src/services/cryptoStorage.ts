const DB_NAME = 'glow-crypto-store';
const DB_VERSION = 1;
const STORE_NAME = 'keys';
const KEY_ID = 'device-key';
const STORAGE_KEY = 'walletMnemonic';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  const db = await openDB();

  // Try to load existing key
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error);
  });

  if (existing) {
    db.close();
    return existing;
  }

  // Generate new non-exportable key
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-exportable
    ['encrypt', 'decrypt'],
  );

  // Store it
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).put(key, KEY_ID);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  db.close();
  return key;
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

interface EncryptedPayload {
  iv: string;
  ciphertext: string;
}

function isEncryptedPayload(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && 'iv' in parsed && 'ciphertext' in parsed;
  } catch {
    return false;
  }
}

export async function saveEncryptedMnemonic(mnemonic: string): Promise<void> {
  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(mnemonic);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const payload: EncryptedPayload = {
    iv: toBase64(iv.buffer),
    ciphertext: toBase64(ciphertext),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export async function getDecryptedMnemonic(): Promise<string | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  // Migration: if it's plain text (legacy), encrypt it in place and return
  if (!isEncryptedPayload(raw)) {
    await saveEncryptedMnemonic(raw);
    return raw;
  }

  const key = await getOrCreateDeviceKey();
  const payload: EncryptedPayload = JSON.parse(raw);
  const iv = new Uint8Array(fromBase64(payload.iv));
  const ciphertext = fromBase64(payload.ciphertext);

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export function clearEncryptedMnemonic(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function resetDeviceKey(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(KEY_ID);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  db.close();
}
