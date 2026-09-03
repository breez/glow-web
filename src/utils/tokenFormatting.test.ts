import { describe, it, expect } from 'vitest';
import type { Payment } from '@breeztech/breez-sdk-spark';
import {
  withAssetDecimals,
  formatTokenAmount,
  getTokenAmountFromPayment,
  type TokenDisplayConfig,
} from './tokenFormatting';

/** The wallet's stable balance: USD presentation at USDB's 6 decimals. */
const usdbConfig: TokenDisplayConfig = {
  symbol: '$',
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
      estimatedOut: '3010850000000000000',
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
      from: { chain: { type: 'spark' }, asset: { ticker: 'BTC', decimals: 0 }, amount: '3915', fee: '0' },
      to: {
        chain: { type: 'external', name: 'bsc' },
        asset: { ticker: 'USDT', decimals: 18 },
        amount: '3010850000000000000',
        fee: '26097715000000000',
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
      estimatedOut: '3010850000000000000',
      deliveredAmount: '3010850000000000000',
      feeAmount: '26097715000000000',
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
