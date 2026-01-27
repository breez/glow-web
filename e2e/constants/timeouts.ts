/**
 * Shared timeouts for E2E tests (in milliseconds).
 *
 * These are maximum wait times — tests should normally complete well
 * within these limits on regtest.
 */
export const TIMEOUTS = {
  SDK_INIT: 60_000,       // 1 min  — WASM SDK initialization
  WALLET_LOAD: 90_000,    // 90s    — wallet restore / create
  PAYMENT: 60_000,        // 60s    — payment processing
  ADDRESS_GEN: 10_000,    // 10s    — address generation
  UI_ACTION: 10_000,      // 10s    — UI interactions
  BALANCE_SYNC: 90_000,   // 90s    — balance synchronization
  FAUCET_WAIT: 90_000,    // 90s    — wait for faucet funds
  BENCHMARK_RUN: 300_000, // 5 min  — full benchmark runs
};
