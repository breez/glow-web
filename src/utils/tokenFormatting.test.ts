import { describe, expect, it } from 'vitest';
import type { Payment } from '@breeztech/breez-sdk-spark';
import {
  pickQuickAmounts,
  fixedQuickAmounts,
  MIN_SATS_QUICK_AMOUNT,
  withAssetDecimals,
  formatTokenAmount,
  getTokenAmountFromPayment,
  type TokenDisplayConfig,
} from './tokenFormatting';

/** A fiat denomination: `unitsPerUsd` is 1 for dollars, 150 for a yen scale. */
const fiat = (unitsPerUsd: number) => ({ unitsPerUsd, minUnit: 0 });
/** Sats, whose `unitsPerUsd` is sats per dollar. */
const sats = (unitsPerUsd = 1000) => ({ unitsPerUsd, minUnit: MIN_SATS_QUICK_AMOUNT });

const USD = fiat(1);
const JPY = fiat(150);
const SATS = sats();

describe('pickQuickAmounts', () => {
  it('offers nothing without a balance or a rate', () => {
    expect(pickQuickAmounts(0, USD)).toEqual([]);
    expect(pickQuickAmounts(0.9, USD)).toEqual([]);
    expect(pickQuickAmounts(1000, fiat(0))).toEqual([]);
  });

  it('scales the whole row with the balance', () => {
    expect(pickQuickAmounts(2, USD)).toEqual([1]);
    expect(pickQuickAmounts(10, USD)).toEqual([1, 2, 5]);
    expect(pickQuickAmounts(130, USD)).toEqual([5, 20, 100]);
    expect(pickQuickAmounts(700, USD)).toEqual([20, 100, 500]);
    expect(pickQuickAmounts(30_000, SATS)).toEqual([1000, 5000, 20_000]);
    expect(pickQuickAmounts(700_000, SATS)).toEqual([20_000, 100_000, 500_000]);
  });

  it('keeps the largest pick clear of the balance, which is Send All', () => {
    expect(pickQuickAmounts(1000, USD)).not.toContain(1000);
    expect(pickQuickAmounts(500_000, SATS)).not.toContain(500_000);
  });

  it('treats a destination maximum as its own limit, with no headroom taken', () => {
    // An LNURL max of $500 is payable in full, unlike $500 of balance.
    expect(pickQuickAmounts(1_000_000, USD, 500)).toContain(500);
    expect(pickQuickAmounts(500, USD)).not.toContain(500);
  });

  it('caps the value at $1000 however large the balance', () => {
    expect(pickQuickAmounts(1_000_000, USD)).toEqual([50, 200, 1000]);
    expect(pickQuickAmounts(100_000_000, SATS)).toEqual([20_000, 100_000, 500_000]);
  });

  it('offers amounts worth having in a currency whose unit is worth a cent', () => {
    // ¥1 is under a cent, so the ladder starts where a dollar of value does.
    expect(pickQuickAmounts(1500, JPY)).toEqual([200, 500, 1000]);
    expect(pickQuickAmounts(100_000, JPY)).toEqual([2000, 10_000, 50_000]);
  });

  it('offers the same steps in either denomination', () => {
    // A stable balance at 1136 sats to the dollar, where ₿1 000 is worth just
    // under a dollar and a hard floor would drop it.
    expect(pickQuickAmounts(3.48, USD)).toEqual([1, 2]);
    expect(pickQuickAmounts(3.48 * 1136, sats(1136))).toEqual([1000, 2000]);
  });

  it('follows the BTC price in sats, so the floor stays worth a dollar', () => {
    // The same sats are worth a quarter as much at four times the sats per dollar.
    expect(pickQuickAmounts(10_000, sats(1000))).toEqual([1000, 2000, 5000]);
    expect(pickQuickAmounts(10_000, sats(4000))).toEqual([5000]);
  });

  it('never offers sats below the round minimum, however high BTC goes', () => {
    // At 200 sats to the dollar an unfloored ladder would start at ₿200. Sat
    // amounts stay in thousands instead.
    expect(pickQuickAmounts(30_000, sats(200))).toEqual([1000, 5000, 20_000]);
    expect(pickQuickAmounts(3000, sats(200))).toEqual([1000, 2000]);
  });
});

