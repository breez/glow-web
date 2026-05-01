/**
 * Native passkey PRF provider for Capacitor (iOS/Android).
 *
 * Delegates to the capacitor-passkey-prf plugin which wraps the SDK's
 * PlatformPasskeyPrfProvider (iOS) and CredentialManagerPrfProvider (Android).
 *
 * Implements the same interface as WebAuthnPrfProvider so it can be swapped
 * in transparently by passkeyPrfProvider.ts on native platforms.
 */

import { PasskeyAlreadyExistsError } from '@breeztech/breez-sdk-spark/passkey-prf-provider';

/**
 * Result of a domain-association verification check. Mirrors the Rust
 * `DomainAssociation` enum shape from the SDK so cross-platform callers
 * handle it uniformly.
 */
export type DomainAssociation =
  | { kind: 'Associated' }
  | { kind: 'NotAssociated'; source: string; reason: string }
  | { kind: 'Skipped'; reason: string };

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform(): boolean;
      Plugins?: {
        PasskeyPrf?: {
          isPrfAvailable(): Promise<{ available: boolean }>;
          createPasskey(options: {
            rpId?: string;
            rpName?: string;
            userName?: string;
            userDisplayName?: string;
            excludeCredentialIds?: string[];
          }): Promise<{ credentialId: string }>;
          derivePrfSeed(options: {
            rpId?: string;
            salt: string;
            autoRegister?: boolean;
          }): Promise<{ seed: string }>;
          checkDomainAssociation(options?: {
            rpId?: string;
          }): Promise<DomainAssociation>;
          getKnownCredentialIds(options?: {
            rpId?: string;
          }): Promise<{ credentialIds: string[] }>;
          clearKnownCredentialIds(options?: {
            rpId?: string;
          }): Promise<void>;
        };
      };
    };
  }
}

function getPlugin() {
  const plugin = window.Capacitor?.Plugins?.PasskeyPrf;
  if (!plugin) {
    throw new Error('PasskeyPrf Capacitor plugin not available');
  }
  return plugin;
}

export function isNativePlatform(): boolean {
  return window.Capacitor?.isNativePlatform?.() === true;
}

export class NativePasskeyPrfProvider {
  private rpId: string;
  private rpName: string;

  constructor(options: { rpId: string; rpName: string }) {
    this.rpId = options.rpId;
    this.rpName = options.rpName;
  }

  async isPrfAvailable(): Promise<boolean> {
    const { available } = await getPlugin().isPrfAvailable();
    return available;
  }

  /**
   * @returns base64-encoded credential ID of the newly created passkey
   *          as reported by the platform.
   * @throws PasskeyAlreadyExistsError when the platform refuses because
   *         a credential listed in `excludeCredentialIds` is already on
   *         the device. The Capacitor plugin maps the platform-level
   *         duplicate refusal (iOS `matchedExcludedCredential`,
   *         Android `CreatePublicKeyCredentialDomException` with
   *         `InvalidStateError`) to error code
   *         `CREDENTIAL_ALREADY_EXISTS`, which is rethrown here as the
   *         typed JS error.
   */
  async createPasskey(
    options: { excludeCredentialIds?: string[] } = {},
  ): Promise<string> {
    try {
      const { credentialId } = await getPlugin().createPasskey({
        rpId: this.rpId,
        rpName: this.rpName,
        excludeCredentialIds: options.excludeCredentialIds ?? [],
      });
      return credentialId;
    } catch (e) {
      // The SDK surfaces the platform's duplicate-prevention refusal
      // (ASAuthorizationError.matchedExcludedCredential on iOS) as
      // PasskeyPrfError.CredentialAlreadyExists, which the Capacitor
      // plugin maps to error code "CREDENTIAL_ALREADY_EXISTS". Rethrow
      // as the typed JS error so PasskeyPage's existing handler can
      // route the user to the sign-in path.
      const code = (e as { code?: string })?.code;
      if (code === 'CREDENTIAL_ALREADY_EXISTS') {
        throw new PasskeyAlreadyExistsError();
      }
      throw e;
    }
  }

  /**
   * Read the persisted list of base64-encoded credential IDs for this
   * provider's RP ID. Backed by iCloud Keychain on iOS and Google Play
   * Block Store on Android (with `EncryptedSharedPreferences` as a
   * non-Play fallback), so the list survives app uninstall and device
   * transfer for users signed into the cloud account.
   */
  async getKnownCredentialIds(): Promise<string[]> {
    const { credentialIds } = await getPlugin().getKnownCredentialIds({ rpId: this.rpId });
    return credentialIds;
  }

  /**
   * Clear the persisted list. Called by the deletion-recovery flow on
   * sign-in CredentialNotFound, when the OS reports the passkey is gone
   * but our stale list still contains its ID.
   */
  async clearKnownCredentialIds(): Promise<void> {
    await getPlugin().clearKnownCredentialIds({ rpId: this.rpId });
  }

  async derivePrfSeed(
    salt: string,
    options: { autoRegister?: boolean } = {},
  ): Promise<Uint8Array> {
    const { seed } = await getPlugin().derivePrfSeed({
      rpId: this.rpId,
      salt,
      autoRegister: options.autoRegister,
    });
    // Decode base64 to Uint8Array
    const binary = atob(seed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Verify the app's bundle identity is listed by the platform's
   * out-of-band domain verification source for `rpId` (iOS AASA /
   * Android Digital Asset Links).
   *
   * See `DomainAssociation` for return semantics.
   */
  async checkDomainAssociation(): Promise<DomainAssociation> {
    return getPlugin().checkDomainAssociation({ rpId: this.rpId });
  }
}
