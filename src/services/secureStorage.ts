/**
 * Secure seed storage abstraction.
 *
 * Persists the wallet seed in a platform-appropriate secure store:
 * - Native (iOS / Android via Capacitor): Keychain / Keystore behind a
 *   biometric gate, via the in-house `capacitor-native-vault` plugin in
 *   `glow-app/plugins/`. The plugin owns the iOS Keychain accessibility
 *   policy (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) and the
 *   Android Keystore key generation.
 * - Web: not supported — callers fall back to the existing legacy storage
 *   path (today: plaintext localStorage; future: password-encrypted vault).
 *
 * The interface is identical on both platforms; callers branch on
 * `isSupported()` (cheap, synchronous) to decide whether to use this service
 * or the legacy path. No plugin internals leak past this file — every caller
 * talks only to the `SecureStorage` interface and `SecureStorageError`.
 *
 * As of F2, this file no longer depends on `@aparajita/capacitor-secure-storage`
 * or `@aparajita/capacitor-biometric-auth`. The native plugin is accessed
 * through `window.Capacitor.Plugins.NativeVault` following the same global-
 * injection pattern used by `nativePasskeyPrfProvider.ts`. glow-web does not
 * import the plugin's TypeScript directly — only the runtime global.
 *
 * Bonus: removing the aparajita biometric-auth dependency also removes the
 * `vite-plugin-top-level-await` workaround that the previous version of
 * this file carried (see commit history of `feat/native-secure-seed-storage`).
 * Our plugin has no transitive dependency on `@capacitor/app`, so vite never
 * wraps anything in a `__tla` promise and class extension just works.
 */

import type { Seed } from '@breeztech/breez-sdk-spark';
import { Capacitor } from '@capacitor/core';
import { logger, LogCategory } from './logger';

// ============================================
// Capacitor plugin global (locally typed)
// ============================================

/**
 * Minimal local mirror of `capacitor-native-vault`'s plugin surface. Only
 * the methods this file actually calls are typed. The full TypeScript
 * definitions live in `glow-app/plugins/capacitor-native-vault/src/definitions.ts`,
 * but glow-web stays decoupled from the plugin's npm package — we access
 * it only through the runtime `window.Capacitor.Plugins.NativeVault`
 * global, matching how `nativePasskeyPrfProvider.ts` consumes
 * `capacitor-passkey-prf`.
 */
interface NativeVaultPlugin {
  checkBiometry(): Promise<{ available: boolean; biometryType: string }>;
  hasStoredSeed(): Promise<{ stored: boolean }>;
  storeSeed(options: { seed: string }): Promise<void>;
  retrieveSeed(): Promise<{ seed: string }>;
  clearSeed(): Promise<void>;
}

/**
 * Locally-typed view of the Capacitor global. We deliberately do NOT use
 * `declare global` here — `nativePasskeyPrfProvider.ts` already augments
 * `window.Capacitor` with its own `Plugins.PasskeyPrf` shape, and TypeScript
 * declaration merging on inline object literal types is brittle. A local
 * cast keeps both files self-contained.
 */
interface LocalCapacitorView {
  isNativePlatform?: () => boolean;
  Plugins?: {
    NativeVault?: NativeVaultPlugin;
  };
}

function getCapacitor(): LocalCapacitorView | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: LocalCapacitorView }).Capacitor;
}

function getNativeVault(): NativeVaultPlugin {
  const plugin = getCapacitor()?.Plugins?.NativeVault;
  if (!plugin) {
    throw new SecureStorageError(
      'UNKNOWN',
      'NativeVault Capacitor plugin not registered. Did you run `npx cap sync`?',
    );
  }
  return plugin;
}

// ============================================
// Constants
// ============================================

/**
 * localStorage key used as a fresh-install marker. Set the first time the
 * native impl successfully runs its init pass; never cleared by the app.
 *
 * Why localStorage and not the secure store: localStorage IS wiped on app
 * reinstall on iOS (and Android), but the iOS Keychain is NOT. So the
 * absence of this marker on a native build is a reliable signal that we
 * are running for the first time on this install — even if there are
 * stale Keychain entries left over from a previous install of the same
 * bundle ID. The init pass below uses this signal to wipe any orphan
 * entries before any read.
 */
