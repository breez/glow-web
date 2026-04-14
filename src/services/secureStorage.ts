/**
 * Secure seed storage abstraction.
 *
 * Persists the wallet seed in a platform-appropriate secure store:
 * - Native (iOS / Android via Capacitor): Keychain or Keystore behind a
 *   biometric gate. Seed never lives in plaintext on disk.
 * - Web: not supported — callers fall back to the existing legacy storage
 *   path (today: plaintext localStorage; future: password-encrypted vault).
 *
 * The interface is identical on both platforms; callers branch on
 * `isSupported()` (cheap, synchronous) to decide whether to use this service
 * or the legacy path. No plugin internals leak past this file — every caller
 * talks only to the `SecureStorage` interface and `SecureStorageError`.
 *
 * The native implementation is backed by two @aparajita Capacitor plugins:
 *   - @aparajita/capacitor-secure-storage  (Keychain / Keystore wrapper)
 *   - @aparajita/capacitor-biometric-auth  (Face ID / Touch ID / BiometricPrompt)
 *
 * Both packages MUST be imported here (not just in glow-app) because the
 * aparajita plugins use a JS-layer proxy: the public methods like `set()`
 * and `get()` only exist on the JS side and wrap the native `internal*`
 * primitives. Without these imports, `registerPlugin()` is never called and
 * `window.Capacitor.Plugins.SecureStorage` would only expose the low-level
 * native methods, not the public interface this file uses.
 */

import type { Seed } from '@breeztech/breez-sdk-spark';
import { Capacitor } from '@capacitor/core';
import {
  SecureStorage as AparajitaSecureStorage,
  KeychainAccess,
} from '@aparajita/capacitor-secure-storage';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { logger, LogCategory } from './logger';

// ============================================
// vite-plugin-top-level-await workaround
// ============================================
//
// `@aparajita/capacitor-biometric-auth/dist/esm/base.js` imports `App` from
// `@capacitor/app`, whose own index.js does `registerPlugin('App', { web: ()
// => import('./web').then(...) })`. The dynamic import inside the App plugin's
// register block triggers `vite-plugin-top-level-await` to wrap biometric-auth's
// base.js into a TLA promise: the BiometricAuthBase class is only assigned
// inside the `__tla.then()` callback.
//
// Vite-plugin-top-level-await does NOT propagate the `__tla` await across
// dynamic-import chunk boundaries. So when Capacitor's `registerPlugin` proxy
// lazy-loads `native.js` via `await import('./native.js')`, native.js's
// statically-imported `B` (the BiometricAuthBase class) is still `undefined`
// because base.js's `__tla` hasn't run its `.then()` yet. The result is a
// TypeError at `class BiometricAuthNative extends B` — the entire BiometricAuth
// plugin is unusable.
//
// Workaround: explicitly import base.js, await its `__tla` export, THEN allow
// native.js to be loaded by Capacitor's proxy. After this prepass runs once,
// the BiometricAuthBase class is defined and `await import('./native.js')`
// later will see a fully-evaluated base module.
//
// The package's `exports` field includes `./dist/*: ./dist/*` so importing
// from the dist subpath is supported.
const biometricAuthReadyPromise: Promise<void> = (async () => {
  try {
    const baseModule = await import(
      // Subpath import allowed by the package's `./dist/*: ./dist/*` exports.
      '@aparajita/capacitor-biometric-auth/dist/esm/base.js'
    );
    const tla = (baseModule as { __tla?: Promise<unknown> }).__tla;
    if (tla) {
      await tla;
    }
  } catch {
    // best-effort — if the workaround itself fails, the original TypeError
    // will surface from the BiometricAuth.authenticate call below.
  }
})();

// ============================================
// Constants
// ============================================

/**
 * Storage key for the persisted seed blob. The aparajita plugin will prefix
 * this with its default namespace (`capacitor-storage_`) on disk.
 */
const SEED_KEY = 'glow.wallet_seed';

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

/**
 * iOS Keychain accessibility for the stored seed.
 *
 * `whenUnlockedThisDeviceOnly`: device-local, NOT synced to iCloud, NOT in
 * encrypted backups, only accessible while the device is unlocked. Apple
 * recommends this access class for high-value credentials that must not
 * migrate to a different device. No-op on Android (the Android Keystore
 * wraps the value with a hardware-backed key regardless).
 */
const KEYCHAIN_ACCESS_FOR_SEED = KeychainAccess.whenUnlockedThisDeviceOnly;

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
// Native implementation (iOS / Android via @aparajita)
// ============================================

