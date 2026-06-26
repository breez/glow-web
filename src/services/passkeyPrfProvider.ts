/**
 * Web-side passkey helpers + shared constants.
 *
 * The SDK's `PasskeyClient` is the host's main passkey surface; this
 * module only holds web-only helpers the client doesn't model
 * (browser capability probe, OS-level credential-deletion signal) and
 * the `rpId` / `rpName` constants that both `passkeyService.ts` and
 * the native plugin's `initialize` call need.
 */

import { Capacitor } from '@capacitor/core';
import { logger, LogCategory } from './logger';

export {
  PasskeyAlreadyExistsError,
  PasskeyTimedOutError,
  PasskeyCredentialNotFoundError,
} from '@breeztech/breez-sdk-spark/passkey-prf-provider';
export type { DomainAssociation } from '@breeztech/breez-sdk-spark/passkey-prf-provider';

const native = Capacitor.isNativePlatform();

export const rpId = (import.meta.env.VITE_PASSKEY_RP_ID as string | undefined)
  ?? (native ? 'keys.breez.technology' : window.location.hostname);
export const rpName = 'Glow';

logger.info(LogCategory.AUTH, 'Passkey config', {
  rpId,
  platform: native ? 'native' : 'browser',
});

/** Local-time, second precision, ASCII-only, e.g. `May 6, 2026 21:14:56`. */
export function createPasskeyTimestampLabel(): string {
  const d = new Date();
  const datePart = d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Best-effort `PublicKeyCredential.signalUnknownCredential` for the
 * given credential IDs. Tells the browser's password manager to hide
 * the cred so it stops surfacing in future cross-device pickers.
 * Web-only; on native the OS owns deletion. Fire-and-forget per cred
 * so a hang on one (Safari 26.x WebKit bug 298951) can't stall the rest.
 */
export async function signalUnknownCredentials(credentialIdsBase64: string[]): Promise<void> {
  if (native || credentialIdsBase64.length === 0) return;
  if (typeof PublicKeyCredential === 'undefined') return;
  const fn = (PublicKeyCredential as unknown as {
    signalUnknownCredential?: (opts: { rpId: string; credentialId: string }) => Promise<void>;
  }).signalUnknownCredential;
  if (typeof fn !== 'function') return;
  await Promise.all(credentialIdsBase64.map(async (b64) => {
    try {
      const credentialId = b64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      await fn.call(PublicKeyCredential, { rpId, credentialId });
    } catch (e) {
      logger.debug(LogCategory.AUTH, 'signalUnknownCredential failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }));
}

/**
 * Cached `immediateGet` capability flag, set once per page session.
 * Native authenticators (iOS 18+, Android 9+) always honor
 * `preferImmediatelyAvailableCredentials`; the web equivalent is the
 * WebAuthn L3 immediate-mediation flag probed via
 * `getClientCapabilities('public-key')`. Returns false on browsers
 * that don't surface the capability API.
 */
/**
 * Temporarily forced off: the immediateGet / immediate-mediation path
 * isn't wired through the SDK yet, so collapse every caller to the
 * two-CTA discovery flow. Flip back to re-enable once the SDK supports it.
 */
const IMMEDIATE_GET_ENABLED = false;

let cachedImmediateGet: boolean | null | undefined;
export async function supportsImmediateGet(): Promise<boolean> {
  if (!IMMEDIATE_GET_ENABLED) return false;
  if (native) return true;
  if (cachedImmediateGet === true) return true;
  if (cachedImmediateGet === false || cachedImmediateGet === null) return false;
  try {
    if (typeof PublicKeyCredential === 'undefined'
        || typeof (PublicKeyCredential as { getClientCapabilities?: unknown }).getClientCapabilities !== 'function') {
      cachedImmediateGet = null;
      return false;
    }
    const caps = await (PublicKeyCredential as unknown as {
      getClientCapabilities: (kind: string) => Promise<{ immediateGet?: boolean }>;
    }).getClientCapabilities('public-key');
    cachedImmediateGet = caps?.immediateGet === true;
  } catch {
    cachedImmediateGet = null;
  }
  return cachedImmediateGet === true;
}
