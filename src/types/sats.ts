/**
 * Branded type for Bitcoin satoshi amounts.
 *
 * Internally stored as `bigint` so we never lose precision when typing or
 * doing arithmetic on large values. The brand prevents passing arbitrary
 * `bigint` or `number` values where a validated sats amount is expected —
 * callers must go through `toSats()` (or one of its variants) to construct.
 *
 * SDK methods that accept `number` (e.g. `receivePayment.amountSats`,
 * `buyBitcoin.amountSats`) should be called via `toSdkAmountNumber()` so
 * the safe-integer overflow check happens in exactly one place.
 */
export type Sats = bigint & { readonly __brand: 'Sats' };

/** 21M BTC × 10⁸ sats — absolute upper bound for any valid Bitcoin amount. */
export const MAX_SATS: Sats = (21_000_000n * 100_000_000n) as Sats;

/** Constant zero, typed as Sats. */
export const ZERO_SATS: Sats = 0n as Sats;

/**
 * Construct a `Sats` from a bigint or number. Returns null if the input
 * is negative, non-integer, non-finite, or exceeds 21M BTC. Use this at
 * every boundary where untyped numeric input enters the sats domain.
 */
export function toSats(n: bigint | number): Sats | null {
  let value: bigint;
  if (typeof n === 'bigint') {
    value = n;
  } else {
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    value = BigInt(n);
  }
  if (value < 0n || value > MAX_SATS) return null;
  return value as Sats;
}

/**
 * Convert a `Sats` value to a JS `number` for SDK methods that expect
 * `amountSats: number`. Returns null if the value exceeds
 * `Number.MAX_SAFE_INTEGER` — should never happen for `Sats` values that
 * passed `toSats()` (MAX_SATS = 2.1×10¹⁵ is well below 2⁵³ ≈ 9×10¹⁵), but
 * we re-check here as a runtime backstop in case future changes raise the
 * cap.
 */
export function toSdkAmountNumber(sats: Sats): number | null {
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(sats);
}

/** Add two Sats values. */
export function addSats(a: Sats, b: Sats): Sats {
  return (a + b) as Sats;
}

/** True when `a > b`. Use instead of raw `>` so callers can't accidentally
 * compare a Sats against a plain bigint or number. */
export function gtSats(a: Sats, b: Sats): boolean {
  return a > b;
}
