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

import type { PasskeyPrfProvider } from '@breeztech/breez-sdk-spark';
import { NativePasskeyPrfProvider, isNativePlatform } from './nativePasskeyPrfProvider';
import { logger, LogCategory } from './logger';

// ============================================
// Browser WebAuthn PRF (inline until SDK publishes)
// ============================================

async function checkPlatformAuthenticator(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return false;
  }
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

async function createPrfCredential(rpId: string, rpName: string): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = await navigator.credentials.create({
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
    },
  }) as PublicKeyCredential;

  const extResults = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean };
  };

  if (!extResults.prf?.enabled) {
    throw new Error('PRF extension not supported by this authenticator');
  }
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

  async createPasskey(): Promise<void> {
    await createPrfCredential(this.rpId, this.rpName);
  }

  async derivePrfSeed(salt: string): Promise<Uint8Array> {
    return evaluatePrf(this.rpId, salt);
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
 * Implements the SDK's PasskeyPrfProvider interface and delegates to either
 * the native or browser provider, adding logging and the onAuthComplete hook.
 */
class AppPasskeyPrfProvider implements PasskeyPrfProvider {
  /** Optional callback fired after a PRF prompt succeeds in derivePrfSeed. */
  onAuthComplete?: () => void;

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

  async createPasskey(): Promise<void> {
    logger.info(LogCategory.AUTH, 'Creating new passkey');
    await sdkProvider.createPasskey();
    logger.info(LogCategory.AUTH, 'Passkey created with PRF support');
  }

  async derivePrfSeed(salt: string): Promise<Uint8Array> {
    logger.info(LogCategory.AUTH, 'Deriving PRF seed');
    const seed = await sdkProvider.derivePrfSeed(salt);
    logger.info(LogCategory.AUTH, 'PRF seed derived successfully');
    this.onAuthComplete?.();
    return seed;
  }
}

export const passkeyPrfProvider = new AppPasskeyPrfProvider();
