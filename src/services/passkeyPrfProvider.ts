/**
 * Passkey PRF Provider — delegates to native (Capacitor) or browser (SDK)
 * depending on the runtime platform.
 *
 * On native (iOS/Android): uses NativePasskeyPrfProvider which calls the
 * capacitor-passkey-prf plugin wrapping the SDK's PasskeyProvider.
 *
 * On web: uses the SDK's `PasskeyProvider` from
 * `@breeztech/breez-sdk-spark/passkey-prf-provider` directly. The host-side
 * credential-IDs registry (allowCredentialIds + capture-on-sign-in) is
 * wired via the same constructor option / settable callback the native
 * plugin uses on iOS/Android, so the web and native paths share an
 * identical state machine.
 */

import type { PrfProvider } from '@breeztech/breez-sdk-spark';
import {
  PasskeyAlreadyExistsError,
  PasskeyProvider as SdkBrowserPasskeyProvider,
  type CreatePasskeyRequest,
} from '@breeztech/breez-sdk-spark/passkey-prf-provider';
import {
  NativePasskeyPrfProvider,
  isNativePlatform,
  type DomainAssociation,
} from './nativePasskeyPrfProvider';
import { logger, LogCategory } from './logger';

export type { DomainAssociation } from './nativePasskeyPrfProvider';

// Re-export the SDK's typed duplicate-create error so existing callers
// (`PasskeyPage.tsx`, `nativePasskeyPrfProvider.ts`) keep importing it
// from this module. Class identity is preserved across all callers
// because there is exactly one declaration shipped by the SDK.
export { PasskeyAlreadyExistsError };

// localStorage shadow of credential IDs we've seen (browser-only;
// native uses the iCloud-synced KnownCredentialsStore).
const PASSKEY_KNOWN_CREDENTIALS_KEY = 'passkeyKnownCredentials';

// Marker set: credentials we've already given a custom user.name to
// (either at create or via signalRename). Gates re-rename since
// WebAuthn doesn't expose the stored user.name on assertion.
const PASSKEY_CUSTOM_NAMED_KEY = 'passkeyCustomNamedCredentials';

// The credentialId of the most recent successful sign-in. Used to
// constrain follow-up sign-in derives (listLabels, saveLabel, label
// switch) to that exact cred so the picker auto-picks on native and
// shows a single-row list on web — eliminates ambiguity about which
// passkey is "current". Cleared on logout / history clear; preserved
// across label switches (labels share a credential).
const PASSKEY_ACTIVE_CRED_KEY = 'passkeyActiveCredentialId';

