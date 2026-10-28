import { describe, it, expect } from 'vitest';
import type { GetInfoResponse } from '@breeztech/breez-sdk-spark';
import {
  failureMatchesMode,
  formatRetryIn,
  isConvertibleAmount,
  msUntilFailureSettles,
  unconvertedBalance,
} from './stableBalanceFailure';

const TOKEN = 'btkn1usdb';

const walletInfo = (balanceSats: number, tokenBalance?: bigint): GetInfoResponse => ({
  balanceSats,
  tokenBalances: new Map(tokenBalance === undefined ? [] : [[TOKEN, { balance: tokenBalance, tokenMetadata: {} }]]),
} as unknown as GetInfoResponse);

describe('failureMatchesMode', () => {
  it('keeps a sweep failure in USD mode only', () => {
    expect(failureMatchesMode({ kind: 'autoConvert' }, true)).toBe(true);
    expect(failureMatchesMode({ kind: 'perReceive' }, true)).toBe(true);
    expect(failureMatchesMode({ kind: 'autoConvert' }, false)).toBe(false);
  });

  it('keeps a switch-back failure in BTC mode only', () => {
    expect(failureMatchesMode({ kind: 'deactivation' }, false)).toBe(true);
    expect(failureMatchesMode({ kind: 'deactivation' }, true)).toBe(false);
  });
});

describe('unconvertedBalance', () => {
  it('is the sats balance for a sweep into USD', () => {
    expect(unconvertedBalance({ kind: 'autoConvert' }, walletInfo(2000, 5n), TOKEN)).toBe(2000n);
  });

  it('is the USD balance for the switch back', () => {
    expect(unconvertedBalance({ kind: 'deactivation' }, walletInfo(2000, 48_200_000n), TOKEN)).toBe(48_200_000n);
  });

  it('is zero when no USD is held', () => {
    expect(unconvertedBalance({ kind: 'deactivation' }, walletInfo(2000), TOKEN)).toBe(0n);
  });
});

describe('isConvertibleAmount', () => {
  it('excludes change below the minimum', () => {
    expect(isConvertibleAmount(300n, 1000n)).toBe(false);
  });

  it('includes an amount at the minimum', () => {
    expect(isConvertibleAmount(1000n, 1000n)).toBe(true);
  });

  // The funds are at the provider awaiting a refund, so neither balance has them.
  it('excludes an empty balance even without a minimum', () => {
    expect(isConvertibleAmount(0n, null)).toBe(false);
  });

  it('treats an unknown minimum as zero', () => {
    expect(isConvertibleAmount(1n, null)).toBe(true);
  });
});

describe('msUntilFailureSettles', () => {
  const now = 1_000_000;

  it('does not settle while something is left to convert', () => {
    expect(msUntilFailureSettles({ kind: 'autoConvert', retryAt: now - 1 }, 5000n, 1000n, now)).toBeNull();
  });

  it('waits out the retry when only change is left', () => {
    expect(msUntilFailureSettles({ kind: 'autoConvert', retryAt: now + 30_000 }, 300n, 1000n, now)).toBe(30_000);
  });

  it('settles at once when the retry has passed', () => {
    expect(msUntilFailureSettles({ kind: 'deactivation', retryAt: now - 5 }, 0n, 1000n, now)).toBe(0);
  });

  it('settles at once without a retry time', () => {
    expect(msUntilFailureSettles({ kind: 'perReceive' }, 0n, 1000n, now)).toBe(0);
  });
});

describe('formatRetryIn', () => {
  const now = 1_000_000;

  it('reads seconds under a minute', () => {
    expect(formatRetryIn(now + 30_000, now)).toBe('in ~30 sec');
  });

  it('reads minutes under an hour', () => {
    expect(formatRetryIn(now + 240_000, now)).toBe('in ~4 min');
  });

  it('reads hours past an hour', () => {
    expect(formatRetryIn(now + 3_600_000, now)).toBe('in ~1 h');
  });

  it('reads as shortly once the time has passed', () => {
    expect(formatRetryIn(now - 1, now)).toBe('shortly');
  });
});
