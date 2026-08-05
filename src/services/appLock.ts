/**
 * App-level lock (native only), the Misty Breez model: an opt-in 6-digit
 * PIN gates the UI, with biometrics as the preferred gate on top
 * (PIN stays the fallback). Deliberately app-level, not crypto binding:
 * the seed lives in the vault's device-only tier because a
 * biometric-bound seed could never be released by a PIN entry. Only a
 * salted PBKDF2 hash of the PIN is persisted; web is always unlocked.
 *
 * Storage: Preferences is the durable truth (survives WebView storage
 * eviction); localStorage mirrors the non-secret lock settings so the
 * lock decision can be made synchronously at first render and on
 * foreground-return, with no unlocked frame while a bridge read is in
 * flight. A lost mirror degrades to the async lock path, never to a
 * wrongly-accepted PIN.
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { bytesToHex, hexToBytes } from '../utils/hex';
import { logger, LogCategory } from './logger';

/** Salt + hash in ONE record: a two-key layout could be torn by a
 *  process kill between writes, leaving a PIN no input could match. */
const PIN_RECORD_KEY = 'glow.appLock.pin';
const AUTO_LOCK_KEY = 'glow.appLock.autoLockSeconds';
const BIOMETRIC_KEY = 'glow.appLock.biometricEnabled';
const PIN_ATTEMPTS_KEY = 'glow.appLock.pinAttempts';
/** localStorage mirrors for synchronous reads (booleans/numbers only,
 *  never the PIN record). */
const PIN_MIRROR_KEY = 'glow.appLock.pinEnabledMirror';
const AUTO_LOCK_MIRROR_KEY = 'glow.appLock.autoLockSecondsMirror';
const BIOMETRIC_MIRROR_KEY = 'glow.appLock.biometricEnabledMirror';

export const PIN_LENGTH = 6;

/** Misty parity: {0 = immediately, 30s, 2m (default), 5m, 10m, 30m, 1h}. */
export const AUTO_LOCK_OPTIONS_SECONDS = [0, 30, 120, 300, 600, 1800, 3600];
export const DEFAULT_AUTO_LOCK_SECONDS = 120;

const PBKDF2_ITERATIONS = 100_000;

/**
 * Consecutive failures to seconds of enforced wait, clamped to the last
 * entry. Five free tries, because a mistyped digit is the common case
 * and should cost nothing. From there the wait climbs to an hour, which
 * bounds entry to a couple of dozen tries a day.
 */
const PIN_BACKOFF_SECONDS = [0, 0, 0, 0, 0, 0, 30, 60, 300, 900, 3600];
const MAX_PIN_BACKOFF_MS = Math.max(...PIN_BACKOFF_SECONDS) * 1000;

export function isAppLockSupported(): boolean {
  return Capacitor.isNativePlatform();
}

function mirrorSet(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* mirror only; Preferences stays authoritative */ }
}

function mirrorGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// ============================================
// PIN hashing
// ============================================

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
  return bytesToHex(new Uint8Array(bits));
}

// ============================================
// PIN management
// ============================================

interface PinRecord {
  v: 1;
  salt: string;
  hash: string;
}

async function readPinRecord(): Promise<PinRecord | null> {
  const { value } = await Preferences.get({ key: PIN_RECORD_KEY });
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value) as PinRecord;
    return parsed.salt && parsed.hash ? parsed : null;
  } catch {
    return null;
  }
}

export async function isPinEnabled(): Promise<boolean> {
  if (!isAppLockSupported()) return false;
  return (await readPinRecord()) != null;
}

/** Mirror-backed synchronous check for first-render lock gating. A lost
 *  mirror only delays the lock until the async read lands. */
export function isPinEnabledSync(): boolean {
  return isAppLockSupported() && mirrorGet(PIN_MIRROR_KEY) === 'true';
}

/** Create or replace the PIN. Caller is responsible for the verify step. */
export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const record: PinRecord = { v: 1, salt: bytesToHex(salt), hash: await derivePinHash(pin, salt) };
  await Preferences.set({ key: PIN_RECORD_KEY, value: JSON.stringify(record) });
  await Preferences.remove({ key: PIN_ATTEMPTS_KEY });
  mirrorSet(PIN_MIRROR_KEY, 'true');
  logger.info(LogCategory.AUTH, 'appLock: PIN set');
}

/** Deactivate PIN protection. Also disables the biometric gate: it is
 *  only offered on top of a PIN, matching Misty. */
export async function clearPin(): Promise<void> {
  await Preferences.remove({ key: PIN_RECORD_KEY });
  await Preferences.remove({ key: BIOMETRIC_KEY });
  await Preferences.remove({ key: PIN_ATTEMPTS_KEY });
  mirrorSet(PIN_MIRROR_KEY, null);
  mirrorSet(BIOMETRIC_MIRROR_KEY, null);
  logger.info(LogCategory.AUTH, 'appLock: PIN cleared');
}