describe('fixedQuickAmounts', () => {
  it('offers the round amount nearest each named value', () => {
    expect(fixedQuickAmounts(USD, [1, 5, 10])).toEqual([1, 5, 10]);
    expect(fixedQuickAmounts(JPY, [1, 5, 10])).toEqual([200, 1000, 2000]);
    expect(fixedQuickAmounts(fiat(0.307), [1, 5, 10])).toEqual([0.5, 2, 5]);
  });

  it('holds the sat points at their value as the BTC price moves', () => {
    expect(fixedQuickAmounts(sats(1000), [1, 10, 100])).toEqual([1000, 10_000, 100_000]);
    // Buy's points, the same values in either denomination.
    expect(fixedQuickAmounts(sats(1000), [20, 50, 100])).toEqual([20_000, 50_000, 100_000]);
    expect(fixedQuickAmounts(USD, [20, 50, 100])).toEqual([20, 50, 100]);
  });

  it('holds the sat minimum rather than follow a dollar down', () => {
    // At 400 sats to the dollar the lowest point would land on ₿500.
    expect(fixedQuickAmounts(sats(400), [1, 10, 100])).toEqual([1000, 5000, 50_000]);
  });

  it('keeps the points on separate steps when the ladder is coarse', () => {
    // A unit worth several dollars puts $5 and $10 on the same step.
    expect(fixedQuickAmounts(fiat(0.307), [1, 5, 10])).toEqual([0.5, 2, 5]);
    expect(fixedQuickAmounts(USD, [1, 1.1])).toEqual([1, 2]);
  });

  it('offers nothing without a rate', () => {
    expect(fixedQuickAmounts(fiat(0), [1, 5, 10])).toEqual([]);
  });
});

/** The wallet's stable balance: USD presentation at USDB's 6 decimals. */
const usdbConfig: TokenDisplayConfig = {
  symbol: '$',
  currencyCode: 'USD',
  symbolPosition: 'before',
  fractionSize: 2,
  decimals: 6,
  fiatCurrencyId: 'USD',
  fiatCurrencyName: 'US Dollar',
};

describe('withAssetDecimals', () => {
  it('keeps presentation and swaps precision', () => {
    const c = withAssetDecimals(usdbConfig, 18);
    expect(c.decimals).toBe(18);
    expect(c.symbol).toBe('$');
    expect(c.fractionSize).toBe(2);
  });

  it('returns the same object when the precision already matches', () => {
    expect(withAssetDecimals(usdbConfig, 6)).toBe(usdbConfig);
  });
});

describe('formatTokenAmount', () => {
  it('writes no decimal point for a currency without minor units', () => {
    const yen: TokenDisplayConfig = { ...usdbConfig, symbol: '\u00a5', fractionSize: 0, decimals: 0 };
    expect(formatTokenAmount(7801n, yen)).toBe('\u00a57801');
    expect(formatTokenAmount(7801n, yen, { fullPrecision: true })).toBe('\u00a57801');
  });
});

// A cross-chain send funded from BTC, delivered as USDT on an 18-decimal
// chain. `getTokenAmountFromPayment` surfaces the delivered asset so the row
// reads in USD, which pairs an 18-decimal amount with the 6-decimal stable
// config: formatting the two together overstates the amount by 10^12.
const crossChainSendFromBtc = {
  id: 'p1',
  paymentType: 'send',
  status: 'completed',
  amount: 3915n,
  fees: 0n,
  timestamp: 0,
  method: 'spark',
  details: {
    type: 'spark',
    conversionInfo: {
      type: 'orchestra',
      chain: 'bsc',
      recipientAddress: '0xrecipient',
      estimatedOut: 3_010_850_000_000_000_000n,
      status: 'completed',
      assetDecimals: 18,
      orderId: 'o1',
      quoteId: 'q1',
    },
  },
  conversionDetails: {
    status: 'completed',
    conversions: [{
      provider: 'orchestra',
      status: 'completed',
      from: { chain: { type: 'spark' }, asset: { ticker: 'BTC', decimals: 0 }, amount: 3_915n, fee: 0n },
      to: {
        chain: { type: 'external', name: 'bsc' },
        asset: { ticker: 'USDT', decimals: 18 },
        amount: 3_010_850_000_000_000_000n,
        fee: 26_097_715_000_000_000n,
      },
    }],
  },
} as unknown as Payment;

