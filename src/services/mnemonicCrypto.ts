/**
 * Mnemonic encryption/decryption using passkey PRF-derived AES-256-GCM key.
 *
 * Each encrypt/decrypt triggers one biometric auth via derivePrfSeed().
 * The key is deterministic for the same passkey + salt combination.
 */

import { passkeyPrfProvider } from './passkeyPrfProvider';
import { logger, LogCategory } from './logger';

const ENCRYPTION_SALT = 'glow-mnemonic-encryption';
const STORAGE_KEY = 'walletMnemonic';

interface EncryptedPayload {
  v: 1;
  iv: string;  // base64-encoded 12-byte IV
  ct: string;  // base64-encoded ciphertext
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function isPlaintext(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return !(typeof parsed === 'object' && parsed !== null && 'v' in parsed && 'ct' in parsed);
  } catch {
    return true; // Not valid JSON = plaintext mnemonic
  }
}

/**
 * Derive an AES-256-GCM CryptoKey from passkey PRF.
 * Triggers one biometric authentication.
 */
async function deriveEncryptionKey(): Promise<CryptoKey> {
  const rawKey = await passkeyPrfProvider.derivePrfSeed(ENCRYPTION_SALT);
  return crypto.subtle.importKey(
    'raw',
    rawKey.slice().buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt mnemonic and store in localStorage.
 * Triggers one biometric auth.
 */
export async function encryptAndSaveMnemonic(mnemonic: string): Promise<void> {
  logger.info(LogCategory.AUTH, 'Encrypting mnemonic for storage');
  const key = await deriveEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(mnemonic);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const payload: EncryptedPayload = {
    v: 1,
    iv: toBase64(iv.buffer),
    ct: toBase64(ciphertext),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  logger.info(LogCategory.AUTH, 'Mnemonic encrypted and saved');
}

/**
 * Decrypt mnemonic from localStorage.
 * Triggers one biometric auth (unless plaintext migration).
 * Returns null if no mnemonic stored.
 */
export async function decryptSavedMnemonic(): Promise<string | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  // Plaintext migration: return as-is, caller re-encrypts via connectWallet
  if (isPlaintext(raw)) {
    logger.info(LogCategory.AUTH, 'Detected plaintext mnemonic, returning for migration');
    return raw;
  }

  logger.info(LogCategory.AUTH, 'Decrypting saved mnemonic');
  const payload: EncryptedPayload = JSON.parse(raw);
  const key = await deriveEncryptionKey();
  const iv = fromBase64(payload.iv).slice().buffer as ArrayBuffer;
  const ct = fromBase64(payload.ct).slice().buffer as ArrayBuffer;
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  logger.info(LogCategory.AUTH, 'Mnemonic decrypted successfully');
  return new TextDecoder().decode(decrypted);
}

/** Check if a mnemonic exists in localStorage (sync, no biometric). */
export function hasSavedMnemonic(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/** Check if the stored mnemonic is plaintext (needs migration). */
export function needsMigration(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  return isPlaintext(raw);
}

/** Clear stored mnemonic. */
export function clearSavedMnemonic(): void {
  localStorage.removeItem(STORAGE_KEY);
}
