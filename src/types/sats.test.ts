import { describe, it, expect } from 'vitest';
import { toSats, toSdkAmountNumber, MAX_SATS, addSats, gtSats, ZERO_SATS } from './sats';

describe('toSats', () => {
  it('accepts valid bigint values', () => {
    expect(toSats(0n)).toBe(0n);
    expect(toSats(1n)).toBe(1n);
    expect(toSats(100_000_000n)).toBe(100_000_000n);
    expect(toSats(MAX_SATS)).toBe(MAX_SATS);
  });

  it('accepts valid integer numbers', () => {
    expect(toSats(0)).toBe(0n);
    expect(toSats(100_000)).toBe(100_000n);
    expect(toSats(Number(MAX_SATS))).toBe(MAX_SATS);
  });

  it('rejects values above MAX_SATS even when within MAX_SAFE_INTEGER', () => {
    // MAX_SAFE_INTEGER (~9e15) is far above MAX_SATS (2.1e15), so anything
    // between them must still be rejected.
    expect(toSats(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it('rejects negative values', () => {
    expect(toSats(-1n)).toBeNull();
    expect(toSats(-1)).toBeNull();
  });

  it('rejects non-integer numbers', () => {
    expect(toSats(1.5)).toBeNull();
    expect(toSats(NaN)).toBeNull();
    expect(toSats(Infinity)).toBeNull();
    expect(toSats(-Infinity)).toBeNull();
  });

  it('rejects values above the 21M BTC cap', () => {
    expect(toSats(MAX_SATS + 1n)).toBeNull();
    expect(toSats(MAX_SATS * 2n)).toBeNull();
  });
});

describe('toSdkAmountNumber', () => {
  it('converts safe Sats to a Number', () => {
    expect(toSdkAmountNumber(0n as never)).toBe(0);
    expect(toSdkAmountNumber(100_000n as never)).toBe(100_000);
    expect(toSdkAmountNumber(MAX_SATS)).toBe(Number(MAX_SATS));
  });

  it('returns null for values exceeding MAX_SAFE_INTEGER (defensive)', () => {
    // toSats() prevents this in normal flow, but the helper is a backstop.
    const overflow = (BigInt(Number.MAX_SAFE_INTEGER) + 1n) as never;
    expect(toSdkAmountNumber(overflow)).toBeNull();
  });
});

describe('arithmetic helpers', () => {
  it('addSats adds two Sats values', () => {
    const a = toSats(100n)!;
    const b = toSats(200n)!;
    expect(addSats(a, b)).toBe(300n);
  });

  it('gtSats compares Sats values', () => {
    const a = toSats(100n)!;
    const b = toSats(200n)!;
    expect(gtSats(b, a)).toBe(true);
    expect(gtSats(a, b)).toBe(false);
    expect(gtSats(a, a)).toBe(false);
  });

  it('ZERO_SATS is zero', () => {
    expect(ZERO_SATS).toBe(0n);
  });
});