/**
 * Map a thrown @aparajita BiometryError into our typed error code set.
 *
 * The plugin throws errors whose `.code` is one of `BiometryErrorType`:
 *   userCancel | appCancel | systemCancel | notInteractive | userFallback |
 *   biometryLockout | biometryNotEnrolled | biometryNotAvailable |
 *   passcodeNotSet | noDeviceCredential | authenticationFailed | invalidContext
 */
function mapBiometryErrorCode(code: string): SecureStorageErrorCode {
  switch (code) {
    case 'userCancel':
    case 'appCancel':
    case 'systemCancel':
    case 'notInteractive':
      return 'USER_CANCELLED';
    case 'biometryLockout':
      return 'BIOMETRIC_LOCKOUT';
    case 'biometryNotEnrolled':
      return 'BIOMETRIC_NOT_ENROLLED';
    case 'biometryNotAvailable':
    case 'noDeviceCredential':
    case 'passcodeNotSet':
      return 'BIOMETRIC_UNAVAILABLE';
    default:
      // authenticationFailed / invalidContext / userFallback / unknown
      return 'UNKNOWN';
  }
}

/**
 * Map a thrown @aparajita StorageError into our typed error code set.
 * `invalidData` is treated as `KEY_INVALIDATED` because corrupt data is the
 * symptom we'd see if the iOS Keychain entry was voided by a biometric
 * enrollment change and then partially overwritten by another process.
 */
function mapStorageErrorCode(code: string): SecureStorageErrorCode {
  switch (code) {
    case 'invalidData':
      return 'KEY_INVALIDATED';
    case 'missingKey':
    case 'osError':
    case 'unknownError':
    default:
      return 'UNKNOWN';
  }
}

/**
 * Type guard for a Capacitor plugin error (both StorageError and BiometryError
 * extend Error and have a string `.code`).
 */
