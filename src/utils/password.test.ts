import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  isPasswordPwned,
  passwordStrength,
  sanitizePasswordInput,
  validatePasswordSetup,
  validatePasswordUnlock,
} from './password';

describe('sanitizePasswordInput', () => {
  it('strips ASCII control characters (newline, tab, NUL, DEL)', () => {
    expect(sanitizePasswordInput('foo\nbar\tbaz qux')).toBe('foobarbaz qux');
  });

  it('strips carriage returns from pasted CRLF lines', () => {
    expect(sanitizePasswordInput('hunter2\r\n')).toBe('hunter2');
  });

  it('preserves spaces so the user can see them and the validator can reject', () => {
    expect(sanitizePasswordInput('  hunter 22  ')).toBe('  hunter 22  ');
  });

  it('preserves unicode and symbols', () => {
    expect(sanitizePasswordInput('p@ssw0rd!~$%^&*()_+£€π🦀')).toBe('p@ssw0rd!~$%^&*()_+£€π🦀');
  });

  it('caps at PASSWORD_MAX_LENGTH', () => {
    const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 100);
    expect(sanitizePasswordInput(long)).toBe('a'.repeat(PASSWORD_MAX_LENGTH));
  });

  it('returns empty for an empty input', () => {
    expect(sanitizePasswordInput('')).toBe('');
  });
});

describe('validatePasswordSetup', () => {
  it('accepts a 12-char password matching its confirm', () => {
    expect(validatePasswordSetup('hunter22hunt!', 'hunter22hunt!')).toBeNull();
  });

  it('accepts unicode characters', () => {
    const password = 'p@ssw0rd£€π🦀';
    expect(validatePasswordSetup(password, password)).toBeNull();
  });

  it('rejects empty', () => {
    expect(validatePasswordSetup('', '')).toBe('Password is required');
  });

  it('rejects passwords containing spaces', () => {
    expect(validatePasswordSetup('hello world!', 'hello world!')).toBe('Password cannot contain spaces');
    expect(validatePasswordSetup(' hunter22hunt', ' hunter22hunt')).toBe('Password cannot contain spaces');
    expect(validatePasswordSetup('hunter22hunt ', 'hunter22hunt ')).toBe('Password cannot contain spaces');
  });

  it('rejects below the minimum length', () => {
    expect(validatePasswordSetup('hunter22', 'hunter22')).toBe('Password must be at least 12 characters');
  });

  it('rejects above the maximum length', () => {
    const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 1);
    expect(validatePasswordSetup(long, long)).toBe(`Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  });

  it('rejects mismatched confirm', () => {
    expect(validatePasswordSetup('hunter22hunt!', 'hunter22hunt?')).toBe('Passwords do not match');
  });
});

describe('validatePasswordUnlock', () => {
  it('accepts any non-empty password (decrypt verifies)', () => {
    expect(validatePasswordUnlock('a')).toBeNull();
  });

  it('rejects empty', () => {
    expect(validatePasswordUnlock('')).toBe('Password is required');
  });
});

describe('passwordStrength', () => {
  it('returns weak for anything the setup validator rejects', () => {
    expect(passwordStrength('')).toBe('weak');
    expect(passwordStrength('short')).toBe('weak');
    expect(passwordStrength('hello world Aa1!')).toBe('weak');
  });

  it('rates a 12-char lowercase password as medium', () => {
    // 12 chars * log2(26) ~= 56 bits -> medium
    expect(passwordStrength('aaaabbbbcccc')).toBe('medium');
  });

  it('rates a 12-char all-classes password as strong', () => {
    // 12 chars * log2(94) ~= 78 bits -> strong
    expect(passwordStrength('Aaaa1!Bccccd')).toBe('strong');
  });

  it('rates a 16-char mixed password as strong', () => {
    expect(passwordStrength('Hunter2!Hunter22')).toBe('strong');
  });
});

describe('isPasswordPwned', () => {
  // SHA-1 of "password" = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
  // Prefix "5BAA6", suffix "1E4C9B93F3F0682250B6CF8331B7EE68FD8".
  const KNOWN_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when the suffix appears in the API response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(`AAAAA1234567890ABCDEF1234567890ABCDEF:9\n${KNOWN_SUFFIX}:42\n`),
    );
    expect(await isPasswordPwned('password')).toBe(true);
  });

  it('returns false when the suffix is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('AAAAA1234567890ABCDEF1234567890ABCDEF:9\n'),
    );
    expect(await isPasswordPwned('password')).toBe(false);
  });

  it('returns false on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
    expect(await isPasswordPwned('password')).toBe(false);
  });

  it('returns false when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));
    expect(await isPasswordPwned('password')).toBe(false);
  });
});
