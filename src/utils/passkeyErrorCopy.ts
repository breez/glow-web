/**
 * Friendly copy for raw passkey/PRF errors. Matches both the native
 * bridge's `code` and the message text: the SDK wraps PrfProviderException
 * on Android (code collapses to GENERIC_ERROR), so the variant name often
 * survives only inside the message. Returns null when nothing matches;
 * callers keep their own fallback copy and surface the raw text separately.
 */

type FailureKind =
  | 'gpm-loop'
  | 'prf-unsupported'
  | 'auth-failed'
  | 'timeout'
  | 'prf-eval'
  | 'config'
  | 'network';

function classify(e: unknown, opts?: { isGrapheneOs?: boolean }): FailureKind | null {
  const code = (e as { code?: string })?.code ?? '';
  const raw = e instanceof Error ? e.message : String(e);

  // GrapheneOS: sandboxed Play can't verify the screen lock, so a Google
  // Password Manager ceremony loops on PIN prompts and dies as
  // AuthenticationFailed / "[15] Flow has timed out". Deterministic there,
  // so retrying with the same provider can't help; the copy stays
  // OS-agnostic and steers to another provider or the recovery phrase.
  if (
    opts?.isGrapheneOs
    && /google password manager/i.test(raw)
    && (/authentication[ _]?failed/i.test(raw) || /timed? ?out/i.test(raw))
  ) {
    return 'gpm-loop';
  }

  if (code === 'PRF_NOT_SUPPORTED' || /PrfNotSupported/.test(raw)) {
    return 'prf-unsupported';
  }
  // Covers Google Password Manager's device-unlock loop ending in
  // "[15] Flow has timed out"; lock-and-unlock mirrors Android's own
  // recovery hint for a stale screen-lock verification.
  if (code === 'AUTHENTICATION_FAILED' || /authentication[ _]?failed/i.test(raw)) {
    return 'auth-failed';
  }
  if (/timed? ?out/i.test(raw)) {
    return 'timeout';
  }
  if (code === 'PRF_EVALUATION_FAILED' || /PrfEvaluationFailed/.test(raw)) {
    return 'prf-eval';
  }
  if (code === 'CONFIGURATION_ERROR' || /PrfProviderException\$Configuration/.test(raw)) {
    return 'config';
  }
  if (/network|failed to fetch|load failed/i.test(raw)) {
    return 'network';
  }
  return null;
}

const COPY: Record<FailureKind, string> = {
  // Both deterministic failures share one message: the "Passkey Not
  // Supported" title carries the diagnosis, so the body is only the two
  // ways forward, which are the same for either cause.
  'gpm-loop': 'Please try again with another password provider, or continue with a recovery phrase.',
  'prf-unsupported': 'Please try again with another password provider, or continue with a recovery phrase.',
  'auth-failed': "Your device couldn't finish verifying your identity. Lock and unlock your device, then try again.",
  'timeout': 'The passkey prompt timed out. Please try again.',
  'prf-eval': "Your password manager couldn't process the passkey. Please try again.",
  'config': "Passkeys aren't configured correctly for this app. Please update Glow or try again later.",
  'network': 'Network problem. Check your connection and try again.',
};

export function friendlyPasskeyError(
  e: unknown,
  opts?: { isGrapheneOs?: boolean },
): string | null {
  const kind = classify(e, opts);
  return kind === null ? null : COPY[kind];
}

// The failures a retry cannot fix: the provider has no PRF at all, or
// GPM's screen-lock check is broken on this OS. Both already tell the
// user to switch provider or use the recovery phrase.
const DETERMINISTIC_COPY: ReadonlySet<string> = new Set([
  COPY['gpm-loop'],
  COPY['prf-unsupported'],
]);

/**
 * True when retrying the same provider can never succeed, so callers point
 * the retry action at a different one instead of repeating a ceremony that
 * always fails. Keyed on the message already held in state rather than a
 * parallel flag: it cannot go stale, and the set is built from the same
 * copy the user is reading.
 */
export function isDeterministicFailureCopy(message: string | null): boolean {
  return message !== null && DETERMINISTIC_COPY.has(message);
}