// ============================================
// Failed-attempt backoff
// ============================================

interface AttemptRecord {
  failed: number;
  /** Epoch ms before which no attempt is accepted. */
  until: number;
}

const NO_ATTEMPTS: AttemptRecord = { failed: 0, until: 0 };

async function readAttempts(): Promise<AttemptRecord> {
  const { value } = await Preferences.get({ key: PIN_ATTEMPTS_KEY });
  if (value == null) return NO_ATTEMPTS;
  try {
    const parsed = JSON.parse(value) as AttemptRecord;
    return Number.isFinite(parsed.failed) && Number.isFinite(parsed.until) ? parsed : NO_ATTEMPTS;
  } catch {
    return NO_ATTEMPTS;
  }
}

/** Remaining wait, 0 when an attempt is allowed now. A clock pushed
 *  backwards would otherwise freeze the pad indefinitely, so the wait
 *  is capped at the longest the schedule can produce. */
function lockoutMs(record: AttemptRecord): number {
  return Math.min(Math.max(record.until - Date.now(), 0), MAX_PIN_BACKOFF_MS);
}

export interface PinVerifyResult {
  ok: boolean;
  /** ms until the next attempt is accepted; 0 when one is allowed now. */
  lockedForMs: number;
}

/**
 * Rate-limited PIN check. An attempt made during a wait is rejected
 * before the hash is touched and leaves the deadline alone, so repeated
 * entries neither shorten nor extend it.
 */
export async function verifyPin(pin: string): Promise<PinVerifyResult> {
  const attempts = await readAttempts();
  const waiting = lockoutMs(attempts);
  if (waiting > 0) return { ok: false, lockedForMs: waiting };

  const record = await readPinRecord();
  const ok = record != null && (await derivePinHash(pin, hexToBytes(record.salt))) === record.hash;
  if (ok) {
    await Preferences.remove({ key: PIN_ATTEMPTS_KEY });
    return { ok: true, lockedForMs: 0 };
  }

  const failed = attempts.failed + 1;
  const backoffMs =
    PIN_BACKOFF_SECONDS[Math.min(failed, PIN_BACKOFF_SECONDS.length - 1)] * 1000;
  await Preferences.set({
    key: PIN_ATTEMPTS_KEY,
    value: JSON.stringify({ failed, until: Date.now() + backoffMs } satisfies AttemptRecord),
  });
  logger.warn(LogCategory.AUTH, 'appLock: PIN attempt failed', { failed, backoffMs });
  return { ok: false, lockedForMs: backoffMs };
}

/** Lock-screen copy for a rejected attempt. */
export function pinAttemptMessage(result: PinVerifyResult): string {
  if (result.lockedForMs <= 0) return 'Incorrect PIN';
  const seconds = Math.ceil(result.lockedForMs / 1000);
  if (seconds < 60) return `Too many attempts. Try again in ${seconds} seconds.`;
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Try again in ${minutes === 1 ? '1 minute' : `${minutes} minutes`}.`;
}

// ============================================
// Auto-lock timeout
// ============================================

export async function getAutoLockSeconds(): Promise<number> {
  const { value } = await Preferences.get({ key: AUTO_LOCK_KEY });
  const parsed = value == null ? NaN : parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_AUTO_LOCK_SECONDS;
}

/** Mirror-backed synchronous read for the foreground-return decision. */
export function getAutoLockSecondsSync(): number {
  const parsed = parseInt(mirrorGet(AUTO_LOCK_MIRROR_KEY) ?? '', 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_AUTO_LOCK_SECONDS;
}

export async function setAutoLockSeconds(seconds: number): Promise<void> {
  await Preferences.set({ key: AUTO_LOCK_KEY, value: String(seconds) });
  mirrorSet(AUTO_LOCK_MIRROR_KEY, String(seconds));
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
  const enabled = value === 'true';
  // Backfill the mirror for installs that enabled the gate before the
  // mirror existed (and self-heal an evicted one).
  mirrorSet(BIOMETRIC_MIRROR_KEY, enabled ? 'true' : null);
  return enabled;
}

/** Mirror-backed synchronous read so lock UIs can decide "pad or
 *  biometric first" at first render, with no pad flash while the
 *  Preferences read is in flight. A lost mirror degrades to showing
 *  the pad; the async read reconciles. */
export function isBiometricGateEnabledSync(): boolean {
  return isAppLockSupported() && mirrorGet(BIOMETRIC_MIRROR_KEY) === 'true';
}

export async function setBiometricGateEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await Preferences.set({ key: BIOMETRIC_KEY, value: 'true' });
  } else {
    await Preferences.remove({ key: BIOMETRIC_KEY });
  }
  mirrorSet(BIOMETRIC_MIRROR_KEY, enabled ? 'true' : null);
  logger.info(LogCategory.AUTH, `appLock: biometric gate ${enabled ? 'enabled' : 'disabled'}`);
}
