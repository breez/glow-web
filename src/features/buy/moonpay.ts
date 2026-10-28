import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '../../services/logger';
import { formatError } from '../../utils/formatError';
import { parseCrossChainAmount } from '../../utils/crossChainFormat';

/** `MoonpayDelivery.crossChain` takes USD in 6-decimal base units ($1 is 1_000_000). */
const USD_DECIMALS = 6;

export const MOONPAY_QUICK_AMOUNTS_USD = [50, 100, 200];

/** MoonPay's own floor for USDC on Solana: its checkout refuses anything smaller. */
const MIN_MOONPAY_AMOUNT_USD = 20;
const MIN_MOONPAY_AMOUNT = BigInt(MIN_MOONPAY_AMOUNT_USD) * 10n ** BigInt(USD_DECIMALS);

/** Why `amount` cannot be bought, or null when it can. */
export function moonpayAmountError(amount: bigint): string | null {
  return amount < MIN_MOONPAY_AMOUNT ? `Amount must be at least $${MIN_MOONPAY_AMOUNT_USD}` : null;
}

/** The typed dollar amount as `MoonpayDelivery.crossChain` expects it, or null if not a positive amount. */
export function parseMoonpayAmount(usdInput: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(usdInput)) return null;
  const amount = parseCrossChainAmount(usdInput, USD_DECIMALS);
  return amount > 0n ? amount : null;
}

/** USDC delivery is faster and cheaper; bitcoin delivery is the fallback when its route is unavailable. */
export async function getMoonpayUrl(sdk: Pick<BreezSdk, 'buyBitcoin'>, amount: bigint): Promise<string> {
  try {
    const response = await sdk.buyBitcoin({ type: 'moonpay', delivery: { type: 'crossChain', amount } });
    return response.url;
  } catch (e) {
    logger.warn(LogCategory.SDK, 'MoonPay USDC delivery unavailable, using bitcoin delivery', { error: formatError(e) });
    const response = await sdk.buyBitcoin({ type: 'moonpay', delivery: { type: 'bitcoin' } });
    return response.url;
  }
}
