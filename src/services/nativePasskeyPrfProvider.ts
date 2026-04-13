/**
 * Native passkey PRF provider for Capacitor (iOS/Android).
 *
 * Delegates to the capacitor-passkey-prf plugin which wraps the SDK's
 * PlatformPasskeyPrfProvider (iOS) and CredentialManagerPrfProvider (Android).
 *
 * Implements the same interface as WebAuthnPrfProvider so it can be swapped
 * in transparently by passkeyPrfProvider.ts on native platforms.
 */

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
}
