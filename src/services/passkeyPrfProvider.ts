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

/**
 * The passkey was created, then deriving from it failed. The SDK has no JS
 * class for this: WASM collapses every error to a bare `Error`, so it is
 * recognised by message and re-thrown as this type.
 *
 * Recover by signing in with the passkey that now exists. Registering again
 * leaves it behind owning an account nothing points to.
 */
export class PasskeyCreatedNotDerivedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyCreatedNotDerivedError';
  }
}

const native = Capacitor.isNativePlatform();

/**
 * Native RP ID, overridable at build time so `.dev` builds target a dev RP.
 * An RP-listed cert is a credential on that RP (the seed derives from a
 * passkey PRF gated on package + cert), so dev and production builds do not
 * share one. Defaults to production, so an unset dev build fails closed once
 * dev certs are off the production RP.
 */
const NATIVE_RP_ID =
  (import.meta.env.VITE_NATIVE_PASSKEY_RP_ID as string | undefined) || 'keys.breez.technology';

/**
 * RP ID used by all existing (legacy) passkeys: the hostname at creation
 * time on web (a fixed value on native). Credentials are cryptographically
 * bound to their RP ID, so legacy passkeys stay discoverable only under it.
 */
export const LEGACY_RP_ID = native ? NATIVE_RP_ID : window.location.hostname;

/**
 * shared-based RP ID from env, set when the deployment has Related Origin
 * Requests configured. When present, new web passkeys are created under it
 * and existing LEGACY_RP_ID users are offered an in-app migration so the
 * change of RP ID does not orphan their wallet.
 */
export const SHARED_RP_ID: string | undefined =
  (import.meta.env.VITE_PASSKEY_RP_ID as string | undefined) || undefined;

/** Default RP ID for normal operation: shared when configured, else legacy. */
export const rpId = SHARED_RP_ID ?? LEGACY_RP_ID;
export const rpName = 'Glow';

logger.info(LogCategory.AUTH, 'Passkey config', {
  rpId,
  legacyRpId: LEGACY_RP_ID,
  sharedRpId: SHARED_RP_ID ?? 'not configured',
  platform: native ? 'native' : 'browser',
  nativeRpOverridden: native && NATIVE_RP_ID !== 'keys.breez.technology',
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
 * Whether the web sign-in probe may use WebAuthn immediate mediation
 * (`uiMode: 'immediate'`). Pinned off: it reports "no credential" both
 * when there is none and when the user dismissed the prompt (browsers
 * collapse the two so a site cannot enumerate passkey holders), and it
 * reports none for a user who does hold one in Chrome/Arc incognito.
 * Either way a returning user looks new, and the single-CTA flow answers
 * that by registering a second passkey owning an unreachable account.
 * Native is unaffected: `preferImmediatelyAvailableCredentials` is a
 * separate mechanism with a typed no-credential result.
 *
 * ponytail: kept as a function with its call sites rather than inlining
 * `false`, so re-enabling once browsers distinguish the two errors is a
 * one-line change here.
 */
export async function supportsImmediateGet(): Promise<boolean> {
  return false;
}

/**
 * Whether the device can silently detect an existing passkey (probe and
 * fast-fail through to create without flashing a sheet). Gates the
 * single-CTA "Get Started" login. Native does this inherently; web goes
 * through `supportsImmediateGet`, which is off, so web always takes the
 * explicit two-CTA flow.
 */
export async function canSilentlyDetectPasskey(): Promise<boolean> {
  if (native) return true;
  return supportsImmediateGet();
}