const INSTALL_MARKER_KEY = 'glow.secureStorageInitialized';

// ============================================
// Stored payload — versioned for migrations
// ============================================

/**
 * Logical shape of a persisted seed entry. The on-disk shape is
 * `PersistedSeedBlob` below — see `serializeSeedForStorage` for the reason
 * the two are different.
 */
interface StoredSeedBlob {
  version: 1;
  seed: Seed;
  /** ISO 8601 timestamp of when this blob was first written. */
  createdAt: string;
}

// Re-exported in case future callers need to introspect the logical shape.
export type { StoredSeedBlob };

// ============================================
// Seed serialization helpers
// ============================================

/**
 * The Breez SDK's `Seed` type has two variants:
 *
 *   { type: "mnemonic"; mnemonic: string; passphrase?: string }
 *   ({ type: "entropy" } & number[])
 *
 * The entropy variant is an array with a `type` property tacked on. That is
 * a problem for `JSON.stringify`: it walks arrays index-by-index and ignores
 * any non-index own properties. So serializing an entropy seed via raw JSON
 * silently drops the `type` discriminator and the round-trip is broken.
 *
 * We work around this by serializing into a plain object form whose shape
 * is JSON-safe, then reconstructing the array+type intersection on read.
 */
type PersistedSeed =
  | { type: 'mnemonic'; mnemonic: string; passphrase?: string }
  | { type: 'entropy'; bytes: number[] };

interface PersistedSeedBlob {
  version: 1;
  seed: PersistedSeed;
  createdAt: string;
}

function serializeSeedForStorage(seed: Seed): PersistedSeed {
  if (seed.type === 'mnemonic') {
    return {
      type: 'mnemonic',
      mnemonic: seed.mnemonic,
      passphrase: seed.passphrase,
    };
  }
  // Entropy variant: copy the array's index entries into a plain `number[]`.
  // `Array.from(seed)` here gives us the byte array without the `type`
  // property, which is exactly what we want for the `bytes` field.
  return { type: 'entropy', bytes: Array.from(seed as ArrayLike<number>) };
}

function deserializeSeedFromStorage(persisted: PersistedSeed): Seed {
  if (persisted.type === 'mnemonic') {
    return {
      type: 'mnemonic',
      mnemonic: persisted.mnemonic,
      passphrase: persisted.passphrase,
    };
  }
  // Reconstruct the `number[] & { type: 'entropy' }` intersection that the
  // SDK expects: take the bytes as a fresh array and attach the discriminator.
  const arr = persisted.bytes.slice();
  return Object.assign(arr, { type: 'entropy' as const }) as Seed;
}

function isPersistedSeedBlob(value: unknown): value is PersistedSeedBlob {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.createdAt !== 'string') return false;
  if (typeof v.seed !== 'object' || v.seed === null) return false;
  const s = v.seed as Record<string, unknown>;
  if (s.type === 'mnemonic') {
    return typeof s.mnemonic === 'string';
  }
  if (s.type === 'entropy') {
    return Array.isArray(s.bytes);
  }
  return false;
}

// ============================================
// Public error surface
// ============================================

/**
 * Typed error codes so callers can branch on a fallback strategy without
 * inspecting raw plugin errors.
 */
export type SecureStorageErrorCode =
  | 'NOT_SUPPORTED'           // Not running on a native Capacitor host.
  | 'NO_STORED_SEED'          // Nothing persisted — normal first-run state.
  | 'USER_CANCELLED'          // User dismissed the biometric prompt.
  | 'BIOMETRIC_LOCKOUT'       // Too many failed attempts — system lockout active.
  | 'BIOMETRIC_NOT_ENROLLED'  // Device has no biometric credentials registered.
  | 'BIOMETRIC_UNAVAILABLE'   // Hardware missing, disabled, or temporarily unavailable.
  | 'KEY_INVALIDATED'         // Stored entry voided (e.g. new biometric enrollment on iOS).
  | 'UNKNOWN';                // Catch-all; treat as recoverable failure.

