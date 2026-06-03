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

function key(rpId: string): string {
  return KEY_PREFIX + rpId;
}

function readEntries(rpId: string): string[] {
  try {
    const raw = localStorage.getItem(key(rpId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Fast path: skip the filter allocation when the data is already
    // well-formed (the common case, since we only ever write strings).
    return parsed.every((x) => typeof x === 'string')
      ? (parsed as string[])
      : parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function writeEntries(rpId: string, entries: string[]): void {
  if (entries.length === 0) {
    localStorage.removeItem(key(rpId));
    return;
  }
  localStorage.setItem(key(rpId), JSON.stringify(entries));
}

// Loop-based on purpose: credential IDs are tiny (≤~64 bytes), so the
// concat cost is negligible and this avoids the call-stack arg limit of
// `String.fromCharCode(...bytes)` for any future larger input.
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
    const entries = readEntries(rpId);
    if (entries.includes(b64)) return;
    entries.push(b64);
    writeEntries(rpId, entries);
  }

  async remove(rpId: string, credentialId: Uint8Array): Promise<void> {
    const b64 = bytesToBase64(credentialId);
    const entries = readEntries(rpId);
    const index = entries.indexOf(b64);
    // Skip the write (and the cross-tab `storage` event it fires) when
    // the credential wasn't tracked.
    if (index === -1) return;
    entries.splice(index, 1);
    writeEntries(rpId, entries);
  }

  async clear(rpId: string): Promise<void> {
    localStorage.removeItem(key(rpId));
  }
}
