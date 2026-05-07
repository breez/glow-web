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
// IMPORTANT: import from `passkeyMetadata`, NOT `passkeyService`. The
// latter imports our singleton, which would form a cycle that
// Rollup's production inlining can hit a TDZ on at module init,
// breaking every page that imports either module.
import {
  markCredentialUsed,
  setCredentialUserName,
  getCredentialUserName,
} from './passkeyMetadata';

export type { DomainAssociation } from './nativePasskeyPrfProvider';

// Re-export the SDK's typed duplicate-create error so existing callers
// (`PasskeyPage.tsx`, `nativePasskeyPrfProvider.ts`) keep importing it
// from this module. Class identity is preserved across all callers
// because there is exactly one declaration shipped by the SDK.
export { PasskeyAlreadyExistsError };

// localStorage shadow of credential IDs we've seen (browser-only;
// native uses the iCloud-synced KnownCredentialsStore).
const PASSKEY_KNOWN_CREDENTIALS_KEY = 'passkeyKnownCredentials';

// Bound on the localStorage shadow. A single base64 credentialId is
// ~44 chars, so 32 keeps the JSON blob under 2KB even with quoting.
// Pathological cases (test loops, runaway code paths) get an LRU drop
// instead of unbounded growth.
const KNOWN_CREDENTIALS_MAX = 32;

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
  const next = [...existing, credentialIdBase64];
  // LRU drop: oldest entries leave first when we exceed the cap.
  while (next.length > KNOWN_CREDENTIALS_MAX) next.shift();
  localStorage.setItem(PASSKEY_KNOWN_CREDENTIALS_KEY, JSON.stringify(next));
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

/**
 * Local bookkeeping for every successful assertion. Called from both
 * the web and native branches of derivePrfSeed / derivePrfSeeds so the
 * side effects stay identical across platforms:
 *
 *  1. Append the asserted credId to the localStorage shadow of known
 *     creds (also captured separately by the native plugin's
 *     iCloud-synced KnownCredentialsStore on iOS / Block Store on
 *     Android, but the localStorage copy is the source the management
 *     page reads).
 *  2. Pin it as the active cred so subsequent derives constrain
 *     `allowCredentialIds` to this one.
 *  3. Stamp first-/last-seen timestamps for the per-cred row in
 *     PasskeyManagementPage.
 *
 * Does NOT write a `user.name` cache fallback here. We only display
 * a user.name in the management list for credentials we actually
 * registered on this device (the `createPasskey` path writes the
 * label we passed at registration). Synced creds and older
 * registrations fall back to the generic 'Passkey' label — honest
 * about what we don't know rather than synthesizing a placeholder
 * that doesn't match the platform-side label the user sees in OS
 * Settings or their password manager.
 *
 * Wrapped in try/catch by callers; this function does its own
 * defensive logging but doesn't rethrow into the assertion path.
 */