export class SecureStorageError extends Error {
  constructor(
    public readonly code: SecureStorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SecureStorageError';
  }
}

// ============================================
// Public interface
// ============================================

export interface SecureStorage {
  /**
   * True when running inside a native Capacitor host (iOS or Android).
   * Synchronous and cheap — safe to call at module load time.
   */
  isSupported(): boolean;

  /**
   * Returns true if a seed blob is currently persisted.
   * Does NOT trigger a biometric prompt.
   */
  hasStoredSeed(): Promise<boolean>;

  /**
   * Persist a seed, replacing any existing one.
   * May trigger a biometric prompt depending on platform policy.
   *
   * @throws {SecureStorageError} on any platform failure.
   */
  storeSeed(seed: Seed): Promise<void>;

  /**
   * Retrieve the persisted seed. Triggers the biometric prompt.
   *
   * @throws {SecureStorageError} with one of:
   *   NO_STORED_SEED | USER_CANCELLED | BIOMETRIC_LOCKOUT |
   *   BIOMETRIC_NOT_ENROLLED | BIOMETRIC_UNAVAILABLE | KEY_INVALIDATED | UNKNOWN
   */
  retrieveSeed(): Promise<Seed>;

  /**
   * Wipe the persisted seed. Does NOT require biometric.
   * Safe to call on logout — never throws on a missing entry.
   */
  clearSeed(): Promise<void>;
}

// ============================================
// Error mapping + utilities
// ============================================

/**
 * The new `capacitor-native-vault` plugin already returns our typed
 * `SecureStorageErrorCode` strings via `PluginCall.reject(message, code)` —
 * the `err.code` field is exactly what we want. So this is just a
 * pass-through with a fallback for unexpected codes (which would indicate
 * a bug in the plugin, not the caller).
 */
function mapNativeVaultErrorCode(err: unknown): SecureStorageErrorCode {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: unknown }).code);
    switch (code) {
      case 'NOT_SUPPORTED':
      case 'NO_STORED_SEED':
      case 'USER_CANCELLED':
      case 'BIOMETRIC_LOCKOUT':
      case 'BIOMETRIC_NOT_ENROLLED':
      case 'BIOMETRIC_UNAVAILABLE':
      case 'KEY_INVALIDATED':
      case 'UNKNOWN':
        return code;
    }
  }
  return 'UNKNOWN';
}

function getErrorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return undefined;
}

// ============================================
// Logging breadcrumbs
// ============================================

/**
 * Centralized breadcrumb for successful secure storage operations.
 * Never logs anything that could leak seed material — only the operation name.
 */
function logSecureStorageSuccess(operation: string): void {
  logger.info(LogCategory.AUTH, 'Secure storage operation succeeded', { operation });
}

/**
 * Centralized breadcrumb for secure storage failures, with severity calibrated
 * to whether the code represents a user action, a system state, or an
 * unexpected error. Never logs the underlying error message — only the
 * operation name and the typed error code.
 */
function logSecureStorageFailure(operation: string, code: SecureStorageErrorCode): void {
  const context = { operation, code };
  switch (code) {
    case 'USER_CANCELLED':
    case 'NO_STORED_SEED':
      logger.debug(LogCategory.AUTH, 'Secure storage operation skipped', context);
      break;
    case 'BIOMETRIC_NOT_ENROLLED':
      logger.info(LogCategory.AUTH, 'Secure storage unavailable: biometric not enrolled', context);
      break;
    case 'BIOMETRIC_LOCKOUT':
    case 'BIOMETRIC_UNAVAILABLE':
    case 'KEY_INVALIDATED':
      logger.warn(LogCategory.AUTH, 'Secure storage operation failed', context);
      break;
    case 'NOT_SUPPORTED':
      // Should never reach this branch from NativeSecureStorage; only
      // NoopSecureStorage emits NOT_SUPPORTED and it's a no-op caller path.
      break;
    case 'UNKNOWN':
    default:
      logger.error(LogCategory.AUTH, 'Unexpected secure storage error', context);
      break;
  }
}

// ============================================
// Native implementation (iOS / Android via capacitor-native-vault)
// ============================================

