/**
 * Ephemeral in-memory session vault.
 *
 * Encrypts sensitive data (e.g. mnemonic) with a random, non-extractable
 * AES-GCM-256 key held only in JS memory. The plaintext is never retained.
 *
 * - Key is non-extractable: can't be read via DevTools or heap snapshots
 * - Ciphertext + IV live in module scope, cleared on logout or page unload
 * - No data is persisted to disk — this is purely in-memory protection
 */

const IV_BYTES = 12;

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
