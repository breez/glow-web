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
  rawInput: string;
  parsedInput: InputType;
}