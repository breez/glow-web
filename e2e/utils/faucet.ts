/**
 * Spark Regtest Faucet Utility (Node.js/E2E)
 *
 * Uses the Spark Regtest faucet API to fund test wallets.
 * Based on: https://github.com/breez/spark-sdk/blob/0.7.10/crates/breez-sdk/breez-itest/src/faucet.rs
 *
 * Note: This utility runs in Node.js (Playwright tests) and uses non-prefixed env vars.
 * This is separate from the browser faucet service (src/services/faucetService.ts)
 * which uses VITE_ prefixed env vars.
 *
 * Environment variables:
 * - FAUCET_URL: Custom faucet URL (default: Spark API)
 * - FAUCET_USERNAME: Faucet auth username
 * - FAUCET_PASSWORD: Faucet auth password
 */

import {
  DEFAULT_FAUCET_URL,
  MIN_TEST_BALANCE_SATS,
  MAX_INITIAL_FUNDING,
} from '../../src/constants/faucet';

// Re-export constants for convenience
export {
  MIN_TEST_BALANCE_SATS,
  MAX_INITIAL_FUNDING,
  DEFAULT_MIN_AMOUNT,
  DEFAULT_MAX_AMOUNT,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
} from '../../src/constants/faucet';

interface FaucetResponse {
  data?: {
    request_regtest_funds: {
      transaction_hash: string;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Fund a wallet address using the Spark Regtest faucet.
 *
 * @param address - The Bitcoin regtest destination address
 * @param amountSats - Amount in satoshis to fund
 * @returns The transaction hash of the funding transaction
 * @throws Error if the faucet request fails
 */
export async function fundWallet(
  address: string,
  amountSats: number
): Promise<string> {
  const faucetUrl = process.env.FAUCET_URL || DEFAULT_FAUCET_URL;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add Basic Auth if credentials are provided
  if (process.env.FAUCET_USERNAME && process.env.FAUCET_PASSWORD) {
    const auth = Buffer.from(
      `${process.env.FAUCET_USERNAME}:${process.env.FAUCET_PASSWORD}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  const response = await fetch(faucetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: `mutation RequestRegtestFunds($address: String!, $amount_sats: Long!) {
        request_regtest_funds(input: {address: $address, amount_sats: $amount_sats}) {
          transaction_hash
        }
      }`,
      variables: { address, amount_sats: amountSats },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Faucet HTTP error: ${response.status} ${response.statusText}`
    );
  }

  const result: FaucetResponse = await response.json();

  if (result.errors?.length) {
    throw new Error(`Faucet error: ${result.errors[0].message}`);
  }

  if (!result.data?.request_regtest_funds?.transaction_hash) {
    throw new Error('Faucet returned no transaction hash');
  }

  return result.data.request_regtest_funds.transaction_hash;
}

/**
 * Wait for a wallet to receive funds by polling its balance.
 * This is useful after funding to ensure the transaction is confirmed.
 *
 * @param checkBalance - Function that returns the current balance
 * @param expectedMinBalance - Minimum balance to wait for
 * @param timeoutMs - Maximum time to wait (default: 60s)
 * @param pollIntervalMs - How often to check (default: 2s)
 */
export async function waitForBalance(
  checkBalance: () => Promise<bigint>,
  expectedMinBalance: bigint,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 2000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const balance = await checkBalance();
    if (balance >= expectedMinBalance) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timeout waiting for balance >= ${expectedMinBalance} sats after ${timeoutMs}ms`
  );
}

/**
 * Check if faucet credentials are configured.
 */
export function isFaucetConfigured(): boolean {
  return !!(process.env.FAUCET_USERNAME && process.env.FAUCET_PASSWORD);
}
