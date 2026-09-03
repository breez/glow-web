import { describe, it, expect } from 'vitest';
import { parseCrossChainAmount, formatCrossChainAmount } from './crossChainFormat';

describe('parseCrossChainAmount', () => {
  it('scales a whole dollar value', () => {
    expect(parseCrossChainAmount('1', 6)).toBe(1_000_000n);
    expect(parseCrossChainAmount('1', 18)).toBe(1_000_000_000_000_000_000n);
  });

  it('scales cents', () => {
    expect(parseCrossChainAmount('10.55', 6)).toBe(10_550_000n);
    expect(parseCrossChainAmount('0.01', 6)).toBe(10_000n);
  });

  // The reason this doesn't scale through Number: the float path is exact for
  // small values and silently wrong past 2^53, so testing $1 proves nothing.
  it('stays exact where float scaling drifts', () => {
    expect(parseCrossChainAmount('99999.99', 18)).toBe(99_999_990_000_000_000_000_000n);
    expect(BigInt(Math.round(99999.99 * 10 ** 18))).not.toBe(99_999_990_000_000_000_000_000n);
  });

  it('truncates fraction digits finer than the asset', () => {
    expect(parseCrossChainAmount('1.239', 2)).toBe(123n);
  });

  it('handles a bare fraction and an empty value', () => {
    expect(parseCrossChainAmount('.5', 6)).toBe(500_000n);
    expect(parseCrossChainAmount('', 6)).toBe(0n);
  });

  it('round-trips through formatCrossChainAmount', () => {
    for (const [value, decimals] of [['10.55', 6], ['1', 18], ['0.01', 6]] as const) {
      expect(formatCrossChainAmount(parseCrossChainAmount(value, decimals), decimals))
        .toBe(String(Number(value)));
    }
  });
});