/**
 * Native (Capacitor) implementation backed by iOS Keychain / Android
 * Keystore via the in-house `capacitor-native-vault` plugin. Constructed
 * only when `Capacitor.isNativePlatform()` is true; the factory below
 * picks `NoopSecureStorage` on web.
 */
class NativeSecureStorage implements SecureStorage {
  /**
   * Single in-flight `retrieveSeed` promise so concurrent callers share the
   * same biometric prompt instead of stacking two prompts on top of each
   * other. Reset to null in a `finally` block so the next call re-prompts.
   */
  private inflightRetrieve: Promise<Seed> | null = null;

  /**
   * Single in-flight init promise. The init pass runs once per process and
   * wipes any stale Keychain entries from a previous install of this app
   * bundle — see {@link cleanupStaleEntriesOnFreshInstall} for why.
   */
  private initPromise: Promise<void> | null = null;

  isSupported(): boolean {
    return true;
  }

  async hasStoredSeed(): Promise<boolean> {
    await this.ensureInitialized();
    try {
      const result = await getNativeVault().hasStoredSeed();
      return result.stored;
    } catch (err) {
      // If even checking presence throws, treat as "no seed" so callers fall
      // through to the legacy onboarding path.
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('hasStoredSeed', code);
      return false;
    }
  }

  async storeSeed(seed: Seed): Promise<void> {
    await this.ensureInitialized();
    const blob: PersistedSeedBlob = {
      version: 1,
      seed: serializeSeedForStorage(seed),
      createdAt: new Date().toISOString(),
    };
    try {
      // The plugin treats the seed parameter as opaque bytes, so we
      // JSON-encode the blob on this side and JSON-decode in retrieveSeed.
      // Storage policy (Keychain accessibility, Keystore key params) is
      // owned by the plugin's native side.
      await getNativeVault().storeSeed({ seed: JSON.stringify(blob) });
      logSecureStorageSuccess('storeSeed');
    } catch (err) {
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('storeSeed', code);
      throw new SecureStorageError(code, getErrorMessage(err) ?? 'Failed to persist seed.');
    }
  }

  async retrieveSeed(): Promise<Seed> {
    await this.ensureInitialized();
    // De-duplicate concurrent callers so we only show one biometric prompt.
    if (this.inflightRetrieve) {
      return this.inflightRetrieve;
    }
    this.inflightRetrieve = this.doRetrieve().finally(() => {
      this.inflightRetrieve = null;
    });
    return this.inflightRetrieve;
  }