function captureAssertion(credentialIdBase64: string): void {
  try {
    addKnownLocal(credentialIdBase64);
    setActiveCredId(credentialIdBase64);
    markCredentialUsed(credentialIdBase64);
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'captureAssertion bookkeeping failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
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

// All iOS browsers share WebKit, where signalCurrentUserDetails has been
// observed to (a) fire spurious "Passkey Updated" notifications on
// Apple Passwords and (b) cause GPM (via the AutoFill credential
// provider extension) to materialize a duplicate credential instead of
// updating in place. Until WebKit / iOS fix these, signalRename skips
// iOS entirely.
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports a Mac UA but exposes touch points.
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}

/** Local-time, second precision, ASCII-only, e.g. `May 6, 2026 21:14:56`. */
function createTimestampLabel(): string {
  const d = new Date();
  const datePart = d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${datePart} ${timePart}`;
}

/**
 * Best-effort retroactive rename via WebAuthn L3
 * `PublicKeyCredential.signalCurrentUserDetails`. Pushes `Glow · <local
 * datetime>` to legacy passkeys whose `user.name = "Glow"` collapses
 * them into a single picker row, so each becomes individually
 * identifiable in OS settings and the sign-in picker.
 *
 * Idempotent: the cached `user.name` (`getCredentialUserName`) is the
 * source of truth. First call for a cred mints a timestamp and caches
 * it; later calls re-push the identical string and the platform
 * no-ops. If something reverts the platform-side label, the next
 * sign-in's cached re-push reapplies it. No-op when the browser lacks
 * `signalCurrentUserDetails` (e.g. older iOS WebKit).
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
  if (isIos()) return;

  const credIdB64 = bytesToBase64(credentialId);
  let label = getCredentialUserName(credIdB64);
  const minted = !label;
  if (!label) label = `Glow · ${createTimestampLabel()}`;

  try {
    await signal.call(PublicKeyCredential, {
      rpId,
      userId: bytesToBase64Url(userHandle),
      name: label,
      displayName: label,
    });
    // Cache only after resolve so a throw (e.g. cred not on this
    // device) doesn't leave a phantom label.
    if (minted) setCredentialUserName(credIdB64, label);
    logger.info(LogCategory.AUTH, 'Passkey rename signaled');
  } catch (e) {
    logger.warn(LogCategory.AUTH, 'signalCurrentUserDetails failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// Migration: drop the legacy marker. signalRename now keys on the
// per-cred user.name cache instead.
try {
  localStorage.removeItem('passkeyCustomNamedCredentials');
} catch {
  // Best-effort.
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
// defaultTimeoutMs pinned 5s under the 60s platform cap so the
// host-side `LIKELY_TIMEOUT_MS` heuristic in PasskeyPage fires
// before the OS tears the prompt down on its own timer.
const sdkProvider = native
  ? new NativePasskeyPrfProvider({ rpId, rpName: 'Glow' })
  : new SdkBrowserPasskeyProvider({
      rpId,
      rpName: 'Glow',
      autoRegister: false,
      authenticatorAttachment: 'platform',
      hints: ['client-device'],
      defaultTimeoutMs: 55_000,
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

  /**
   * Settable AbortSignal forwarded to the SDK provider on the next
   * createPasskey / derivePrfSeed / derivePrfSeeds call so callers can
   * cancel an in-flight WebAuthn ceremony (e.g. on component unmount,
   * when a parallel `secureStorage.retrieveSeed` wins the race). Cleared
   * automatically in try/finally around each call so a stale signal
   * from a previous ceremony can't bleed into a fresh one.
   *
   * Web only — on native the underlying Capacitor plugin owns its own
   * lifecycle and does not accept an AbortSignal today.
   */
  currentSignal: AbortSignal | undefined = undefined;

  // True when the discovery probe (sign-in attempt) silently no-UIs
  // for users with no matching credentials — what HomePage uses to
  // decide whether to fall back to two explicit CTAs. Native is
  // always true (preferImmediatelyAvailableCredentials in the
  // Capacitor passkey-prf plugin); web is true only when the browser
  // advertises WebAuthn immediateGet support via getClientCapabilities.
  //
  // NOTE: Chrome 148 stable ships `uiMode: 'immediate'` but does
  // NOT silently fast-fail on no-cred when a hybrid-paired device
  // exists in the user's account. Instead it surfaces the QR /
  // Security Key sheet, defeating the point of immediate mediation
  // for our use case. So we keep gating on the cap-only check here:
  // until Chrome both advertises `immediateGet` AND honors the
  // silent-fast-fail contract, web stays on the two-CTA fallback.
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
      browser.currentSignal = this.currentSignal;
      try {
        const result = await browser.createPasskey(request);
        credentialId = bytesToBase64(result.credentialId);
        aaguid = result.aaguid ? bytesToBase64(result.aaguid) : null;
        backupEligible = result.backupEligible;
      } finally {
        browser.currentSignal = undefined;
      }
    }
    // Cache the label so PasskeyManagementPage renders it (instead
    // of the generic "Passkey" fallback) and signalRename re-pushes
    // the same string on later sign-ins.
    setCredentialUserName(credentialId, label);
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
        const nativeProvider = sdkProvider as NativePasskeyPrfProvider;
        nativeProvider.onAssertionCredentialId = (idBytes) => {
          captureAssertion(bytesToBase64(idBytes));
        };
        try {
          seed = await nativeProvider.derivePrfSeed(salt, {
            autoRegister,
            allowCredentialIds: activeCredId ? [activeCredId] : undefined,
          });
        } finally {
          nativeProvider.onAssertionCredentialId = undefined;
        }
      } else {
        // Constrain follow-up derives to the active cred so listLabels
        // / saveLabel / label switches auto-pick on native and avoid
        // ambiguity on web. Initial sign-in (no active cred yet) stays
        // discoverable so the OS picker can surface synced creds.
        const activeCredId = getActiveCredId();
        const browser = sdkProvider as SdkBrowserPasskeyProvider;
        browser.allowCredentialIds = activeCredId ? [base64ToBytes(activeCredId)] : [];
        browser.currentSignal = this.currentSignal;
        browser.onAssertionCredentialId = (idBytes, userHandle) => {
          const credIdB64 = bytesToBase64(idBytes);
          captureAssertion(credIdB64);
          // Best-effort retroactive rename for legacy "Glow" creds via
          // PublicKeyCredential.signalCurrentUserDetails. Web-only
          // (Chrome 132+, Safari 26+); on native this is a no-op
          // because the WebView's signal API doesn't propagate to
          // the OS-level credential store. captureAssertion above
          // already wrote a local-only user.name fallback, so the
          // rename's only job here is to keep the platform-side
          // label fresh on supporting browsers.
          if (userHandle) void signalRename(rpId, userHandle, idBytes);
        };
        try {
          seed = await browser.derivePrfSeed(salt);
        } finally {
          browser.onAssertionCredentialId = undefined;
          browser.currentSignal = undefined;
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
        const nativeProvider = sdkProvider as NativePasskeyPrfProvider;
        nativeProvider.onAssertionCredentialId = (idBytes) => {
          captureAssertion(bytesToBase64(idBytes));
        };
        try {
          seeds = await nativeProvider.derivePrfSeeds(salts, {
            autoRegister,
            allowCredentialIds: activeCredId ? [activeCredId] : undefined,
          });
        } finally {
          nativeProvider.onAssertionCredentialId = undefined;
        }
      } else {
        // See derivePrfSeed for the active-cred filter rationale.
        const activeCredId = getActiveCredId();
        const browser = sdkProvider as SdkBrowserPasskeyProvider;
        browser.allowCredentialIds = activeCredId ? [base64ToBytes(activeCredId)] : [];
        browser.currentSignal = this.currentSignal;
        browser.onAssertionCredentialId = (idBytes, userHandle) => {
          const credIdB64 = bytesToBase64(idBytes);
          captureAssertion(credIdB64);
          if (userHandle) {
            void signalRename(rpId, userHandle, idBytes);
          }
        };
        try {
          seeds = await browser.derivePrfSeeds(salts);
        } finally {
          browser.onAssertionCredentialId = undefined;
          browser.currentSignal = undefined;
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

  /**
   * Remove a single credential ID from the persisted list. On native,
   * delegates to the plugin's keychain-backed store (per-cred remove).
   * On web, mutates the localStorage shadow in place so the management
   * list reflects the removal immediately.
   */
  async removeKnownCredentialId(credentialId: string): Promise<void> {
    if (!credentialId) return;
    if (native) {
      try {
        await (sdkProvider as NativePasskeyPrfProvider).removeKnownCredentialId(credentialId);
      } catch (e) {
        logger.warn(LogCategory.AUTH, 'native removeKnownCredentialId failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }
    try {
      const raw = localStorage.getItem(PASSKEY_KNOWN_CREDENTIALS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const filtered = parsed.filter(
        (id: unknown): id is string => typeof id === 'string' && id !== credentialId,
      );
      if (filtered.length === parsed.length) return;
      if (filtered.length === 0) {
        localStorage.removeItem(PASSKEY_KNOWN_CREDENTIALS_KEY);
      } else {
        localStorage.setItem(PASSKEY_KNOWN_CREDENTIALS_KEY, JSON.stringify(filtered));
      }
    } catch {
      // best-effort
    }
  }

  /**
   * Best-effort `PublicKeyCredential.signalUnknownCredential` for every
   * provided credentialId. Tells the browser's password manager (Apple
   * Passwords, Google Password Manager, etc.) to hide / drop the cred
   * so it stops surfacing in future cross-device pickers and autofill.
   *
   * Web-only API. No-op when:
   * - No `PublicKeyCredential` (very old browser, non-secure context).
   * - Browser predates Signal API (Chrome < 132, Safari < 26, Firefox).
   *
   * Fire-and-forget: each call is awaited inside its own try, so a hang
   * on one cred (Safari 26.x has WebKit bug 298951 where the promise
   * sometimes never resolves) doesn't stall the rest. Failures are
   * logged at debug only, since the rp has no recourse.
   */
  async signalUnknownCredentials(credentialIdsBase64: string[]): Promise<void> {
    if (credentialIdsBase64.length === 0) return;
    if (typeof PublicKeyCredential === 'undefined') return;
    const fn = (PublicKeyCredential as unknown as {
      signalUnknownCredential?: (opts: { rpId: string; credentialId: string }) => Promise<void>;
    }).signalUnknownCredential;
    if (typeof fn !== 'function') return;
    await Promise.all(credentialIdsBase64.map(async (b64) => {
      try {
        const credentialId = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        await fn.call(PublicKeyCredential, { rpId, credentialId });
      } catch (e) {
        logger.debug(LogCategory.AUTH, 'signalUnknownCredential failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }));
  }
}

export const passkeyPrfProvider = new AppPasskeyPrfProvider();
