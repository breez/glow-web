/**
 * Passkey PRF Provider — delegates to native (Capacitor) or browser (WebAuthn)
 * depending on the runtime platform.
 *
 * On native (iOS/Android): uses NativePasskeyPrfProvider which calls the
 * capacitor-passkey-prf plugin wrapping SDK's platform providers.
 *
 * On web: uses BrowserPasskeyPrfProvider with inline WebAuthn PRF calls.
 * TODO: Replace BrowserPasskeyPrfProvider with SDK's WebAuthnPrfProvider
 * once Spark SDK PR #781 is published.
 */

import type { PrfProvider } from '@breeztech/breez-sdk-spark';
import {
  NativePasskeyPrfProvider,
  isNativePlatform,
  type DomainAssociation,
} from './nativePasskeyPrfProvider';
import { logger, LogCategory } from './logger';

export type { DomainAssociation } from './nativePasskeyPrfProvider';

// ============================================
// Browser WebAuthn PRF (inline until SDK publishes)
// ============================================

async function checkPlatformAuthenticator(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return false;
  }
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

/**
 * Thrown when `createPrfCredential` asks the platform to register a
 * new passkey but it refuses because an entry in `excludeCredentials`
 * matches a credential already on the device.
 */
export class PasskeyAlreadyExistsError extends Error {
  constructor() {
    super('A passkey for this app already exists on this device');
    this.name = 'PasskeyAlreadyExistsError';
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function createPrfCredential(
  rpId: string,
  rpName: string,
  excludeCredentialIds: string[] = [],
): Promise<string> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const excludeCredentials: PublicKeyCredentialDescriptor[] = excludeCredentialIds
    .map((id): PublicKeyCredentialDescriptor | null => {
      try {
        return {
          id: base64ToArrayBuffer(id),
          type: 'public-key' as const,
          transports: ['internal', 'hybrid'] as AuthenticatorTransport[],
        };
      } catch {
        // Skip malformed entries rather than abort the whole register.
        return null;
      }
    })
    .filter((d): d is PublicKeyCredentialDescriptor => d !== null);

  let credential: PublicKeyCredential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: rpName, id: rpId },
        user: { id: userId, name: rpName, displayName: rpName },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'required',
        },
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
        excludeCredentials,
      },
    }) as PublicKeyCredential;
  } catch (e) {
    // Platform refuses when an existing credential matches an entry
    // in excludeCredentials. Browsers raise InvalidStateError.
    if (e instanceof DOMException && e.name === 'InvalidStateError') {
      throw new PasskeyAlreadyExistsError();
    }
    throw e;
  }

  const extResults = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean };
  };

  if (!extResults.prf?.enabled) {
    throw new Error('PRF extension not supported by this authenticator');
  }

  return bytesToBase64(new Uint8Array(credential.rawId));
}

async function evaluatePrf(rpId: string, salt: string): Promise<Uint8Array> {
  const saltBytes = new TextEncoder().encode(salt);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId,
      allowCredentials: [],
      userVerification: 'required',
      extensions: {
        prf: { eval: { first: saltBytes } },
      } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential;

  const extResults = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };

  if (!extResults.prf?.results?.first) {
    throw new Error('PRF evaluation failed');
  }

  return new Uint8Array(extResults.prf.results.first);
}

class BrowserPasskeyPrfProvider {
  constructor(private readonly rpId: string, private readonly rpName: string) {}

  async isPrfAvailable(): Promise<boolean> {
    return checkPlatformAuthenticator();
  }

  /**
   * @returns base64-encoded credential ID of the newly created passkey.
   * @throws PasskeyAlreadyExistsError when excludeCredentialIds blocks.
   */
  async createPasskey(
    options: { excludeCredentialIds?: string[] } = {},
  ): Promise<string> {
    return createPrfCredential(
      this.rpId,
      this.rpName,
      options.excludeCredentialIds ?? [],
    );
  }

  async derivePrfSeed(salt: string): Promise<Uint8Array> {
    return evaluatePrf(this.rpId, salt);
  }

