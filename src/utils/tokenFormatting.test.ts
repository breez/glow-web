import { describe, expect, it } from 'vitest';
import { pickQuickAmounts, fixedQuickAmounts, MIN_SATS_QUICK_AMOUNT } from './tokenFormatting';

/** A fiat denomination: `unitsPerUsd` is 1 for dollars, 150 for a yen scale. */
const fiat = (unitsPerUsd: number) => ({ unitsPerUsd, minUnit: 0 });
/** Sats, whose `unitsPerUsd` is sats per dollar: 1000 at $100,000 per BTC. */
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
    // $3.48 of stable balance at 1136 sats to the dollar (BTC near $88,000),
    // where 1000 sats is worth $0.88 and a hard $1 floor would drop it.
    expect(pickQuickAmounts(3.48, USD)).toEqual([1, 2]);
    expect(pickQuickAmounts(3.48 * 1136, sats(1136))).toEqual([1000, 2000]);
  });

  it('follows the BTC price in sats, so the floor stays worth a dollar', () => {
    // 10,000 sats is $10 at $100,000 per BTC, and $2.50 at a quarter of that.
    expect(pickQuickAmounts(10_000, sats(1000))).toEqual([1000, 2000, 5000]);
    expect(pickQuickAmounts(10_000, sats(4000))).toEqual([5000]);
  });

  it('never offers sats below the round minimum, however high BTC goes', () => {
    // At $500,000 a dollar is 200 sats, so an unfloored ladder would start at
    // ₿200. Sat amounts stay in thousands instead.
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
    // At 400 sats to the dollar the $1 point would land on ₿500.
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
