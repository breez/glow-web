import type { Payment } from '@breeztech/breez-sdk-spark';

/** Truncate a long address/string to `start…end` form (default ~42 chars). */
export function truncateAddress(addr: string, maxLen = 42): string {
  if (addr.length <= maxLen) return addr;
  const side = Math.floor((maxLen - 3) / 2);
  return `${addr.slice(0, side)}...${addr.slice(-side)}`;
}

/** Capitalize the first character (e.g. chain name "base" → "Base"). */
export function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Format a base-unit amount in its asset's full precision (trailing zeros trimmed). */
export function formatCrossChainAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/**
 * Format a delivered/received amount to 2 decimal places (estimates, so cents
 * is enough). Rounds via integer math to avoid float precision loss.
 */
export function formatReceiveAmount(amount: bigint, decimals: number): string {
  if (decimals <= 2) return formatCrossChainAmount(amount, decimals);
  const scale = 10n ** BigInt(decimals - 2);
  const hundredths = (amount + scale / 2n) / scale;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}

export interface CrossChainDestination {
  /** External recipient wallet address (only available via conversionInfo). */
  recipientAddress?: string;
  /** Destination chain display name, e.g. "Base". */
  chainName?: string;
  /** Destination asset ticker, e.g. "USDC". */
  assetTicker?: string;
  /** Destination asset contract address, when present. */
  assetContract?: string;
  /** Net amount delivered to the recipient, in the asset's base units. */
  deliveredAmount?: bigint;
  /** Decimals of the delivered asset, for formatting `deliveredAmount`. */
  assetDecimals?: number;
}

/**
 * Extract the destination of a cross-chain payment (the external chain/asset
 * the funds landed on, plus the recipient address). `recipientAddress` lives
 * only on `conversionInfo`; chain/asset prefer `conversionInfo` (works for both
 * Boltz and orchestra) and fall back to the final conversion's `to` side.
 *
 * Returns an object that may be empty — callers should still gate on
 * `isCrossChainPayment` to decide whether to render a destination view.
 */
export function getCrossChainDestination(payment: Payment): CrossChainDestination {
  const details = payment.details;
  const convInfo =
    details && 'conversionInfo' in details ? details.conversionInfo : undefined;

  const dest: CrossChainDestination = {};

  if (convInfo && (convInfo.type === 'orchestra' || convInfo.type === 'boltz')) {
    dest.recipientAddress = convInfo.recipientAddress;
    dest.chainName = convInfo.chain;
    dest.assetTicker = convInfo.asset;
    dest.assetContract = convInfo.assetContract;
    dest.assetDecimals = convInfo.assetDecimals;
    const delivered = convInfo.deliveredAmount ?? convInfo.estimatedOut;
    if (delivered) dest.deliveredAmount = BigInt(delivered);
  }

  // Prefer the final conversion's destination side — it carries the settled
  // amount/decimals — and fall back to it for chain/asset too.
  const conversions = payment.conversionDetails?.conversions;
  const to = conversions?.length ? conversions[conversions.length - 1].to : undefined;
  if (to) {
    if (!dest.chainName && to.chain.type === 'external') dest.chainName = to.chain.name;
    if (!dest.assetTicker) dest.assetTicker = to.asset.ticker;
    if (!dest.assetContract) dest.assetContract = to.asset.identifier;
    dest.deliveredAmount = BigInt(to.amount);
    dest.assetDecimals = to.asset.decimals;
  }

  return dest;
}
