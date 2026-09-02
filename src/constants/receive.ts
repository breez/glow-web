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