  private async doRetrieve(): Promise<Seed> {
    // The plugin handles both the biometric prompt and the Keychain /
    // Keystore read. On success it returns the opaque string we passed
    // to storeSeed; on failure it rejects with one of our typed
    // SecureStorageErrorCode strings.
    let result: { seed: string };
    try {
      result = await getNativeVault().retrieveSeed();
    } catch (err) {
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('retrieveSeed', code);
      throw new SecureStorageError(code, getErrorMessage(err) ?? 'Failed to retrieve seed.');
    }

    // Decode the JSON blob the plugin handed back.
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.seed);
    } catch {
      logSecureStorageFailure('retrieveSeed', 'KEY_INVALIDATED');
      throw new SecureStorageError(
        'KEY_INVALIDATED',
        'Stored seed blob is not valid JSON.',
      );
    }

    if (!isPersistedSeedBlob(parsed)) {
      // Most likely an old / incompatible version. Treat as KEY_INVALIDATED
      // so the caller wipes and re-onboards.
      logSecureStorageFailure('retrieveSeed', 'KEY_INVALIDATED');
      throw new SecureStorageError(
        'KEY_INVALIDATED',
        'Stored seed blob has an unexpected shape.',
      );
    }

    logSecureStorageSuccess('retrieveSeed');
    return deserializeSeedFromStorage(parsed.seed);
  }

  async clearSeed(): Promise<void> {
    await this.ensureInitialized();
    try {
      await getNativeVault().clearSeed();
      logSecureStorageSuccess('clearSeed');
    } catch (err) {
      const code = mapNativeVaultErrorCode(err);
      logSecureStorageFailure('clearSeed', code);
      throw new SecureStorageError(code, getErrorMessage(err) ?? 'Failed to clear stored seed.');
    }
  }

  /**
   * One-shot init guard. Multiple concurrent callers share the same
   * `initPromise`, so the cleanup runs at most once per process.
   */
  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.cleanupStaleEntriesOnFreshInstall();
    }
    return this.initPromise;
  }

  /**
   * iOS does NOT wipe Keychain entries when an app is reinstalled — they
   * survive across installs of the same bundle ID. Android Keystore keys
   * + the plugin's SharedPreferences-backed ciphertext both DO wipe on
   * uninstall, so this is mostly an iOS concern, but we run the same
   * logic on both platforms for consistency.
   *
   * The fresh-install signal is the absence of an `INSTALL_MARKER_KEY`
   * entry in `localStorage`. localStorage IS wiped on reinstall on both
   * platforms, so a missing marker reliably indicates either:
   *   (1) first ever launch on this device, or
   *   (2) first launch after an uninstall/reinstall cycle
   *
   * In either case we wipe any stored seed before any other operation,
   * then write the marker so subsequent launches skip the cleanup.
   */
  private async cleanupStaleEntriesOnFreshInstall(): Promise<void> {
    try {
      if (typeof localStorage === 'undefined') return;
      if (localStorage.getItem(INSTALL_MARKER_KEY)) return;

      try {
        await getNativeVault().clearSeed();
        logger.info(LogCategory.AUTH, 'Initialized secure storage on fresh install');
      } catch {
        // Best-effort — never block downstream operations on the cleanup.
      }
      localStorage.setItem(INSTALL_MARKER_KEY, new Date().toISOString());
    } catch {
      // Best-effort — swallow any localStorage / plugin errors so the
      // wallet still attempts to start up.
    }
  }
}

// ============================================
// Web / fallback implementation
// ============================================

/**
 * Used outside a native Capacitor host (browser / PWA / SSR / unit tests).
 * Every method is a no-op or rejects with NOT_SUPPORTED so callers can fall
 * through to the legacy storage path without special-casing the type.
 */
class NoopSecureStorage implements SecureStorage {
  isSupported(): boolean {
    return false;
  }

  async hasStoredSeed(): Promise<boolean> {
    return false;
  }

  async storeSeed(_seed: Seed): Promise<void> {
    throw new SecureStorageError(
      'NOT_SUPPORTED',
      'Secure seed storage is only available on native platforms.',
    );
  }

  async retrieveSeed(): Promise<Seed> {
    throw new SecureStorageError(
      'NOT_SUPPORTED',
      'Secure seed storage is only available on native platforms.',
    );
  }

  async clearSeed(): Promise<void> {
    // No-op — nothing to clear on web.
  }
}

// ============================================
// Biometry label helper (rewritten to use NativeVault)
// ============================================

/**
 * Returns a user-facing label for the device's current biometry type, e.g.
 * `"Face ID"`, `"Touch ID"`, `"fingerprint"`. Returns `null` on web or if
 * no biometry is enrolled / available. Used by the Unlock page to set the
 * retry-button label.
 *
 * Calls `NativeVault.checkBiometry()` directly — no more TLA workaround
 * is needed because the in-house plugin does not transitively import
 * `@capacitor/app`, so vite-plugin-top-level-await never wraps anything.
 */
export async function getBiometryLabel(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const result = await getNativeVault().checkBiometry();
    if (!result.available) return null;
    switch (result.biometryType) {
      case 'faceId':
        return 'Face ID';
      case 'touchId':
        return 'Touch ID';
      case 'fingerprint':
        return 'fingerprint';
      case 'face':
        return 'face';
      case 'iris':
        return 'iris scan';
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ============================================
// Factory + singleton
// ============================================

function createSecureStorage(): SecureStorage {
  return Capacitor.isNativePlatform() ? new NativeSecureStorage() : new NoopSecureStorage();
}

/**
 * Module-level singleton.
 * Import as: `import { secureStorage } from '@/services/secureStorage';`
 */
export const secureStorage: SecureStorage = createSecureStorage();
