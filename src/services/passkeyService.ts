/**
 * Passkey Service.
 *
 * Wraps the Breez SDK's Passkey class to provide
 * passkey-based wallet creation and restoration functionality.
 *
 * Creates a fresh Passkey instance per operation so that no stale
 * PRF session or cached state can survive between wizard steps.
 */

import { Passkey, Wallet, NostrRelayConfig } from '@breeztech/breez-sdk-spark';
import { passkeyPrfProvider } from './passkeyPrfProvider';
import { logger, LogCategory } from './logger';

// Storage key — presence signals passkey mode
const PASSKEY_LABEL_KEY = 'passkeyLabel';

/**
 * Create a fresh Passkey instance.
 * No caching — each call gets a clean instance with no stale state.
 */
function createPasskeyInstance(): Passkey {
  const breezApiKey = import.meta.env.VITE_BREEZ_API_KEY;
  const relayConfig: NostrRelayConfig | undefined = breezApiKey
    ? { breezApiKey }
    : undefined;
  return new Passkey(passkeyPrfProvider, relayConfig ?? null);
}

/**
 * No-op — kept for backward compatibility.
 * With per-operation instances there is nothing to release.
 */
export function releasePasskey(): void {
  // No singleton to release — instances are created fresh per call.
}

/**
 * Create a new passkey with PRF support.
 * Only registers the credential — no seed derivation.
 * Triggers exactly 1 WebAuthn prompt.
 */
export async function createPasskey(): Promise<void> {
  logger.info(LogCategory.AUTH, 'Creating new passkey');
  await passkeyPrfProvider.createPasskey();
  logger.info(LogCategory.AUTH, 'Passkey created successfully');
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

  const passkey = createPasskeyInstance();
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
 */
export function setPasskeyMode(label?: string): void {
  localStorage.setItem(PASSKEY_LABEL_KEY, label ?? 'Default');
}

/**
 * Clear passkey mode.
 * Does NOT clear the persistent "passkey registered" flag — the passkey
 * still exists on the device and should be reused on next login.
 */
export function clearPasskeyMode(): void {
  localStorage.removeItem(PASSKEY_LABEL_KEY);
}

/**
 * List available labels from nostr relays.
 */
export async function listLabels(): Promise<string[]> {
  logger.info(LogCategory.AUTH, 'Listing labels from nostr relays');
  const passkey = createPasskeyInstance();
  return await passkey.listLabels();
}

/**
 * Store a label to nostr relays so it can be discovered later.
 */
export async function storeLabel(label: string): Promise<void> {
  logger.info(LogCategory.AUTH, 'Storing label to nostr relays');
  const passkey = createPasskeyInstance();
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

  const passkey = createPasskeyInstance();
  try {
    const wallet = await passkey.getWallet(effectiveLabel);
    logger.info(LogCategory.AUTH, 'Passkey wallet derived successfully');
    return wallet;
  } catch (e) {
    logger.error(LogCategory.AUTH, 'Failed to derive passkey wallet', {
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
