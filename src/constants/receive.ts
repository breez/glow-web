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
 * Longest description the invoice's memo will carry. The service refuses
 * beyond a bound of its own, measured between 632 and 640 ASCII characters
 * and moving with the rest of the invoice, so it is not a figure to sit
 * against. Held well under it, and `generateBolt11Invoice` still names the
 * refusal for the case where a non-Latin memo spends more bytes than it has
 * characters.
 */
export const INVOICE_DESCRIPTION_MAX = 280;
