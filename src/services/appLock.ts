/**
 * App-level lock (native only), the Misty Breez model: an opt-in 6-digit
 * PIN gates the UI, with biometrics as the preferred gate on top
 * (PIN stays the fallback). Deliberately app-level, not crypto binding:
 * the seed lives in the vault's device-only tier because a
 * biometric-bound seed could never be released by a PIN entry. Only a
 * salted PBKDF2 hash of the PIN is persisted; web is always unlocked.
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { logger, LogCategory } from './logger';

const PIN_HASH_KEY = 'glow.appLock.pinHash';
const PIN_SALT_KEY = 'glow.appLock.pinSalt';
const AUTO_LOCK_KEY = 'glow.appLock.autoLockSeconds';
const BIOMETRIC_KEY = 'glow.appLock.biometricEnabled';

export const PIN_LENGTH = 6;

/** Misty parity: {0 = immediately, 30s, 2m (default), 5m, 10m, 30m, 1h}. */
export const AUTO_LOCK_OPTIONS_SECONDS = [0, 30, 120, 300, 600, 1800, 3600];
export const DEFAULT_AUTO_LOCK_SECONDS = 120;

const PBKDF2_ITERATIONS = 100_000;

export function isAppLockSupported(): boolean {
  return Capacitor.isNativePlatform();
}

// ============================================
// PIN hashing
// ============================================

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function derivePinHash(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
    },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

// ============================================
// PIN management
// ============================================

export async function isPinEnabled(): Promise<boolean> {
  if (!isAppLockSupported()) return false;
  const { value } = await Preferences.get({ key: PIN_HASH_KEY });
  return value != null;
}

/** Create or replace the PIN. Caller is responsible for the verify step. */
export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt);
  await Preferences.set({ key: PIN_SALT_KEY, value: toHex(salt) });
  await Preferences.set({ key: PIN_HASH_KEY, value: hash });
  logger.info(LogCategory.AUTH, 'appLock: PIN set');
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [{ value: hash }, { value: saltHex }] = await Promise.all([
    Preferences.get({ key: PIN_HASH_KEY }),
    Preferences.get({ key: PIN_SALT_KEY }),
  ]);
  if (hash == null || saltHex == null) return false;
  return (await derivePinHash(pin, fromHex(saltHex))) === hash;
}

/** Deactivate PIN protection. Also disables the biometric gate: it is
 *  only offered on top of a PIN, matching Misty. */
export async function clearPin(): Promise<void> {
  await Preferences.remove({ key: PIN_HASH_KEY });
  await Preferences.remove({ key: PIN_SALT_KEY });
  await Preferences.remove({ key: BIOMETRIC_KEY });
  logger.info(LogCategory.AUTH, 'appLock: PIN cleared');
}

// ============================================
// Auto-lock timeout
// ============================================

export async function getAutoLockSeconds(): Promise<number> {
  const { value } = await Preferences.get({ key: AUTO_LOCK_KEY });
  const parsed = value == null ? NaN : parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_AUTO_LOCK_SECONDS;
}

export async function setAutoLockSeconds(seconds: number): Promise<void> {
  await Preferences.set({ key: AUTO_LOCK_KEY, value: String(seconds) });
}

/** Human label for a timeout option ("Immediately", "30 seconds", "2 minutes"…). */
export function formatAutoLockOption(seconds: number): string {
  if (seconds === 0) return 'Immediately';
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// ============================================
// Biometric gate flag
// ============================================

export async function isBiometricGateEnabled(): Promise<boolean> {
  if (!isAppLockSupported()) return false;
  const { value } = await Preferences.get({ key: BIOMETRIC_KEY });
  return value === 'true';
}

export async function setBiometricGateEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await Preferences.set({ key: BIOMETRIC_KEY, value: 'true' });
  } else {
    await Preferences.remove({ key: BIOMETRIC_KEY });
  }
  logger.info(LogCategory.AUTH, `appLock: biometric gate ${enabled ? 'enabled' : 'disabled'}`);
}