function hasErrorCode(err: unknown): err is { code: string; message?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
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

/**
 * Native (Capacitor) implementation backed by iOS Keychain / Android Keystore
 * via the @aparajita plugins. Constructed only when `isNativePlatform()` is
 * true; the factory below picks `NoopSecureStorage` on web.
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
      // `get()` returns `null` when no entry exists — no biometric is needed.
      const raw = await AparajitaSecureStorage.get(SEED_KEY);
      return raw !== null && raw !== undefined;
    } catch (err) {
      // If even checking presence throws, treat as "no seed" so callers fall
      // through to the legacy onboarding path.
      const error = this.toSecureStorageError(err, 'Failed to probe stored seed.');
      logSecureStorageFailure('hasStoredSeed', error.code);
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
      // The plugin's `DataType` is `string | number | boolean | Record<...> | unknown[] | Date`.
      // PersistedSeedBlob structurally matches `Record<string, unknown>` but
      // TypeScript interfaces don't auto-derive an index signature, so we
      // cast at this single boundary.
      await AparajitaSecureStorage.set(
        SEED_KEY,
        blob as unknown as Record<string, unknown>,
        // convertDate=false: we manage our own ISO timestamps; we don't want
        // the plugin to coerce createdAt into a Date object on read.
        false,
        // sync=undefined: respect the plugin's default sync flag.
        undefined,
        // access: force device-only Keychain accessibility on iOS.
        // No-op on Android (where the Keystore wraps the value regardless).
        KEYCHAIN_ACCESS_FOR_SEED,
      );
      logSecureStorageSuccess('storeSeed');
    } catch (err) {
      const error = this.toSecureStorageError(err, 'Failed to persist seed.');
      logSecureStorageFailure('storeSeed', error.code);
      throw error;
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
    // Apply the vite-plugin-top-level-await workaround so the
    // BiometricAuthBase class is defined before Capacitor's proxy lazy-loads
    // native.js. See `biometricAuthReadyPromise` above for the full
    // explanation.
    await biometricAuthReadyPromise;

    // 1. Prompt the user for biometric authentication.
    try {
      await BiometricAuth.authenticate({
        reason: 'Unlock your Glow wallet',
        cancelTitle: 'Cancel',
        androidTitle: 'Unlock Glow wallet',
        androidSubtitle: 'Use your biometric credential to access your wallet',
      });
    } catch (err) {
      const error = this.toSecureStorageError(err, 'Biometric authentication failed.');
      logSecureStorageFailure('retrieveSeed', error.code);
      throw error;
    }

    // 2. Read the persisted blob from secure storage.
    let raw: unknown;
    try {
      raw = await AparajitaSecureStorage.get(SEED_KEY);
    } catch (err) {
      const error = this.toSecureStorageError(err, 'Failed to read stored seed.');
      logSecureStorageFailure('retrieveSeed', error.code);
      throw error;
    }

    if (raw === null || raw === undefined) {
      const error = new SecureStorageError(
        'NO_STORED_SEED',
        'No seed is currently persisted in secure storage.',
      );
      logSecureStorageFailure('retrieveSeed', error.code);
      throw error;
    }

    if (!isPersistedSeedBlob(raw)) {
      // The blob exists but doesn't match our expected shape. Most likely
      // an old/incompatible version or platform-side corruption. Treat as
      // KEY_INVALIDATED so the caller wipes and re-onboards.
      const error = new SecureStorageError(
        'KEY_INVALIDATED',
        'Stored seed blob has an unexpected shape.',
      );
      logSecureStorageFailure('retrieveSeed', error.code);
      throw error;
    }

    logSecureStorageSuccess('retrieveSeed');
    return deserializeSeedFromStorage(raw.seed);
  }

  async clearSeed(): Promise<void> {
    await this.ensureInitialized();
    try {
      await AparajitaSecureStorage.remove(SEED_KEY);
      logSecureStorageSuccess('clearSeed');
    } catch (err) {
      // `remove` is best-effort — if the underlying call throws, we still
      // want logout to succeed. Re-throw a typed error so the caller can
      // log it without leaking plugin details.
      const error = this.toSecureStorageError(err, 'Failed to clear stored seed.');
      logSecureStorageFailure('clearSeed', error.code);
      throw error;
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
   * survive across installs of the same bundle ID. Android Keystore does
   * wipe on uninstall, so this is mostly an iOS concern, but we run the
   * same logic on both platforms for consistency.
   *
   * The fresh-install signal is the absence of an `INSTALL_MARKER_KEY`
   * entry in `localStorage`. localStorage IS wiped on reinstall on both
   * platforms, so a missing marker reliably indicates either:
   *   (1) first ever launch on this device, or
   *   (2) first launch after an uninstall/reinstall cycle
   *
   * In either case we wipe the stored seed before any other operation,
   * then write the marker so subsequent launches skip the cleanup.
   */
  private async cleanupStaleEntriesOnFreshInstall(): Promise<void> {
    try {
      if (typeof localStorage === 'undefined') return;
      if (localStorage.getItem(INSTALL_MARKER_KEY)) return;

      try {
        await AparajitaSecureStorage.remove(SEED_KEY);
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

  /**
   * Convert any caught plugin error into a `SecureStorageError` with the
   * appropriate code. Falls back to `UNKNOWN` for anything we don't recognize.
   */
  private toSecureStorageError(
    err: unknown,
    fallbackMessage: string,
  ): SecureStorageError {
    if (err instanceof SecureStorageError) {
      return err;
    }
    if (hasErrorCode(err)) {
      // Biometry error codes are camelCase strings like 'userCancel'.
      // Storage error codes are also strings: 'missingKey', 'invalidData',
      // 'osError', 'unknownError'. We try the biometry mapping first because
      // `authenticate()` is the only call that produces the cancellation /
      // lockout codes; if it doesn't match, fall back to the storage map.
      const biometryCode = mapBiometryErrorCode(err.code);
      if (biometryCode !== 'UNKNOWN') {
        return new SecureStorageError(biometryCode, err.message ?? fallbackMessage);
      }
      const storageCode = mapStorageErrorCode(err.code);
      return new SecureStorageError(storageCode, err.message ?? fallbackMessage);
    }
    return new SecureStorageError('UNKNOWN', fallbackMessage);
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
// Factory + singleton
// ============================================

/**
 * Returns a user-facing label for the device's current biometry type, e.g.
 * `"Face ID"`, `"Touch ID"`, `"fingerprint"`. Returns `null` on web or if no
 * biometry is enrolled / available. Used by the Unlock page to set the
 * retry-button label.
 *
 * Awaits the biometric-auth TLA workaround promise before calling
 * `BiometricAuth.checkBiometry` so we don't hit the
 * vite-plugin-top-level-await bug that breaks the plugin's class
 * initialization on cold load.
 */
export async function getBiometryLabel(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    await biometricAuthReadyPromise;
    const result = await BiometricAuth.checkBiometry();
    if (!result.isAvailable) return null;
    switch (result.biometryType) {
      case BiometryType.faceId:
        return 'Face ID';
      case BiometryType.touchId:
        return 'Touch ID';
      case BiometryType.fingerprintAuthentication:
        return 'fingerprint';
      case BiometryType.faceAuthentication:
        return 'face';
      case BiometryType.irisAuthentication:
        return 'iris scan';
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function createSecureStorage(): SecureStorage {
  return Capacitor.isNativePlatform() ? new NativeSecureStorage() : new NoopSecureStorage();
}

/**
 * Module-level singleton.
 * Import as: `import { secureStorage } from '@/services/secureStorage';`
 */
export const secureStorage: SecureStorage = createSecureStorage();
