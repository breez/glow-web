/**
 * Friendly copy for raw passkey/PRF errors. Matches both the native
 * bridge's `code` and the message text: the SDK wraps PrfProviderException
 * on Android (code collapses to GENERIC_ERROR), so the variant name often
 * survives only inside the message. Returns null when nothing matches;
 * callers keep their own fallback copy and surface the raw text separately.
 */
export function friendlyPasskeyError(e: unknown): string | null {
  const code = (e as { code?: string })?.code ?? '';
  const raw = e instanceof Error ? e.message : String(e);

  if (code === 'PRF_NOT_SUPPORTED' || /PrfNotSupported/.test(raw)) {
    return "This device or password manager doesn't support the security feature Glow passkeys need.";
  }
  // Covers Google Password Manager's device-unlock loop ending in
  // "[15] Flow has timed out"; lock-and-unlock mirrors Android's own
  // recovery hint for a stale screen-lock verification.
  if (code === 'AUTHENTICATION_FAILED' || /authentication[ _]?failed/i.test(raw)) {
    return "Your device couldn't finish verifying your identity. Lock and unlock your device, then try again.";
  }
  if (/timed? ?out/i.test(raw)) {
    return 'The passkey prompt timed out. Please try again.';
  }
  if (code === 'PRF_EVALUATION_FAILED' || /PrfEvaluationFailed/.test(raw)) {
    return "Your password manager couldn't process the passkey. Please try again.";
  }
  if (code === 'CONFIGURATION_ERROR' || /PrfProviderException\$Configuration/.test(raw)) {
    return "Passkeys aren't configured correctly for this app. Please update Glow or try again later.";
  }
  if (/network|failed to fetch|load failed/i.test(raw)) {
    return 'Network problem. Check your connection and try again.';
  }
  return null;
}
