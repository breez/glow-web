import { describe, it, expect } from 'vitest';
import { friendlyPasskeyError } from './passkeyErrorCopy';

const withCode = (message: string, code: string): Error => {
  const e = new Error(message);
  (e as Error & { code?: string }).code = code;
  return e;
};

describe('friendlyPasskeyError', () => {
  it('maps the wrapped GPM auth-failed timeout (QA repro, code collapsed to GENERIC_ERROR)', () => {
    const e = withCode(
      'v1=breez_sdk_spark.PrfProviderException$AuthenticationFailed: v1=Google Password Manager: [15] Flow has timed out.',
      'GENERIC_ERROR',
    );
    expect(friendlyPasskeyError(e)).toBe(
      'Google Password Manager could not verify your screen lock. Try again. If it keeps failing, set a different password manager as your passkey provider in Android settings.',
    );
  });

  it('maps a bare AUTHENTICATION_FAILED code regardless of message', () => {
    expect(friendlyPasskeyError(withCode('whatever', 'AUTHENTICATION_FAILED'))).toMatch(/verifying your identity/);
  });

  it('keeps the generic auth-failed copy when the provider is not GPM', () => {
    const e = withCode(
      'v1=breez_sdk_spark.PrfProviderException$AuthenticationFailed: v1=Bitwarden: something broke',
      'GENERIC_ERROR',
    );
    expect(friendlyPasskeyError(e)).toMatch(/Lock and unlock your device/);
  });

  it('maps plain timeouts', () => {
    expect(friendlyPasskeyError(new Error('The operation timed out.'))).toBe(
      'The passkey prompt timed out. Please try again.',
    );
  });

  it('maps network failures', () => {
    expect(friendlyPasskeyError(new TypeError('Failed to fetch'))).toMatch(/connection/);
  });

  it('returns null for unknown errors so callers keep their fallback copy', () => {
    expect(friendlyPasskeyError(new Error('some novel failure'))).toBeNull();
    expect(friendlyPasskeyError('not even an Error')).toBeNull();
  });
});
