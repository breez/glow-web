/**
 * App-side store of known passkey credential IDs, backed by
 * `localStorage`. The SDK no longer tracks credentials, so the web
 * passkey path owns this bookkeeping: it backs `credentials().get()`,
 * the passkey-management list, and the Android dup-refusal heuristic.
 *
 * Storage shape: one `localStorage` key per RP, a JSON array of
 * base64-encoded credential IDs, under the
 * `breez.spark.passkey.knownCredentials.<rpId>` namespace.
 *
 * Browser only. Native (Capacitor) callers use the plugin's own
 * Keychain / Block Store store.
 */

const KEY_PREFIX = 'breez.spark.passkey.knownCredentials.';

function readEntries(rpId: string): string[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + rpId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeEntries(rpId: string, entries: string[]): void {
  if (entries.length === 0) {
    localStorage.removeItem(KEY_PREFIX + rpId);
    return;
  }
  localStorage.setItem(KEY_PREFIX + rpId, JSON.stringify(entries));
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export class LocalStorageCredentialRegistry {
  async read(rpId: string): Promise<Uint8Array[]> {
    return readEntries(rpId).map(base64ToBytes);
  }

  async add(rpId: string, credentialId: Uint8Array): Promise<void> {
    const b64 = bytesToBase64(credentialId);
    const current = readEntries(rpId);
    if (current.includes(b64)) return;
    writeEntries(rpId, [...current, b64]);
  }

  async remove(rpId: string, credentialId: Uint8Array): Promise<void> {
    const b64 = bytesToBase64(credentialId);
    writeEntries(
      rpId,
      readEntries(rpId).filter((entry) => entry !== b64),
    );
  }

  async clear(rpId: string): Promise<void> {
    localStorage.removeItem(KEY_PREFIX + rpId);
  }
}
