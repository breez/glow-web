/**
 * Password rules for the encrypted seed vault. One source of truth so
 * setup, unlock, and input sanitization all agree.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 32;

export function sanitizePasswordInput(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length && out.length < PASSWORD_MAX_LENGTH; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7F) continue;
    out += raw[i];
  }
  return out;
}

/** Setup-time rules. Stricter than unlock so new vaults start clean. */
export function validatePasswordSetup(password: string, confirm: string): string | null {
  if (password.length === 0) return 'Password is required';
  if (/\s/.test(password)) return 'Password cannot contain spaces';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (password !== confirm) return 'Passwords do not match';
  return null;
}

/**
 * Unlock-time rules. Minimal: non-empty only. We never reject an
 * existing password here, the AES-GCM tag check is the source of
 * truth for "is this the right password?".
 */
export function validatePasswordUnlock(password: string): string | null {
  if (password.length === 0) return 'Password is required';
  return null;
}

// ---------- Strength rating ----------

export type PasswordStrength = 'weak' | 'medium' | 'strong';

const SYMBOL_POOL_SIZE = 32; // common ASCII punctuation

/** Union of character classes the password actually uses. */
function poolSize(password: string): number {
  let size = 0;
  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/[0-9]/.test(password)) size += 10;
  if (/ /.test(password)) size += 1;
  if (/[^A-Za-z0-9 ]/.test(password)) size += SYMBOL_POOL_SIZE;
  return size;
}

/** Shannon entropy of a brute-force search over `poolSize(password)`. */
function entropyBits(password: string): number {
  const pool = poolSize(password);
  return pool === 0 ? 0 : password.length * Math.log2(pool);
}

/**
 * Strength bucket. Anything the setup validator would reject is
 * automatically weak: we don't reward malformed inputs with a
 * higher score even if they're long.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (validatePasswordSetup(password, password) !== null) return 'weak';
  const bits = entropyBits(password);
  if (bits >= 70) return 'strong'; // ~370 yr at 1e11 g/s
  if (bits >= 50) return 'medium'; // ~3 hr at 1e11 g/s
  return 'weak';
}

// ---------- Have I Been Pwned ----------

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

async function sha1HexUpper(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/**
 * Returns true only when HIBP positively confirms the password is in
 * a breach corpus. Any failure (network, non-200, parse, missing
 * crypto.subtle) returns false so a transient outage can't block
 * onboarding. Uses k-anonymity: only the first 5 chars of the
 * SHA-1 prefix leave the device.
 */
export async function isPasswordPwned(password: string): Promise<boolean> {
  if (typeof crypto?.subtle === 'undefined') return false;
  try {
    const hash = await sha1HexUpper(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetch(`${HIBP_RANGE_URL}${prefix}`);
    if (!res.ok) return false;
    const text = await res.text();
    for (const line of text.split('\n')) {
      const candidate = line.split(':')[0]?.trim();
      if (candidate === suffix) return true;
    }
    return false;
  } catch {
    return false;
  }
}
