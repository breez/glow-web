/**
 * Passkey service: thin wrapper over the SDK's Passkey class.
 *
 * The SDK instance is held in a module-level singleton so its
 * `nostr_keys` OnceCell survives across calls and follow-up Nostr
 * operations don't re-prompt. Invalidate via `invalidatePasskey()`
 * whenever the underlying credential or relay config changes.
 */

import { Passkey, Wallet, NostrRelayConfig } from '@breeztech/breez-sdk-spark';
import { passkeyPrfProvider } from './passkeyPrfProvider';
import { logger, LogCategory } from './logger';

// Storage key: presence signals passkey mode
const PASSKEY_LABEL_KEY = 'passkeyLabel';
// Persistent flag, survives logout/cancel: remembers this device has used a passkey
const PASSKEY_REGISTERED_KEY = 'passkeyRegistered';
// JSON-encoded array of base64-encoded credential IDs for every passkey
// this device has registered against this RP. Passed verbatim as
// `excludeCredentialIds` on subsequent createPasskey calls so the
// platform refuses to register a duplicate even if PASSKEY_REGISTERED
// was wiped (defense-in-depth: protects against localStorage clears).
const KNOWN_CREDENTIALS_KEY = 'passkeyKnownCredentials';
// Per-credential AAGUID (base64) recorded at create time. Drives the
// provider name + icon on the passkey management page. Captured only
// at create: WebAuthn doesn't expose AAGUID on assertion.
const PASSKEY_AAGUID_PREFIX = 'passkeyAaguid:';
// Per-device timestamps. WebAuthn doesn't expose creation / last-use
// dates, so we record them locally on each successful PRF ceremony.
const PASSKEY_FIRST_SEEN_KEY = 'passkeyFirstSeenAt';
const PASSKEY_LAST_SEEN_KEY = 'passkeyLastSeenAt';
// Per-label last-used timestamps. Recorded each time a label is loaded
// into the active wallet (initial connect or switchPasskeyLabel) so the
// Labels page can surface a relative "last used" hint per row.
const PASSKEY_LABEL_LAST_USED_PREFIX = 'passkeyLabelLastUsed:';

let cachedPasskey: Passkey | null = null;

function getPasskey(): Passkey {
  if (cachedPasskey !== null) return cachedPasskey;
  const breezApiKey = import.meta.env.VITE_BREEZ_API_KEY;
  const relayConfig: NostrRelayConfig | undefined = breezApiKey
    ? { breezApiKey }
    : undefined;
  cachedPasskey = new Passkey(passkeyPrfProvider, relayConfig ?? null);
  return cachedPasskey;
}

function invalidatePasskey(): void {
  cachedPasskey = null;
}

/**
 * Create a new passkey with PRF support.
 * Only registers the credential, no seed derivation.
 * Triggers exactly 1 WebAuthn prompt.
 *
 * The native plugin reads its own iCloud-synced keychain entry for
 * excludeCredentialIds and merges it with any IDs we pass from
 * localStorage. This means: even if the app was uninstalled (wiping
 * localStorage), the plugin's keychain entry survives via iCloud
 * Keychain and the platform will refuse a duplicate registration.
 *
 * @throws PasskeyAlreadyExistsError if the platform refuses because a
 *         credential is already registered for this RP.
 */
export async function createPasskey(): Promise<void> {
  logger.info(LogCategory.AUTH, 'Creating new passkey');
  // Pass the localStorage-tracked IDs as a legacy fallback: the plugin
  // merges them with its own keychain. Browser path uses these as the
  // sole source.
  const excludeCredentialIds = getKnownCredentialIdsLocal();
  const { credentialId, aaguid } = await passkeyPrfProvider.createPasskey({ excludeCredentialIds });
  if (credentialId) {
    addKnownCredentialIdLocal(credentialId);
    if (aaguid) {
      localStorage.setItem(`${PASSKEY_AAGUID_PREFIX}${credentialId}`, aaguid);
    }
  }
  localStorage.setItem(PASSKEY_REGISTERED_KEY, '1');
  markPasskeyUsed();
  logger.info(LogCategory.AUTH, 'Passkey created successfully');
}

