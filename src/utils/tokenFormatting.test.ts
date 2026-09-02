import { describe, expect, it } from 'vitest';
import { pickQuickAmounts, fixedQuickAmounts } from './tokenFormatting';

// `unitsPerUsd`: 1 for dollars, 150 for a yen-scale currency, and 1000 for
// sats at $100,000 per BTC.
const USD = 1;
const JPY = 150;
const SATS = 1000;

describe('pickQuickAmounts', () => {
  it('offers nothing without a balance or a rate', () => {
    expect(pickQuickAmounts(0, USD)).toEqual([]);
    expect(pickQuickAmounts(0.9, USD)).toEqual([]);
    expect(pickQuickAmounts(1000, 0)).toEqual([]);
  });

  it('scales the whole row with the balance', () => {
    expect(pickQuickAmounts(2, USD)).toEqual([1]);
    expect(pickQuickAmounts(10, USD)).toEqual([1, 2, 5]);
    expect(pickQuickAmounts(130, USD)).toEqual([5, 20, 100]);
    expect(pickQuickAmounts(700, USD)).toEqual([20, 100, 500]);
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
    // $3.48 of stable balance at 1136 sats to the dollar (BTC near $88,000),
    // where 1000 sats is worth $0.88 and a hard $1 floor would drop it.
    expect(pickQuickAmounts(3.48, 1)).toEqual([1, 2]);
    expect(pickQuickAmounts(3.48 * 1136, 1136)).toEqual([1000, 2000]);
  });

  it('follows the BTC price in sats, so the floor stays worth a dollar', () => {
    // 10,000 sats is $10 at $100,000 per BTC, and $2.50 at a quarter of that.
    expect(pickQuickAmounts(10_000, 1000)).toEqual([1000, 2000, 5000]);
    expect(pickQuickAmounts(10_000, 4000)).toEqual([5000]);
  });
});

describe('fixedQuickAmounts', () => {
  it('offers about $1, $5 and $10 in the display currency', () => {
    expect(fixedQuickAmounts(USD)).toEqual([1, 5, 10]);
    expect(fixedQuickAmounts(JPY)).toEqual([200, 1000, 2000]);
    expect(fixedQuickAmounts(0.307)).toEqual([0.5, 2, 5]);
  });

  it('offers nothing without a rate', () => {
    expect(fixedQuickAmounts(0)).toEqual([]);
  });
});
