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
 * The native implementation is intentionally NOT in this commit. It lands in
 * a follow-up so that this file can be reviewed in isolation as the contract
 * the rest of the app will program against.
 */

import type { Seed } from '@breeztech/breez-sdk-spark';

// ============================================
// Stored payload — versioned for migrations
// ============================================

/**
 * Shape persisted to the secure store. Versioned so future migrations to a
 * different seed shape or wrapper format can be detected and handled.
 */
interface StoredSeedBlob {
  version: 1;
  seed: Seed;
  /** ISO 8601 timestamp of when this blob was first written. */
  createdAt: string;
}

// Re-export type for the native implementation (lands in a follow-up commit).
export type { StoredSeedBlob };

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

function createSecureStorage(): SecureStorage {
  // Native implementation lands in a follow-up commit. Until then, every
  // platform routes through the noop impl, which keeps callers (none yet)
  // on the legacy storage path.
  return new NoopSecureStorage();
}

/**
 * Module-level singleton.
 * Import as: `import { secureStorage } from '@/services/secureStorage';`
 */
export const secureStorage: SecureStorage = createSecureStorage();