/** Returns undefined for credentials predating AAGUID capture or native credentials (plugin doesn't surface it yet). */
export function getCredentialAaguid(credentialId: string): string | undefined {
  return localStorage.getItem(`${PASSKEY_AAGUID_PREFIX}${credentialId}`) ?? undefined;
}

export function getAllCredentialAaguids(): string[] {
  const out: string[] = [];
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PASSKEY_AAGUID_PREFIX)) {
      const v = localStorage.getItem(key);
      if (v) out.push(v);
    }
  }
  return out;
}

/**
 * Stamp first-seen (set once) and last-seen (always) for the passkey.
 * Call after any successful PRF ceremony.
 */
export function markPasskeyUsed(): void {
  const now = String(Date.now());
  if (!localStorage.getItem(PASSKEY_FIRST_SEEN_KEY)) {
    localStorage.setItem(PASSKEY_FIRST_SEEN_KEY, now);
  }
  localStorage.setItem(PASSKEY_LAST_SEEN_KEY, now);
}

export function getPasskeyMeta(): { firstSeenAt?: number; lastSeenAt?: number } {
  const first = localStorage.getItem(PASSKEY_FIRST_SEEN_KEY);
  const last = localStorage.getItem(PASSKEY_LAST_SEEN_KEY);
  return {
    firstSeenAt: first ? Number(first) : undefined,
    lastSeenAt: last ? Number(last) : undefined,
  };
}

/**
 * Stamp last-used for a specific label. Called from the wallet hook
 * whenever a label is brought online (initial connect or switch), so
 * the Labels page can render a "last used" hint per row.
 */
export function markLabelUsed(label: string): void {
  localStorage.setItem(`${PASSKEY_LABEL_LAST_USED_PREFIX}${label}`, String(Date.now()));
}

/**
 * Read the last-used timestamp for a label. Returns undefined when the
 * label has never been activated on this device.
 */
