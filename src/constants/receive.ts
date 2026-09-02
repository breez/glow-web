/**
 * Constants for the Receive flow.
 */

/**
 * Minimum amount (sats) the app will accept when generating a Lightning
 * bolt11 receive invoice. Enforced in both the AmountPanel UI (disables
 * the Generate button) and the
 * `useReceivePayment.generateBolt11Invoice` hook (defensive guard
 * before the SDK call).
 *
 * There is deliberately no matching maximum. The old 4,000,000-sat cap
 * was a product-level guess that mirrored the legacy non-wumbo bolt11
 * ceiling (2^32 msat); Spark settles receives as statechain transfers
 * through the SSP rather than as channel HTLCs, so that ceiling does
 * not apply. The only remaining upper bound is `toSats` / `MAX_SATS`
 * (21M BTC), which keeps the value inside a safe integer before it
 * reaches the SDK.
 */
export const LIGHTNING_INVOICE_MIN_SATS = 1;