  /**
   * Verify the configured `rpId` is a valid scope for WebAuthn from the
   * current document's origin.
   *
   * Browsers validate `rp.id` locally at ceremony time: no external file,
   * no cache, no TTL. This method mirrors the same registrable-suffix
   * rule so a misconfigured `rpId` (e.g., a staging deploy pointed at
   * `keys.breez.technology` while hosted at `staging.example.com`) can be
   * diagnosed with a concrete reason before WebAuthn throws
   * `SecurityError`.
   */
  async checkDomainAssociation(): Promise<DomainAssociation> {
    if (typeof window === 'undefined' || !window.location?.hostname) {
      return {
        kind: 'Skipped',
        reason: 'No window.location context (SSR / test runner); browser will enforce rpId scope at WebAuthn call time',
      };
    }

    const hostname = window.location.hostname.toLowerCase();
    const rpId = this.rpId.toLowerCase();

    if (!rpId) {
      return {
        kind: 'NotAssociated',
        source: 'WebAuthn rpId scope check',
        reason: 'Provider was constructed with empty rpId; WebAuthn ceremonies will fail',
      };
    }

    // Exact match covers the common case (rpId = hostname).
    if (rpId === hostname) {
      return { kind: 'Associated' };
    }

    // Registrable-suffix rule: rpId must be an ancestor domain of
    // hostname (e.g. rpId="example.com" is valid at
    // hostname="app.example.com"). Dot-aligned suffix match is the
    // spec-level shortcut; the full eTLD+1 check against the Public
    // Suffix List would catch pathological cases like rpId="co.uk"
    // but is a heavy dependency. For Breez's deployment profile this
    // is sufficient.
    if (hostname.endsWith('.' + rpId)) {
      return { kind: 'Associated' };
    }

    return {
      kind: 'NotAssociated',
      source: 'WebAuthn rpId scope check',
      reason: `rpId "${rpId}" is not a registrable suffix of window.location.hostname "${hostname}". ` +
        `WebAuthn ceremonies from this origin will fail with SecurityError.`,
    };
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

const sdkProvider = native
  ? new NativePasskeyPrfProvider({ rpId, rpName: 'Glow' })
  : new BrowserPasskeyPrfProvider(rpId, 'Glow');

/**
 * App-level wrapper around the platform-specific provider.
 *
 * Implements the SDK's PrfProvider interface and delegates to either
 * the native or browser provider, adding logging and the onAuthComplete hook.
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
   *   one-passkey-per-RP guarantee: if the user taps "Sign in" and
   *   the credential is unavailable (cancelled, lockout, missing),
   *   auto-creating a parallel passkey would silently produce a
   *   second unrelated wallet.
   * - `'create'` (autoRegister=true): default; matches the previous
   *   behavior where derivePrfSeed auto-registers if needed.
   *
   * On the browser path this is a no-op: BrowserPasskeyPrfProvider
   * never auto-registers (`navigator.credentials.get` simply throws
   * when no credential is found). Surfaced for API parity with the
   * native plugin path.
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
    const credentialId = await sdkProvider.createPasskey(options);
    logger.info(LogCategory.AUTH, 'Passkey created with PRF support');
    return credentialId;
  }

  async derivePrfSeed(salt: string): Promise<Uint8Array> {
    const autoRegister = this.mode === 'create';
    logger.info(LogCategory.AUTH, 'Deriving PRF seed', { mode: this.mode });
    // Browser provider's derivePrfSeed signature is (salt) only; native's
    // is (salt, { autoRegister }). Branch by capability instead of
    // forcing an option-bag on both.
    const seed = native
      ? await (sdkProvider as NativePasskeyPrfProvider).derivePrfSeed(salt, { autoRegister })
      : await (sdkProvider as BrowserPasskeyPrfProvider).derivePrfSeed(salt);
    logger.info(LogCategory.AUTH, 'PRF seed derived successfully');
    this.onAuthComplete?.();
    return seed;
  }

  /**
   * Verify the app's identity against the platform's out-of-band domain
   * verification source before any WebAuthn ceremony.
   *
   * Native: delegates to the capacitor-passkey-prf plugin which calls the
   * SDK's built-in `check_domain_association` (Apple AASA CDN on iOS,
   * Google Digital Asset Links API on Android).
   *
   * Browser: performs a local registrable-suffix check of `rpId` against
   * `window.location.hostname`.
   *
   * Never throws — verification-level failures surface as `Skipped`, not
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
}

export const passkeyPrfProvider = new AppPasskeyPrfProvider();
