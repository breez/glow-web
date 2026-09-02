import type { TokenMetadata, FiatCurrency, Payment } from '@breeztech/breez-sdk-spark';
import { toSats, type Sats } from '../types/sats';
import { isCrossChainPayment } from './paymentDescription';

export interface TokenDisplayConfig {
  symbol: string;
  /** Code to name the unit in prose ("Enter amount in USD"), where the symbol
   *  reads as decoration rather than a unit. Falls back to the token ticker. */
  currencyCode: string;
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
 * Build a token-less display config for a pure fiat currency (e.g. "USD").
 *
 * Used for fiat entry without a stable-balance token (the USD toggle on BTC
 * sends, cross-chain "Send USD") so a BTC-balance user can type a dollar
 * amount without holding a USD token. There's no token here,
 * so `decimals` equals `fractionSize` (the minor unit *is* the base unit). The
 * USD amount is converted to sats client-side via `btcFiatRate` (the SDK build
 * on this branch has no fiat-amount model), so only `symbol`/`fractionSize` are
 * needed for input + display.
 *
 * Falls back to USD-like defaults ($, 2dp) when `fiatCurrencies` hasn't loaded.
 */
export function buildFiatDisplayConfig(
  currencyId: string,
  fiatCurrencies: FiatCurrency[]
): TokenDisplayConfig {
  const match = fiatCurrencies.find(c => c.id === currencyId);
  if (match) {
    return {
      symbol: match.info.symbol?.grapheme || match.id,
      currencyCode: match.id,
      symbolPosition: match.info.symbol?.rtl ? 'after' : 'before',
      fractionSize: match.info.fractionSize,
      decimals: match.info.fractionSize,
      fiatCurrencyId: match.id,
      fiatCurrencyName: match.info.name,
    };
  }
  return {
    symbol: currencyId === 'USD' ? '$' : currencyId,
    currencyCode: currencyId,
    symbolPosition: 'before',
    fractionSize: 2,
    decimals: 2,
    fiatCurrencyId: currencyId,
    fiatCurrencyName: null,
  };
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
      currencyCode: bestMatch.id,
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
    currencyCode: tokenMetadata.ticker,
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

/** Inverse of `fiatToSats`. 0 when no rate has loaded. */
export function satsToFiat(sats: number, btcFiatRate: number): number {
  if (btcFiatRate <= 0) return 0;
  return (sats / 100_000_000) * btcFiatRate;
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

  if (payment.conversionDetails?.conversions?.length) {
    // For sends: first conversion's input (e.g., USDB in [AMM, cross-chain])
    // For receives: last conversion's output (e.g., USDB in [cross-chain, AMM])
    const convs = payment.conversionDetails.conversions;
    const isSend = payment.paymentType === 'send';
    const primary = isSend ? convs[0].from : convs[convs.length - 1].to;
    const sideToInfo = (side: typeof primary): TokenPaymentInfo => ({
      amount: BigInt(side.amount),
      fee: BigInt(side.fee),
      metadata: {
        ticker: side.asset.ticker,
        decimals: side.asset.decimals,
      } as TokenMetadata,
    });

    if (primary && primary.asset.ticker !== 'BTC') {
      return sideToInfo(primary);
    }

    // Cross-chain send funded from a BTC balance: the spent side is BTC, but
    // the user sent USD — surface the delivered stablecoin (e.g. USDC) so the
    // amount reads in USD. Gated on cross-chain (orchestra/boltz) so AMM
    // conversions like "Conversion to Bitcoin" keep showing sats.
    //
    // Show the gross, fees-INCLUDED value (delivered + fee) to match the
    // stable-balance "USD Transfer" headline, which is the amount debited from
    // the USD balance (fees-inclusive). `to.amount` is the net delivered
    // stablecoin; `to.fee` is the cross-chain fee on the same side.
    if (isSend && isCrossChainPayment(payment)) {
      const dest = convs[convs.length - 1].to;
      if (dest && dest.asset.ticker !== 'BTC') {
        return {
          amount: BigInt(dest.amount) + BigInt(dest.fee),
          fee: BigInt(dest.fee),
          metadata: {
            ticker: dest.asset.ticker,
            decimals: dest.asset.decimals,
          } as TokenMetadata,
        };
      }
    }
  }

  return null;
}

/** Value a quick amount may be worth, in US dollars (#393). */
const MIN_USD = 1;
const MAX_USD = 1000;

/** How far under `MIN_USD` a rung may sit and still count. Rungs are about 2x
 *  apart, so a hard floor drops the one just below it and nearly doubles the
 *  smallest offer: at 1136 sats to the dollar, 1000 sats is worth $0.88, and
 *  the sat row would start at 2000 while the same balance in fiat starts at $1.
 *  Half a rung of slack keeps the two denominations offering the same steps. */
const MIN_USD_SLACK = Math.SQRT2;

/** Seven digits is where a label stops fitting the four-button row on a phone.
 *  Only binds in a currency whose unit is worth a fraction of a cent, which
 *  gets a lower ceiling in exchange for a row that still lays out. */
const MAX_UNITS = 999_999;

/** Sats per dollar to fall back on before a rate has loaded, so sat quick
 *  amounts still render on a cold start. It only decides which round numbers
 *  get offered, never a conversion, so being off by a price move costs at most
 *  a rung. */
export const FALLBACK_SATS_PER_USD = 1000;

/** Smallest sat amount worth offering. A dollar buys fewer sats as BTC rises,
 *  and without this the row follows it down to ₿500 and then ₿200, which read
 *  as change rather than as amounts. */
export const MIN_SATS_QUICK_AMOUNT = 1000;

/** The denomination a row of quick amounts is drawn in. */
export interface QuickAmountScale {
  /** Units of that denomination in one US dollar. 0 when no rate has loaded. */
  unitsPerUsd: number;
  /** Smallest amount to offer, in the denomination's own units. */
  minUnit: number;
}

/** Share of the balance the largest quick amount may reach. The rest covers the
 *  conversion (10 bps slippage cap plus pool and integrator fees) and a
 *  Lightning base fee, and keeps the top amount off the balance exactly, which
 *  dead-ends on insufficient funds and duplicates Send All. Steps sit about 2x
 *  apart, so a tighter value would rarely change the pick but would remove that
 *  margin. A flat onchain fee is quoted after the amount is picked and can
 *  outrun any proportional reserve. */
const SPENDABLE_HEADROOM = 0.98;

/** Round amounts (1, 2 and 5 times a power of ten) from `min` to `max`, ascending. */
function roundAmountsBetween(min: number, max: number): number[] {
  if (!(min > 0) || !(max >= min)) return [];
  const amounts: number[] = [];
  for (let exponent = Math.floor(Math.log10(min)); 10 ** exponent <= max; exponent++) {
    for (const step of [1, 2, 5]) {
      const amount = step * 10 ** exponent;
      if (amount >= min && amount <= max) amounts.push(amount);
    }
  }
  return amounts;
}

/**
 * The round amounts worth between $1 and $1000 in the unit the user is typing.
 * `unitsPerUsd` is how many of that unit make a dollar: sats per dollar in sats
 * mode, currency units per dollar in fiat mode. Deriving the ladder from the
 * rate is what keeps the amounts round in a currency whose unit is worth a
 * hundredth of a dollar, where a fixed 1 to 1000 ladder would be all dust.
 *
 * Rungs can carry one decimal place in a currency worth more than a dollar per
 * unit. Every such currency has a fraction size of at least 2, so the value is
 * always representable.
 */
function quickAmountLadder({ unitsPerUsd, minUnit }: QuickAmountScale): number[] {
  return roundAmountsBetween(
    Math.max((MIN_USD * unitsPerUsd) / MIN_USD_SLACK, minUnit),
    Math.min(MAX_USD * unitsPerUsd, MAX_UNITS),
  );
}

/**
 * Up to three round quick amounts, scaled to what the user can send.
 * `spendable` is the balance in the unit being typed; 0 for it or for the
 * scale's rate (none loaded yet) offers nothing. `hardCeiling` caps the picks
 * at a destination's own maximum.
 *
 * The largest pick is the biggest round amount inside the headroom, and the
 * other two step down the ladder from it. Anchoring to the top is what makes
 * the row scale: a large balance gets amounts worth sending rather than the
 * ladder's floor, which no balance would ever price out.
 */
export function pickQuickAmounts(
  spendable: number,
  scale: QuickAmountScale,
  hardCeiling = Infinity,
): number[] {
  const ladder = quickAmountLadder(scale);
  // `hardCeiling` is a limit of the destination's own, not of the balance, so
  // it takes no headroom: an amount equal to it is payable.
  const ceiling = Math.min(spendable * SPENDABLE_HEADROOM, hardCeiling);
  const top = ladder.filter((amount) => amount <= ceiling).length - 1;
  // Two rungs apart (roughly 5x) once the balance leaves room for it, so the
  // three cover a range; adjacent rungs when it doesn't. Negative indices fall
  // out, which is also how a balance under the smallest rung returns nothing.
  const stride = top >= 4 ? 2 : 1;
  return [top - 2 * stride, top - stride, top].filter((i) => i >= 0).map((i) => ladder[i]);
}

/**
 * Quick amounts for an input with no balance to scale against (receive): the
 * round amount nearest each of `usdPoints`, which names the values wanted in
 * dollars, ascending.
 */
export function fixedQuickAmounts(scale: QuickAmountScale, usdPoints: number[]): number[] {
  const ladder = quickAmountLadder(scale);
  if (ladder.length === 0) return [];
  const picked: number[] = [];
  for (const usd of usdPoints) {
    const target = usd * scale.unitsPerUsd;
    // Nearest by ratio, not by difference: steps are spaced multiplicatively,
    // so subtracting would pull every point towards the top of the ladder.
    const nearest = ladder.reduce((best, amount) =>
      Math.abs(Math.log(amount / target)) < Math.abs(Math.log(best / target)) ? amount : best);
    const last = picked[picked.length - 1];
    // Step up rather than repeat: in a currency whose unit is worth several
    // dollars, two points can land on one step and spend two buttons on it.
    const choice = last !== undefined && nearest <= last
      ? ladder.find((amount) => amount > last)
      : nearest;
    if (choice !== undefined && choice !== last) picked.push(choice);
  }
  return picked;
}

/** Format a token-denominated quick amount label, respecting symbol position.
 *  Sat-denominated buttons render `SatAmount` instead. */
export function formatQuickAmount(amt: number, config: TokenDisplayConfig): string {
  return config.symbolPosition === 'before'
    ? `${config.symbol}${amt}`
    : `${amt} ${config.symbol}`;
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
