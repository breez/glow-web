import { describe, it, expect } from 'vitest';
import { friendlyPasskeyError, isDeterministicFailureCopy } from './passkeyErrorCopy';

const DETERMINISTIC = 'Please try again with another password provider, or continue with a recovery phrase.';

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
      DETERMINISTIC,
    );
  });

  it('keeps generic copy on GrapheneOS when the provider is not Google Password Manager', () => {
    expect(
      friendlyPasskeyError(new Error('Bitwarden: operation timed out'), { isGrapheneOs: true }),
    ).toBe('The passkey prompt timed out. Please try again.');
  });

  it('maps PRF_NOT_SUPPORTED to the same deterministic copy as the GPM loop', () => {
    expect(friendlyPasskeyError(withCode('nope', 'PRF_NOT_SUPPORTED'))).toBe(DETERMINISTIC);
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

describe('isDeterministicFailureCopy', () => {
  // Hiding the retry action rests on these two, so they are asserted
  // through friendlyPasskeyError rather than against pasted strings: a
  // copy edit that misses one side fails here instead of shipping a
  // footer whose only remaining action is the recovery phrase.
  it('flags the GPM loop on GrapheneOS', () => {
    const copy = friendlyPasskeyError(withCode(GPM_LOOP, 'GENERIC_ERROR'), { isGrapheneOs: true });
    expect(isDeterministicFailureCopy(copy)).toBe(true);
  });

  it('flags PRF_NOT_SUPPORTED', () => {
    expect(isDeterministicFailureCopy(friendlyPasskeyError(withCode('nope', 'PRF_NOT_SUPPORTED')))).toBe(true);
  });

  it('leaves retryable failures alone', () => {
    // The same GPM error off GrapheneOS is the retryable lock-and-unlock case.
    expect(isDeterministicFailureCopy(friendlyPasskeyError(withCode(GPM_LOOP, 'GENERIC_ERROR')))).toBe(false);
    expect(isDeterministicFailureCopy(friendlyPasskeyError(new Error('The operation timed out.')))).toBe(false);
    expect(isDeterministicFailureCopy(friendlyPasskeyError(new TypeError('Failed to fetch')))).toBe(false);
    expect(isDeterministicFailureCopy(friendlyPasskeyError(withCode('x', 'PRF_EVALUATION_FAILED')))).toBe(false);
  });

  it('treats an unmatched error and a missing message as retryable', () => {
    expect(isDeterministicFailureCopy(friendlyPasskeyError(new Error('some novel failure')))).toBe(false);
    expect(isDeterministicFailureCopy(null)).toBe(false);
    expect(isDeterministicFailureCopy('Could not sign in with your passkey. Please try again.')).toBe(false);
  });
});
