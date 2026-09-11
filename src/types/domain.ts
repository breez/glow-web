// Shared domain types for the wallet example app

import { InputType } from "@breeztech/breez-sdk-spark/bundler";

// Supported receive tabs / methods in Receive dialog
export type PaymentMethod = 'lightning' | 'spark' | 'bitcoin';

// Steps for the Receive dialog
export type ReceiveStep = 'input' | 'qr' | 'loading';

// Steps for the Send dialog
export type PaymentStep = 'input' | 'amount' | 'fee' | 'confirm' | 'processing' | 'result';

// Common fee options structure (e.g., for on-chain fee presets)
export interface FeeOptions {
  fast: number;
  medium: number;
  slow: number;
}

export interface SendInput {
  /** Exactly what the user pasted or scanned. Shown in the input field so it
   *  survives back-navigation (e.g. a full `bitcoin:...?amount=&label=` URI). */
  rawInput: string;
  /** The destination passed to prepareSendPayment. Same as rawInput for bare
   *  inputs; for a BIP21 URI it's the unwrapped bare address/invoice. */
  paymentRequest: string;
  parsedInput: InputType;
}