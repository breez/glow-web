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
          }): Promise<{
            credentialId: string;
            aaguid?: string | null;
            backupEligible?: boolean | null;
          }>;
          derivePrfSeed(options: {
            rpId?: string;
            salt: string;
            autoRegister?: boolean;
            allowCredentialIds?: string[];
          }): Promise<{ seed: string }>;
          derivePrfSeeds(options: {
            rpId?: string;
            salts: string[];
            autoRegister?: boolean;
            allowCredentialIds?: string[];
          }): Promise<{ seeds: string[] }>;
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

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function isNativePlatform(): boolean {
  return window.Capacitor?.isNativePlatform?.() === true;
}

export function getPlatform(): 'ios' | 'android' | 'web' {
  const p = (window.Capacitor as { getPlatform?: () => string } | undefined)
    ?.getPlatform?.();
  if (p === 'ios') return 'ios';
  if (p === 'android') return 'android';
  return 'web';
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
    options: {
      excludeCredentialIds?: string[];
      /**
       * Per-call override for `user.name` on the WebAuthn registration
       * request. The native plugin forwards this verbatim to the SDK's
       * iOS/Android `PasskeyProvider.userName`, which becomes the `name`
       * field on `ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest`
       * on iOS (also drives Apple Passwords' picker label) and the
       * `name` field on Android `CreatePublicKeyCredentialRequest`'s
       * `user` JSON. Keeps glow-app's per-create label format
       * (`Glow · #<hash>`) consistent with the web path.
       */
      userName?: string;
      /**
       * Per-call override for `user.displayName`. iOS doesn't expose a
       * displayName parameter on its registration API (only `name`),
       * so on iOS this is effectively unused at the credential-storage
       * layer; Android's CredentialManager does honor it. Set to the
       * same value as `userName` for cross-platform consistency.
       */
      userDisplayName?: string;
    } = {},
  ): Promise<{ credentialId: string; aaguid: string | null; backupEligible: boolean | null }> {
    try {
      const { credentialId, aaguid, backupEligible } = await getPlugin().createPasskey({
        rpId: this.rpId,
        rpName: this.rpName,
        excludeCredentialIds: options.excludeCredentialIds ?? [],
        userName: options.userName,
        userDisplayName: options.userDisplayName,
      });
      return {
        credentialId,
        aaguid: aaguid ?? null,
        backupEligible: backupEligible ?? null,
      };
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
    options: { autoRegister?: boolean; allowCredentialIds?: string[] } = {},
  ): Promise<Uint8Array> {
    const { seed } = await getPlugin().derivePrfSeed({
      rpId: this.rpId,
      salt,
      autoRegister: options.autoRegister,
      allowCredentialIds: options.allowCredentialIds,
    });
    return base64ToBytes(seed);
  }

  /** Bulk PRF derivation; native plugin uses dual-salt where supported. */
  async derivePrfSeeds(
    salts: string[],
    options: { autoRegister?: boolean; allowCredentialIds?: string[] } = {},
  ): Promise<Uint8Array[]> {
    const { seeds } = await getPlugin().derivePrfSeeds({
      rpId: this.rpId,
      salts,
      autoRegister: options.autoRegister,
      allowCredentialIds: options.allowCredentialIds,
    });
    return seeds.map(base64ToBytes);
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
