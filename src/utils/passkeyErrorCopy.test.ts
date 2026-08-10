import { describe, it, expect } from 'vitest';
import { friendlyPasskeyError } from './passkeyErrorCopy';

const withCode = (message: string, code: string): Error => {
  const e = new Error(message);
  (e as Error & { code?: string }).code = code;
  return e;
};

const GPM_LOOP =
  'v1=breez_sdk_spark.PrfProviderException$AuthenticationFailed: v1=Google Password Manager: [15] Flow has timed out.';

describe('friendlyPasskeyError', () => {
  it('maps the wrapped GPM auth-failed timeout (QA repro, code collapsed to GENERIC_ERROR)', () => {
    expect(friendlyPasskeyError(withCode(GPM_LOOP, 'GENERIC_ERROR'))).toBe(
      "Your device couldn't finish verifying your identity. Lock and unlock your device, then try again.",
    );
  });

  it('maps the GPM loop to deterministic recovery-phrase copy on GrapheneOS', () => {
    expect(friendlyPasskeyError(withCode(GPM_LOOP, 'GENERIC_ERROR'), { isGrapheneOs: true })).toBe(
      "Passkeys aren't working with Google Password Manager on this device. Try again with another password provider, or continue with your recovery phrase.",
    );
  });

  it('keeps generic copy on GrapheneOS when the provider is not Google Password Manager', () => {
    expect(
      friendlyPasskeyError(new Error('Bitwarden: operation timed out'), { isGrapheneOs: true }),
    ).toBe('The passkey prompt timed out. Please try again.');
  });

  it('maps PRF_NOT_SUPPORTED with provider-switch advice', () => {
    expect(friendlyPasskeyError(withCode('nope', 'PRF_NOT_SUPPORTED'))).toMatch(
      /different password manager/,
    );
  });

  it('maps a bare AUTHENTICATION_FAILED code regardless of message', () => {
    expect(friendlyPasskeyError(withCode('whatever', 'AUTHENTICATION_FAILED'))).toMatch(/verifying your identity/);
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
