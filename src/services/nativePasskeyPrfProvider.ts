/**
 * Native passkey PRF provider for Capacitor (iOS/Android).
 *
 * Delegates to the capacitor-passkey-prf plugin which wraps the SDK's
 * PlatformPasskeyPrfProvider (iOS) and CredentialManagerPrfProvider (Android).
 *
 * Implements the same interface as WebAuthnPrfProvider so it can be swapped
 * in transparently by passkeyPrfProvider.ts on native platforms.
 */

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
          }): Promise<void>;
          derivePrfSeed(options: {
            rpId?: string;
            salt: string;
          }): Promise<{ seed: string }>;
          checkDomainAssociation(options?: {
            rpId?: string;
          }): Promise<DomainAssociation>;
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

  async createPasskey(): Promise<void> {
    await getPlugin().createPasskey({
      rpId: this.rpId,
      rpName: this.rpName,
    });
  }

  async derivePrfSeed(salt: string): Promise<Uint8Array> {
    const { seed } = await getPlugin().derivePrfSeed({
      rpId: this.rpId,
      salt,
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
   * out-of-band domain verification source for `rpId` (Apple's AASA CDN
   * on iOS, Google's Digital Asset Links API on Android).
   *
   * See `DomainAssociation` for return semantics.
   */
  async checkDomainAssociation(): Promise<DomainAssociation> {
    return getPlugin().checkDomainAssociation({ rpId: this.rpId });
  }
}
