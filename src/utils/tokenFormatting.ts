import type { TokenMetadata, FiatCurrency, Payment } from '@breeztech/breez-sdk-spark';
import { toSats, type Sats } from '../types/sats';

export interface TokenDisplayConfig {
  symbol: string;
  symbolPosition: 'before' | 'after';
  fractionSize: number;
  decimals: number;
  fiatCurrencyId: string | null;
  fiatCurrencyName: string | null;
}

export interface TokenPaymentInfo {
  amount: bigint;
  fee: bigint;
  metadata: TokenMetadata;
}

/**
 * Build a display config by matching the token's ticker to a fiat currency.
 * e.g., USDB ticker → matches "USD" fiat currency → gets $ symbol, fractionSize 2, etc.
 */
export function buildTokenDisplayConfig(
  tokenMetadata: TokenMetadata,
  fiatCurrencies: FiatCurrency[]
): TokenDisplayConfig {
  let bestMatch: FiatCurrency | null = null;
  let bestMatchLength = 0;

  for (const currency of fiatCurrencies) {
    if (
      tokenMetadata.ticker.startsWith(currency.id) &&
      currency.id.length > bestMatchLength
    ) {
      bestMatch = currency;
      bestMatchLength = currency.id.length;
    }
  }

  if (bestMatch) {
    return {
      symbol: bestMatch.info.symbol?.grapheme || bestMatch.id,
      symbolPosition: bestMatch.info.symbol?.rtl ? 'after' : 'before',
      fractionSize: bestMatch.info.fractionSize,
      decimals: tokenMetadata.decimals,
      fiatCurrencyId: bestMatch.id,
      fiatCurrencyName: bestMatch.info.name,
    };
  }

  // Fallback: use currency symbol when fiatCurrencies haven't loaded yet
  const TICKER_SYMBOL_OVERRIDES: Record<string, string> = { USDB: '$' };
  const displayTicker = TICKER_SYMBOL_OVERRIDES[tokenMetadata.ticker] ?? tokenMetadata.ticker;

  return {
    symbol: displayTicker,
    symbolPosition: 'before',
    fractionSize: Math.min(tokenMetadata.decimals, 2),
    decimals: tokenMetadata.decimals,
    fiatCurrencyId: null,
    fiatCurrencyName: null,
  };
}

/**
 * Format raw token units into a display string.
 * e.g., 1234567n with USDB config (decimals=6, fractionSize=2, symbol=$) → "$1.23"
 */
export function formatTokenAmount(
  amount: bigint,
  config: TokenDisplayConfig,
  options?: { fullPrecision?: boolean },
): string {
  const isNegative = amount < 0n;
  const absAmount = isNegative ? -amount : amount;

  const divisor = BigInt(10 ** config.decimals);
  const wholePart = absAmount / divisor;
  const fractionalPart = absAmount % divisor;

  const precision = options?.fullPrecision ? config.decimals : config.fractionSize;
  let fractionalStr = fractionalPart
    .toString()
    .padStart(config.decimals, '0')
    .slice(0, precision);

  // In full precision mode, trim trailing zeros but keep at least fractionSize digits
  if (options?.fullPrecision) {
    fractionalStr = fractionalStr.replace(/0+$/, '');
    if (fractionalStr.length < config.fractionSize) {
      fractionalStr = fractionalStr.padEnd(config.fractionSize, '0');
    }
  }

  const numberStr = `${isNegative ? '-' : ''}${wholePart}.${fractionalStr}`;

  if (config.symbolPosition === 'before') {
    // Use a space between symbol and number for multi-char symbols (tickers like USDB)
    // but not for single-char currency glyphs ($, €, etc.)
    const sep = config.symbol.length > 1 ? ' ' : '';
    return `${config.symbol}${sep}${numberStr}`;
  }
  return `${numberStr} ${config.symbol}`;
}

/** Check if a token amount is positive but would display as zero (e.g. fee < $0.01). */
export function tokenAmountDisplaysAsZero(amount: bigint, config: TokenDisplayConfig): boolean {
  if (amount <= 0n) return false;
  const displayThreshold = BigInt(10 ** (config.decimals - config.fractionSize));
  return amount < displayThreshold;
}

/** Format a token amount as "< $0.01" (minimum displayable unit) for sub-threshold values. */
export function formatTokenAmountMinimum(config: TokenDisplayConfig): string {
  const minUnit = BigInt(10 ** (config.decimals - config.fractionSize));
  return `< ${formatTokenAmount(minUnit, config)}`;
}