describe('cross-chain amount under an active stable balance', () => {
  it('surfaces the delivered asset at its own precision', () => {
    const info = getTokenAmountFromPayment(crossChainSendFromBtc);
    expect(info).not.toBeNull();
    // Gross: delivered + cross-chain fee.
    expect(info!.amount).toBe(3_036_947_715_000_000_000n);
    expect(info!.metadata.decimals).toBe(18);
  });

  it('formats as dollars, not 10^12 dollars', () => {
    const info = getTokenAmountFromPayment(crossChainSendFromBtc)!;
    const config = withAssetDecimals(usdbConfig, info.metadata.decimals);
    expect(formatTokenAmount(info.amount, config)).toBe('$3.03');
    // What the un-adjusted stable config produced.
    expect(formatTokenAmount(info.amount, usdbConfig)).toBe('$3036947715000.00');
  });
});

/** The same leg with no settled `conversions`, as the provider reported it.
 *  deliveredAmount + feeAmount reproduces the gross the conversions path gives. */
const crossChainSendNoLegs = {
  ...crossChainSendFromBtc,
  details: {
    type: 'spark',
    conversionInfo: {
      type: 'orchestra',
      chain: 'bsc',
      asset: 'USDT',
      assetDecimals: 18,
      recipientAddress: '0xrecipient',
      estimatedOut: 3_010_850_000_000_000_000n,
      deliveredAmount: 3_010_850_000_000_000_000n,
      feeAmount: 26_097_715_000_000_000n,
      status: 'completed',
      orderId: 'o1',
      quoteId: 'q1',
    },
  },
  conversionDetails: undefined,
} as unknown as Payment;

describe('conversionInfo fallback when conversions are absent', () => {
  it('derives the amount at the leg\'s own precision', () => {
    const info = getTokenAmountFromPayment(crossChainSendNoLegs);
    expect(info).not.toBeNull();
    expect(info!.metadata.decimals).toBe(18);
    expect(info!.metadata.ticker).toBe('USDT');
  });

  it('agrees with the conversions path on the same leg', () => {
    const viaLegs = getTokenAmountFromPayment(crossChainSendFromBtc)!;
    const viaInfo = getTokenAmountFromPayment(crossChainSendNoLegs)!;
    expect(viaInfo.amount).toBe(viaLegs.amount);
    expect(viaInfo.metadata.decimals).toBe(viaLegs.metadata.decimals);
  });

  it('formats as dollars instead of falling back to sats', () => {
    const info = getTokenAmountFromPayment(crossChainSendNoLegs)!;
    const config = withAssetDecimals(usdbConfig, info.metadata.decimals);
    expect(formatTokenAmount(info.amount, config)).toBe('$3.03');
  });

  it('stays null for an AMM conversion, which keeps showing sats', () => {
    const amm = {
      ...crossChainSendNoLegs,
      details: {
        type: 'spark',
        conversionInfo: { type: 'amm', poolId: 'p', conversionId: 'c', status: 'completed' },
      },
    } as unknown as Payment;
    expect(getTokenAmountFromPayment(amm)).toBeNull();
  });

  it('stays null for a BTC leg and when the ticker is missing', () => {
    const mk = (over: Record<string, unknown>) => ({
      ...crossChainSendNoLegs,
      details: {
        type: 'spark',
        conversionInfo: {
          ...(crossChainSendNoLegs.details as { conversionInfo: Record<string, unknown> }).conversionInfo,
          ...over,
        },
      },
    } as unknown as Payment);
    expect(getTokenAmountFromPayment(mk({ asset: 'BTC' }))).toBeNull();
    expect(getTokenAmountFromPayment(mk({ asset: undefined }))).toBeNull();
  });

  it('stays null on a receive, where conversionInfo is the source leg', () => {
    const recv = { ...crossChainSendNoLegs, paymentType: 'receive' } as unknown as Payment;
    expect(getTokenAmountFromPayment(recv)).toBeNull();
  });
});