export function getLabelLastUsed(label: string): number | undefined {
  const raw = localStorage.getItem(`${PASSKEY_LABEL_LAST_USED_PREFIX}${label}`);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Wipe every per-label last-used entry. Used by the wipe / forget
 * surfaces in PasskeyLocalStatePage and by the deletion-recovery flow
 * when the passkey itself is being torn down.
 */
export function clearAllLabelLastUsed(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PASSKEY_LABEL_LAST_USED_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

/** Drop every per-credential AAGUID entry. */
export function clearAllCredentialAaguids(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PASSKEY_AAGUID_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

/**
 * Read the localStorage-backed list of base64 credential IDs.
 *
 * Browser-only fallback. On native, the canonical source is the
 * plugin's iCloud-synced keychain (queried via
 * `passkeyPrfProvider.getKnownCredentialIds()`); the localStorage
 * copy is kept in sync as a legacy escape hatch but loses parity if
 * the app is uninstalled or if a sibling iOS device registered the
 * passkey first.
 */
function getKnownCredentialIdsLocal(): string[] {
  try {
    const raw = localStorage.getItem(KNOWN_CREDENTIALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function addKnownCredentialIdLocal(credentialId: string): void {
  const existing = getKnownCredentialIdsLocal();
  if (existing.includes(credentialId)) return;
  localStorage.setItem(
    KNOWN_CREDENTIALS_KEY,
    JSON.stringify([...existing, credentialId]),
  );
}

/**
 * Called by the deletion-recovery flow when sign-in returns
 * `CREDENTIAL_NOT_FOUND` on a device that has previously registered:
 * the user has manually deleted the passkey from Settings → Passwords,
 * so all our local memory of it is stale. Wipes:
 *   - the plugin's iCloud-synced keychain entry (other devices will
 *     still have their own copy syncing back, which is fine: any
 *     surviving credential will be re-discovered there).
 *   - the localStorage flag and known-IDs list.
 * After this runs, the home screen's CTA gating reverts to first-time
 * user state, allowing a fresh create flow.
 */
export async function clearPasskeyHistory(): Promise<void> {
  logger.warn(LogCategory.AUTH, 'Clearing passkey history (deletion detected)');
  try {
    await passkeyPrfProvider.clearKnownCredentialIds();
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'Failed to clear plugin keychain', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  localStorage.removeItem(PASSKEY_REGISTERED_KEY);
  localStorage.removeItem(KNOWN_CREDENTIALS_KEY);
  localStorage.removeItem(PASSKEY_FIRST_SEEN_KEY);
  localStorage.removeItem(PASSKEY_LAST_SEEN_KEY);
  clearAllLabelLastUsed();
  clearAllCredentialAaguids();
  invalidatePasskey();
}

/**
 * Check if PRF (passkey) authentication is available on this device.
 */
export async function isPrfAvailable(): Promise<boolean> {
  // Firefox's PRF support is still unreliable — disable until stable
  const ua = navigator.userAgent;
  if (/Firefox\//i.test(ua) && !/Seamonkey\//i.test(ua)) {
    return false;
  }

  const passkey = getPasskey();
  return await passkey.isAvailable();
}

/**
 * Check if the app is in passkey mode.
 * Passkey mode is signalled by a stored label.
 */
export function isPasskeyMode(): boolean {
  return localStorage.getItem(PASSKEY_LABEL_KEY) !== null;
}

/**
 * Set passkey mode by storing the label.
 * Also marks this device as having used a passkey (persistent hint).
 */
export function setPasskeyMode(label?: string): void {
  localStorage.setItem(PASSKEY_LABEL_KEY, label ?? 'Default');
  localStorage.setItem(PASSKEY_REGISTERED_KEY, '1');
}

/**
 * Clear passkey mode. Does NOT clear the persistent "passkey
 * registered" flag: the passkey still exists on the device.
 */
export function clearPasskeyMode(): void {
  localStorage.removeItem(PASSKEY_LABEL_KEY);
  invalidatePasskey();
}

/**
 * Check if this device has ever successfully used a passkey.
 * Survives logout and cancelled prompts so the home screen can
 * prioritize the sign-in path for returning users.
 */
export function hasPasskeyHistory(): boolean {
  return localStorage.getItem(PASSKEY_REGISTERED_KEY) === '1';
}

/**
 * List available labels from nostr relays.
 */
export async function listLabels(): Promise<string[]> {
  logger.info(LogCategory.AUTH, 'Listing labels from nostr relays');
  const passkey = getPasskey();
  return await passkey.listLabels();
}

/**
 * Save a label to nostr relays so it can be discovered later.
 */
export async function saveLabel(label: string): Promise<void> {
  logger.info(LogCategory.AUTH, 'Saving label to nostr relays');
  const passkey = getPasskey();
  await passkey.storeLabel(label);
}

/**
 * Derive a Wallet using passkey authentication.
 *
 * Falls back to saved label from localStorage when no label arg provided.
 *
 * @param label - Optional label. If omitted, uses saved label or SDK default.
 * @returns The derived Wallet object containing seed and label.
 */
export async function getWallet(label?: string): Promise<Wallet> {
  const effectiveLabel = label ?? localStorage.getItem(PASSKEY_LABEL_KEY) ?? undefined;

  logger.info(LogCategory.AUTH, 'Deriving wallet via passkey');

  const passkey = getPasskey();
  try {
    const wallet = await passkey.getWallet(effectiveLabel);
    logger.info(LogCategory.AUTH, 'Passkey wallet derived successfully');
    markPasskeyUsed();
    return wallet;
  } catch (e) {
    logger.error(LogCategory.AUTH, 'Failed to derive passkey wallet', {
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Derive Nostr identity + wallet seed in one PRF ceremony.
 *
 * @param publishLabel - When true (default), publishes the label
 *   to Nostr (idempotent). Pass `false` for speculative cold-restore.
 */
export async function setupWallet(
  label?: string,
  publishLabel: boolean = true,
): Promise<Wallet> {
  const effectiveLabel = label ?? localStorage.getItem(PASSKEY_LABEL_KEY) ?? undefined;

  logger.info(LogCategory.AUTH, 'Setting up wallet via single-prompt passkey ceremony', {
    publishLabel,
  });

  const passkey = getPasskey();
  try {
    const wallet = await passkey.setupWallet(effectiveLabel, publishLabel);
    logger.info(LogCategory.AUTH, 'Passkey wallet setup complete');
    return wallet;
  } catch (e) {
    logger.error(LogCategory.AUTH, 'Failed to set up passkey wallet', {
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
