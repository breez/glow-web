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
 * Whether this browser honors WebAuthn immediate mediation
 * (`mediation: 'immediate'`), probed once via
 * `getClientCapabilities('public-key').immediateGet`. Web-only:
 * `immediateGet` is a browser capability, so native short-circuits to
 * false (its own fast-fail on `preferImmediatelyAvailableCredentials` is
 * a separate mechanism). For the login-UX gate use
 * `canSilentlyDetectPasskey`; pass this raw flag to web `signIn`.
 */
let cachedImmediateGet: boolean | null | undefined;
export async function supportsImmediateGet(): Promise<boolean> {
  if (native) return false;
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

/**
 * Whether the device can silently detect an existing passkey (probe and
 * fast-fail through to create without flashing a sheet). Gates the
 * single-CTA "Get Started" login. Native does this inherently; web only
 * where the browser advertises immediate mediation. Umbrella over the
 * web-only `supportsImmediateGet` so neither has to lie about the other
 * (this is true on native; that is not).
 */
export async function canSilentlyDetectPasskey(): Promise<boolean> {
  if (native) return true;
  return supportsImmediateGet();
}
