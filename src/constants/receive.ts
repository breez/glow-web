/**
 * Constants for the Receive flow.
 */

/**
 * Minimum amount (sats) the app will accept when generating a Lightning
 * bolt11 receive invoice. Enforced in both the AmountPanel UI (disables
 * the Generate button) and the `useReceivePayment.generateBolt11Invoice`
 * hook (defensive guard before the SDK call).
 */
export const LIGHTNING_INVOICE_MIN_SATS = 1;

/**
 * Largest amount a receive invoice will ask for. Ten times the LNURL limit,
 * and far above anything Lightning routes: the whole public network holds a
 * few thousand BTC. The bound that applied before this was the total supply
 * of bitcoin, and the top of that range is broken, since an invoice for
 * exactly 21M BTC comes back from the SSP with an amount that does not match
 * what was asked. Enforced in the AmountPanel UI and again in
 * `useReceivePayment.generateBolt11Invoice`, as the minimum is.
 */
export const LIGHTNING_INVOICE_MAX_SATS = 10 * 100_000_000;

/**
 * Longest description the invoice's memo will carry. The service refuses
 * beyond a bound of its own, measured between 632 and 640 ASCII characters
 * and moving with the rest of the invoice, so it is not a figure to sit
 * against. Held well under it, and `generateBolt11Invoice` still names the
 * refusal for the case where a non-Latin memo spends more bytes than it has
 * characters.
 */
export const INVOICE_DESCRIPTION_MAX = 280;
