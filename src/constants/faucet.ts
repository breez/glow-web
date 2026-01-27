/**
 * Spark Regtest Faucet Constants
 *
 * Shared constants for faucet operations used by both:
 * - Browser faucet service (src/services/faucetService.ts)
 * - E2E test faucet utility (e2e/utils/faucet.ts)
 */

/** Default Spark Regtest faucet API URL */
export const DEFAULT_FAUCET_URL = 'https://api.lightspark.com/graphql/spark/rc';

/** Default seed for reproducible benchmarks. */
export const DEFAULT_SEED = 12345;

/** Default number of payments per benchmark run. */
export const DEFAULT_PAYMENT_COUNT = 100;

/**
 * Default amount range in satoshis.
 * Kept small to allow many payments within a single 50k deposit.
 */
export const DEFAULT_MIN_AMOUNT = 100;
export const DEFAULT_MAX_AMOUNT = 2000;

/** Default delay range between payments in milliseconds. */
export const DEFAULT_MIN_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 3000;

/** Maximum initial funding amount (single deposit limit). */
export const MAX_INITIAL_FUNDING = 50000;

/** How often the receiver sends funds back to sender (every N payments). */
export const DEFAULT_RETURN_INTERVAL = 5;

/** Minimum balance threshold - if below this, attempt to fund (10k sats) */
export const MIN_TEST_BALANCE_SATS = 10000;
