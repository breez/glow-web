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

// ============================================
// Browser credential-IDs registry (localStorage)
// ============================================

// Web has no equivalent of iOS's iCloud-synced keychain or Android's
// Block Store, so localStorage is the best-effort persistence: wiped on
// app reset / cache clear, but survives reloads. Shared key with
// passkeyService so the read side here always sees newly-registered
// IDs without needing a runtime hook into passkeyService.
//
// Native is unaffected: the plugin reads from synced platform storage
// inside KnownCredentialsStore, so this fallback is unused there.
const PASSKEY_KNOWN_CREDENTIALS_KEY = 'passkeyKnownCredentials';

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

// ============================================
// Base64 ↔ Uint8Array helpers
// ============================================

// The SDK's browser PasskeyProvider exchanges credential IDs as
// Uint8Array. The host-side registry persists strings (for stable
// localStorage shape and parity with iOS/Android base64 keychain
// values), so every boundary needs an encode/decode hop.

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

// `autoRegister: false` matches the prior browser behavior: assertion
// failures (no credential / cancelled) propagate without silently
// auto-registering. Onboarding always uses `createPasskey()` explicitly,
// then `derivePrfSeed()` for the first sign-in. Hosts that want the
// auto-register-on-first-derive ergonomics can opt in by switching to
// `autoRegister: true` here.
const sdkProvider = native
  ? new NativePasskeyPrfProvider({ rpId, rpName: 'Glow' })
  : new SdkBrowserPasskeyProvider({ rpId, rpName: 'Glow', autoRegister: false });

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

  /**
   * Create a new passkey with PRF support.
   *
   * @param options.excludeCredentialIds list of base64 credential IDs
   *        the platform should refuse to duplicate. Pass every previously
   *        registered ID to enforce one-passkey-per-device-per-RP.
   * @returns base64-encoded credential ID of the newly created passkey.
   * @throws PasskeyAlreadyExistsError when excludeCredentialIds blocks.
   */
  async createPasskey(
    options: { excludeCredentialIds?: string[] } = {},
  ): Promise<string> {
    logger.info(LogCategory.AUTH, 'Creating new passkey', {
      excludeCount: options.excludeCredentialIds?.length ?? 0,
    });

    let credentialId: string;
    if (native) {
      credentialId = await (sdkProvider as NativePasskeyPrfProvider).createPasskey(options);
    } else {
      // Browser: SDK's createPasskey takes Uint8Array[] and returns
      // Uint8Array. Convert at the boundary so the host-side registry
      // can stay on stable base64 strings.
      const excludeBytes = (options.excludeCredentialIds ?? []).map(base64ToBytes);
      const browser = sdkProvider as SdkBrowserPasskeyProvider;
      const idBytes = await browser.createPasskey(excludeBytes);
      credentialId = bytesToBase64(idBytes);
    }
    logger.info(LogCategory.AUTH, 'Passkey created with PRF support');
    return credentialId;
  }

  async derivePrfSeed(salt: string): Promise<Uint8Array> {
    const autoRegister = this.mode === 'create';
    logger.info(LogCategory.AUTH, 'Deriving PRF seed', { mode: this.mode });

    let seed: Uint8Array;
    if (native) {
      seed = await (sdkProvider as NativePasskeyPrfProvider).derivePrfSeed(salt, { autoRegister });
    } else {
      // Sign-in constrains to tracked credentials (deterministic
      // seed). Create-mode skips: some authenticators (Chrome
      // Password Manager on Android 12 observed) don't surface a
      // just-registered credential through allowCredentials
      // filtering yet — trust discoverability instead.
      const browser = sdkProvider as SdkBrowserPasskeyProvider;
      browser.allowCredentialIds =
        this.mode === 'create' ? [] : getKnownLocal().map(base64ToBytes);
      browser.onAssertionCredentialId = (idBytes) => {
        try {
          addKnownLocal(bytesToBase64(idBytes));
        } catch (e) {
          logger.warn(LogCategory.AUTH, 'addKnownLocal failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      };
      try {
        seed = await browser.derivePrfSeed(salt);
      } finally {
        browser.allowCredentialIds = [];
        browser.onAssertionCredentialId = undefined;
      }
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

    let seeds: Uint8Array[];
    if (native) {
      seeds = await (sdkProvider as NativePasskeyPrfProvider).derivePrfSeeds(salts, { autoRegister });
    } else {
      const browser = sdkProvider as SdkBrowserPasskeyProvider;
      browser.allowCredentialIds =
        this.mode === 'create' ? [] : getKnownLocal().map(base64ToBytes);
      browser.onAssertionCredentialId = (idBytes) => {
        try {
          addKnownLocal(bytesToBase64(idBytes));
        } catch (e) {
          logger.warn(LogCategory.AUTH, 'addKnownLocal failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      };
      try {
        seeds = await browser.derivePrfSeeds(salts);
      } finally {
        browser.allowCredentialIds = [];
        browser.onAssertionCredentialId = undefined;
      }
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