function getKnownLocal(): string[] {
  try {
    const raw = localStorage.getItem(PASSKEY_KNOWN_CREDENTIALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function addKnownLocal(credentialIdBase64: string): void {
  const existing = getKnownLocal();
  if (existing.includes(credentialIdBase64)) return;
  localStorage.setItem(
    PASSKEY_KNOWN_CREDENTIALS_KEY,
    JSON.stringify([...existing, credentialIdBase64]),
  );
}

function getCustomNamedLocal(): string[] {
  try {
    const raw = localStorage.getItem(PASSKEY_CUSTOM_NAMED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function addCustomNamedLocal(credentialIdBase64: string): void {
  const existing = getCustomNamedLocal();
  if (existing.includes(credentialIdBase64)) return;
  try {
    localStorage.setItem(
      PASSKEY_CUSTOM_NAMED_KEY,
      JSON.stringify([...existing, credentialIdBase64]),
    );
  } catch {
    // Best-effort; signalRename is idempotent across the timestamp shape.
  }
}

function getActiveCredId(): string | null {
  return localStorage.getItem(PASSKEY_ACTIVE_CRED_KEY);
}

function setActiveCredId(credentialIdBase64: string): void {
  try {
    localStorage.setItem(PASSKEY_ACTIVE_CRED_KEY, credentialIdBase64);
  } catch {
    // Best-effort; the cache + warm Nostr OnceCell still cover most flows.
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Chrome's signalCurrentUserDetails takes userId as base64url string,
// not BufferSource as the spec declares.
function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function captureRawError(e: unknown): RawDeriveError {
  return {
    code: (e as { code?: string })?.code,
    name: e instanceof Error ? e.name : undefined,
    message: e instanceof Error ? e.message : String(e),
  };
}

// Mobile browsers' get() picker prominently surfaces cross-device QR
// for empty allowCredentials, while desktop's doesn't — gates the
// two-CTA HomePage fallback. Prefers UA Client Hints; falls back to
// UA string with the iPad-on-iOS-13+ Mac-UA disambiguation.
export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  const ua = navigator.userAgent || '';
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  return /Android|iPhone|iPad|iPod|Mobi/i.test(ua);
}

/** UTC ISO-8601 to second precision, e.g. `2026-05-06T21:14:56`. */
function createTimestampLabel(): string {
  return new Date().toISOString().slice(0, 19);
}

/**
 * Best-effort retroactive rename via WebAuthn L3
 * `PublicKeyCredential.signalCurrentUserDetails`. Pushes a per-credential
 * label (`Glow · <ISO timestamp>`) to the authenticator so legacy
 * passkeys that all share `user.name = "Glow"` (and therefore collapse
 * into a single row in Apple Passwords / similar pickers) become
 * individually identifiable in the OS-level passkey settings and the
 * next sign-in picker. The timestamp on a renamed legacy credential
 * is the (first) sign-in time on this device, not the original create
 * time — we don't have a way to recover the original create time
 * post-hoc.
 *
 * No-op when:
 * - The browser doesn't expose `signalCurrentUserDetails` (Safari < 18,
 *   Firefox, Chrome < 132 without the flag).
 * - The credential doesn't exist on this device for the given rpId
 *   (signal API throws; we swallow).
 * - userHandle is null (rare; the credential isn't discoverable).
 *
 * Idempotent — calling with the same name on the same credential is
 * a no-op at the platform level. Safe to invoke on every sign-in.
 */
async function signalRename(
  rpId: string,
  userHandle: Uint8Array,
  credentialId: Uint8Array,
): Promise<void> {
  const signal = (PublicKeyCredential as unknown as {
    signalCurrentUserDetails?: (opts: {
      rpId: string;
      userId: string;
      name: string;
      displayName: string;
    }) => Promise<void>;
  }).signalCurrentUserDetails;

  if (typeof signal !== 'function') return;

  // Skip credentials we've already named (created or previously renamed)
  // to avoid drifting their label on every sign-in.
  const credIdB64 = bytesToBase64(credentialId);
  if (getCustomNamedLocal().includes(credIdB64)) return;

  try {
    const label = `Glow · ${createTimestampLabel()}`;
    await signal.call(PublicKeyCredential, {
      rpId,
      userId: bytesToBase64Url(userHandle),
      name: label,
      displayName: label,
    });
    addCustomNamedLocal(credIdB64);
    logger.info(LogCategory.AUTH, 'Passkey rename signaled');
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'signalCurrentUserDetails failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ============================================
// Provider factory
// ============================================

const native = isNativePlatform();
const rpId = import.meta.env.VITE_PASSKEY_RP_ID
  || (native ? 'keys.breez.technology' : window.location.hostname);

logger.info(LogCategory.AUTH, 'Passkey PRF provider', {
  rpId,
  platform: native ? 'native' : 'browser',
});

// autoRegister false: explicit createPasskey + derivePrfSeed split.
// authenticatorAttachment + hints scope the create-time chooser to
// platform authenticators on browsers that honor them; native skips
// both (preferImmediatelyAvailableCredentials covers it).
const sdkProvider = native
  ? new NativePasskeyPrfProvider({ rpId, rpName: 'Glow' })
  : new SdkBrowserPasskeyProvider({
      rpId,
      rpName: 'Glow',
      autoRegister: false,
      authenticatorAttachment: 'platform',
      hints: ['client-device'],
    });

/**
 * Snapshot of a derive call's underlying error, captured *before* it
 * round-trips through Rust's `setupWallet` / `getWallet` (which rewraps
 * everything as an opaque "PRF error: Passkey error: …" generic Error
 * and strips the original variant). Hosts read this from their catch
 * block to recover the original `USER_CANCELLED` / `CREDENTIAL_NOT_FOUND`
 * signal.
 */
export interface RawDeriveError {
  /** Plugin-level error code (`USER_CANCELLED`, `CREDENTIAL_NOT_FOUND`, …). */
  code?: string;
  /** Original `Error.name`. */
  name?: string;
  /** Original `Error.message`. */
  message?: string;
}

/**
 * App-level wrapper around the platform-specific provider.
 *
 * Implements the SDK's PrfProvider interface and delegates to either the
 * native or browser provider, adding logging and the onAuthComplete hook.
 */
class AppPasskeyPrfProvider implements PrfProvider {
  /** Optional callback fired after a PRF prompt succeeds in derivePrfSeed. */
  onAuthComplete?: () => void;

  /**
   * Cached `immediateGet` capability flag.
   *  - `undefined`: not yet checked (lazy)
   *  - `null`: capability lookup unsupported / failed
   *  - `true`/`false`: browser explicitly advertised support
   */
  private _immediateGetSupported: boolean | null | undefined = undefined;

  /**
   * Raw error from the most recent derive call. Reset to null at the
   * start of every `derivePrfSeed` / `derivePrfSeeds` invocation, set
   * if the underlying platform call rejects. Read it after `setupWallet`
   * / `getWallet` rejects to recover the original error code, since
   * Rust's UniFFI binding loses variant info on the way back to JS.
   */
  lastDeriveError: RawDeriveError | null = null;

  /**
   * Mode for the next `derivePrfSeed` call (and any chained calls until
   * reset). Controls whether the underlying native provider is allowed
   * to fall back to passkey registration when no credential is found.
   *
   * - `'sign-in'` (autoRegister=false): used by explicit Sign-in flows
   *   so a missing credential surfaces as `CredentialNotFound` instead
   *   of silently registering a new passkey. Required for the
   *   one-passkey-per-RP guarantee.
   * - `'create'` (autoRegister=true): default; matches the previous
   *   behavior where derivePrfSeed auto-registers if needed.
   *
   * On the browser path this is a no-op: the SDK browser provider is
   * configured with `autoRegister: false` at construction time, and a
   * missing credential always throws. Onboarding triggers the explicit
   * `createPasskey` step before deriving.
   */
  mode: 'sign-in' | 'create' = 'create';

  // True when the discovery probe (sign-in attempt) silently no-UIs
  // for users with no matching credentials — what HomePage uses to
  // decide whether to fall back to two explicit CTAs. Native is
  // always true (preferImmediatelyAvailableCredentials in the
  // Capacitor passkey-prf plugin); web is true only when the browser
  // advertises WebAuthn immediateGet support (Chrome flag-gated).
  async supportsImmediateGet(): Promise<boolean> {
    if (native) return true;
    if (this._immediateGetSupported === true) return true;
    if (this._immediateGetSupported === false) return false;
    if (this._immediateGetSupported === null) return false;
    try {
      if (typeof PublicKeyCredential === 'undefined'
          || typeof (PublicKeyCredential as { getClientCapabilities?: unknown }).getClientCapabilities !== 'function') {
        this._immediateGetSupported = null;
        return false;
      }
      const caps = await (PublicKeyCredential as unknown as {
        getClientCapabilities: (kind: string) => Promise<{ immediateGet?: boolean }>;
      }).getClientCapabilities('public-key');
      this._immediateGetSupported = caps?.immediateGet === true;
    } catch {
      this._immediateGetSupported = null;
    }
    return this._immediateGetSupported === true;
  }

  async isPrfAvailable(): Promise<boolean> {
    try {
      const available = await sdkProvider.isPrfAvailable();
      if (!available) {
        logger.debug(LogCategory.AUTH, 'Platform authenticator not available');
      }
      return available;
    } catch (e) {
      logger.warn(LogCategory.AUTH, 'Error checking PRF availability', {
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }

  /** @throws PasskeyAlreadyExistsError when excludeCredentialIds blocks. */
  async createPasskey(
    options: { excludeCredentialIds?: string[] } = {},
  ): Promise<{ credentialId: string; aaguid: string | null; backupEligible: boolean | null }> {
    logger.info(LogCategory.AUTH, 'Creating new passkey', {
      excludeCount: options.excludeCredentialIds?.length ?? 0,
    });

    // Per-create label so password managers render distinct picker
    // rows. Apple Passwords dedupes by (rpId, user.name), so the
    // rpName-derived default would collapse every Glow passkey into
    // one row.
    const label = `Glow · ${createTimestampLabel()}`;

    let credentialId: string;
    let aaguid: string | null;
    let backupEligible: boolean | null;

    if (native) {
      const result = await (sdkProvider as NativePasskeyPrfProvider).createPasskey({
        excludeCredentialIds: options.excludeCredentialIds,
        userName: label,
        userDisplayName: label,
      });
      credentialId = result.credentialId;
      aaguid = result.aaguid;
      backupEligible = result.backupEligible;
    } else {
      const request: CreatePasskeyRequest = {
        excludeCredentialIds: (options.excludeCredentialIds ?? []).map(base64ToBytes),
        userName: label,
        userDisplayName: label,
      };
      const browser = sdkProvider as SdkBrowserPasskeyProvider;
      const result = await browser.createPasskey(request);
      credentialId = bytesToBase64(result.credentialId);
      aaguid = result.aaguid ? bytesToBase64(result.aaguid) : null;
      backupEligible = result.backupEligible;
    }
    // Mark so signalRename leaves this cred's label alone.
    addCustomNamedLocal(credentialId);
    // Pin the immediate next derive (setupWallet's bulk PRF) to this
    // cred so the OS picker auto-resolves on Android instead of
    // showing every cred for the RP. iOS' preferImmediatelyAvailableCredentials
    // already auto-picks single-row matches; this makes Android match.
    setActiveCredId(credentialId);
    logger.info(LogCategory.AUTH, 'Passkey created with PRF support', {
      hasAaguid: aaguid != null,
      backupEligible,
    });
    return { credentialId, aaguid, backupEligible };
  }

  async derivePrfSeed(salt: string): Promise<Uint8Array> {
    const autoRegister = this.mode === 'create';
    logger.info(LogCategory.AUTH, 'Deriving PRF seed', { mode: this.mode });

    this.lastDeriveError = null;
    let seed: Uint8Array;
    try {
      if (native) {
        const activeCredId = getActiveCredId();
        seed = await (sdkProvider as NativePasskeyPrfProvider).derivePrfSeed(salt, {
          autoRegister,
          allowCredentialIds: activeCredId ? [activeCredId] : undefined,
        });
      } else {
        // Constrain follow-up derives to the active cred so listLabels
        // / saveLabel / label switches auto-pick on native and avoid
        // ambiguity on web. Initial sign-in (no active cred yet) stays
        // discoverable so the OS picker can surface synced creds.
        const activeCredId = getActiveCredId();
        const browser = sdkProvider as SdkBrowserPasskeyProvider;
        browser.allowCredentialIds = activeCredId ? [base64ToBytes(activeCredId)] : [];
        browser.onAssertionCredentialId = (idBytes, userHandle) => {
          const credIdB64 = bytesToBase64(idBytes);
          try {
            addKnownLocal(credIdB64);
            setActiveCredId(credIdB64);
          } catch (e) {
            logger.warn(LogCategory.AUTH, 'addKnownLocal failed', {
              error: e instanceof Error ? e.message : String(e),
            });
          }
          // Best-effort retroactive rename for legacy "Glow" creds.
          // Fire-and-forget; must not block the assertion path.
          if (userHandle) void signalRename(rpId, userHandle, idBytes);
        };
        try {
          seed = await browser.derivePrfSeed(salt);
        } finally {
          browser.onAssertionCredentialId = undefined;
        }
      }
    } catch (e) {
      this.lastDeriveError = captureRawError(e);
      throw e;
    }

    logger.info(LogCategory.AUTH, 'PRF seed derived successfully');
    this.onAuthComplete?.();
    return seed;
  }

  /** Bulk PRF derivation. Output order matches input order. */
  async derivePrfSeeds(salts: string[]): Promise<Uint8Array[]> {
    const autoRegister = this.mode === 'create';
    logger.info(LogCategory.AUTH, 'Deriving bulk PRF seeds', {
      mode: this.mode,
      count: salts.length,
    });

    this.lastDeriveError = null;
    let seeds: Uint8Array[];
    try {
      if (native) {
        const activeCredId = getActiveCredId();
        seeds = await (sdkProvider as NativePasskeyPrfProvider).derivePrfSeeds(salts, {
          autoRegister,
          allowCredentialIds: activeCredId ? [activeCredId] : undefined,
        });
      } else {
        // See derivePrfSeed for the active-cred filter rationale.
        const activeCredId = getActiveCredId();
        const browser = sdkProvider as SdkBrowserPasskeyProvider;
        browser.allowCredentialIds = activeCredId ? [base64ToBytes(activeCredId)] : [];
        browser.onAssertionCredentialId = (idBytes, userHandle) => {
          const credIdB64 = bytesToBase64(idBytes);
          try {
            addKnownLocal(credIdB64);
            setActiveCredId(credIdB64);
          } catch (e) {
            logger.warn(LogCategory.AUTH, 'addKnownLocal failed', {
              error: e instanceof Error ? e.message : String(e),
            });
          }
          if (userHandle) {
            void signalRename(rpId, userHandle, idBytes);
          }
        };
        try {
          seeds = await browser.derivePrfSeeds(salts);
        } finally {
          browser.onAssertionCredentialId = undefined;
        }
      }
    } catch (e) {
      this.lastDeriveError = captureRawError(e);
      throw e;
    }

    logger.info(LogCategory.AUTH, 'Bulk PRF seeds derived successfully', {
      count: seeds.length,
    });
    this.onAuthComplete?.();
    return seeds;
  }

  /**
   * Verify the app's identity against the platform's out-of-band domain
   * verification source before any WebAuthn ceremony.
   *
   * Native: delegates to the capacitor-passkey-prf plugin which calls the
   * SDK's built-in `check_domain_association` (Apple AASA CDN on iOS,
   * Google Digital Asset Links API on Android).
   *
   * Browser: the SDK's PasskeyProvider performs a local registrable-suffix
   * check of `rpId` against `window.location.hostname`.
   *
   * Never throws: verification-level failures surface as `Skipped`, not
   * a rejected promise. Callers gate onboarding/discovery UX on the
   * `kind` discriminator.
   */
  async checkDomainAssociation(): Promise<DomainAssociation> {
    const result = await sdkProvider.checkDomainAssociation();
    logger.info(LogCategory.AUTH, 'Domain association check', {
      kind: result.kind,
      ...(result.kind === 'NotAssociated'
        ? { source: result.source, reason: result.reason }
        : {}),
      ...(result.kind === 'Skipped' ? { reason: result.reason } : {}),
    });
    return result;
  }

  /**
   * Read the persisted list of base64-encoded credential IDs for this
   * RP. On native, backed by iCloud Keychain (iOS) / Block Store
   * (Android) so the list survives app uninstall and device transfer.
   * On browser, backed by localStorage (wiped on app reset / cache
   * clear).
   */
  async getKnownCredentialIds(): Promise<string[]> {
    if (native) {
      return (sdkProvider as NativePasskeyPrfProvider).getKnownCredentialIds();
    }
    return getKnownLocal();
  }

  /**
   * Clear the persisted list. Used by the deletion-recovery flow when
   * sign-in returns CredentialNotFound: the OS no longer has the
   * passkey, so the keychain / Block Store / localStorage list is
   * stale.
   */
  async clearKnownCredentialIds(): Promise<void> {
    if (native) {
      return (sdkProvider as NativePasskeyPrfProvider).clearKnownCredentialIds();
    }
    try {
      localStorage.removeItem(PASSKEY_KNOWN_CREDENTIALS_KEY);
    } catch {
      // best-effort
    }
  }
}

export const passkeyPrfProvider = new AppPasskeyPrfProvider();
