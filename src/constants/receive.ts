/**
 * Constants for the Receive flow.
 */

/**
 * Minimum amount (sats) the app will accept when generating a Lightning
 * bolt11 receive invoice. Enforced in both the AmountPanel UI (disables
 * the Generate button + shows the range next to the Amount label) and
 * the `useReceivePayment.generateBolt11Invoice` hook (defensive guard
 * before the SDK call).
 */
export const LIGHTNING_INVOICE_MIN_SATS = 1;

/**
 * Maximum amount (sats) the app will accept when generating a Lightning
 * bolt11 receive invoice. This is a product-level cap chosen for Glow
 * — the Lightning protocol itself can carry larger invoices. See
 * LIGHTNING_INVOICE_MIN_SATS for where it's enforced.
 */
export const LIGHTNING_INVOICE_MAX_SATS = 4_000_000;
