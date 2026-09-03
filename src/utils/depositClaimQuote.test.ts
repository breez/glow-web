import { describe, expect, it } from 'vitest';
import type { DepositInfo } from '@breeztech/breez-sdk-spark';
import { CLAIM_SUBMITTED_LINE, INSTANT_CLAIM_SUBMITTED_TOAST, splitClaimedDeposits } from './depositClaimQuote';

const deposit = (submitted: boolean): DepositInfo => ({
  txid: 'a'.repeat(64),
  vout: 0,
  amountSats: 1_000,
  isMature: !submitted,
  ...(submitted ? { instantClaimStatus: { type: 'submitted' as const, claimId: 'c' } } : {}),
}) as DepositInfo;

describe('the claimedDeposits split', () => {
  it('counts an early claim as submitted, not credited', () => {
    expect(splitClaimedDeposits([deposit(true)])).toEqual({ submitted: 1, settled: 0 });
  });

  it('counts a claim at maturity as settled', () => {
    expect(splitClaimedDeposits([deposit(false)])).toEqual({ submitted: 0, settled: 1 });
  });

  it('separates a mixed batch, so neither is reported as the other', () => {
    expect(splitClaimedDeposits([deposit(true), deposit(false), deposit(true)]))
      .toEqual({ submitted: 2, settled: 1 });
  });
});

describe('submitted-claim copy', () => {
  it('says the same thing in the sheet as in the toast', () => {
    // Composed from the toast so the two cannot drift apart.
    expect(CLAIM_SUBMITTED_LINE).toContain(INSTANT_CLAIM_SUBMITTED_TOAST.detail);
  });
});