/** Convert a fiat amount to sats using the BTC/fiat rate. */
export function fiatToSats(fiatAmount: number, btcFiatRate: number): number {
  if (btcFiatRate <= 0) return 0;
  return Math.round((fiatAmount / btcFiatRate) * 100_000_000);
}

/**
 * Parse a user-entered amount string to a validated `Sats` value.
 * - Token mode: input is fiat (e.g. "10.50") → converts via btcFiatRate
 * - Sats mode: input is integer sats — parsed via BigInt so a 16-digit
 *   string doesn't lose precision before the bounds check
 *
 * Returns null when the input can't produce a positive sats value, or when
 * the result exceeds the absolute Bitcoin max (21M BTC). Callers can rely
 * on a non-null return being safe to pass anywhere in the sats domain.
 */
export function parseAmountToSats(
  input: string,
  isTokenMode: boolean,
  btcFiatRate: number,
): Sats | null {
  if (isTokenMode) {
    if (!btcFiatRate || btcFiatRate <= 0) return null;
    const fiat = Number(input);
    if (!Number.isFinite(fiat) || fiat <= 0) return null;
    // fiat→sats requires float division; convert the rounded result to
    // bigint and let toSats() perform the bounds check.
    const satsNumber = fiatToSats(fiat, btcFiatRate);
    if (!Number.isFinite(satsNumber)) return null;
    if (!Number.isSafeInteger(satsNumber)) return null;
    return toSats(BigInt(satsNumber));
  }
  // Sats mode: parse via BigInt to preserve precision on long inputs, then
  // bounds-check via toSats.
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  let big: bigint;
  try {
    big = BigInt(trimmed);
  } catch {
    return null;
  }
  if (big <= 0n) return null;
  return toSats(big);
}

/**
 * Extract displayable token amount from a payment.
 * - Token payments (details.type === 'token'): amount/fee are in token units
 * - Conversion payments: token step's amount/fee are in token units
 * - Plain BTC: returns null (these get faded styling)
 */
export function getTokenAmountFromPayment(payment: Payment): TokenPaymentInfo | null {
  if (payment.details?.type === 'token') {
    return {
      amount: payment.amount,
      fee: payment.fees,
      metadata: payment.details.metadata,
    };
  }

  if (payment.conversionDetails) {
    const { from, to } = payment.conversionDetails;
    // Use the step matching the payment direction:
    // - send payments: show "from" (what was sent)
    // - receive payments: show "to" (what was received)
    // If the matching step has no token metadata, this is a BTC payment — return null for sats formatting
    const step = payment.paymentType === 'send' ? from : to;
    if (step?.tokenMetadata) {
      return {
        amount: step.amount,
        fee: step.fee,
        metadata: step.tokenMetadata,
      };
    }
  }

  return null;
}

/** Quick amount presets for token-denominated inputs. */
export const TOKEN_QUICK_AMOUNTS = [1, 5, 10];

/** Quick amount presets for sat-denominated inputs. */
export const SATS_QUICK_AMOUNTS = [1000, 10000, 100000];

/** Format a quick amount button label respecting symbol position. */
export function formatQuickAmount(amt: number, config: TokenDisplayConfig | null, isTokenMode: boolean): string {
  if (isTokenMode && config) {
    return config.symbolPosition === 'before'
      ? `${config.symbol}${amt}`
      : `${amt} ${config.symbol}`;
  }
  return `₿${amt.toLocaleString('en-US').replace(/,/g, '\u2009')}`;
}

/**
 * Validate and sanitize a token amount input string.
 * Returns the sanitized value, or null if the input should be rejected.
 */
export function sanitizeTokenInput(value: string, fractionSize: number): string | null {
  if (value === '' || /^\d*\.?\d*$/.test(value)) {
    const parts = value.split('.');
    if (parts[1] && parts[1].length > fractionSize) return null;
    return value;
  }
  return null;
}

/** Get a token's balance and metadata from GetInfoResponse.tokenBalances. */
export function getTokenBalance(
  tokenBalances: Map<string, { balance: bigint; tokenMetadata: TokenMetadata }>,
  tokenIdentifier: string
): { balance: bigint; metadata: TokenMetadata } | null {
  const entry = tokenBalances.get(tokenIdentifier);
  if (!entry) return null;
  return { balance: entry.balance, metadata: entry.tokenMetadata };
}
