import { beforeEach, describe, expect, it } from 'vitest';
import type { DepositInfo } from '@breeztech/breez-sdk-spark';
import type { ClaimDepositQuote, FetchClaimDepositQuoteResponse } from '@breeztech/breez-sdk-spark';
import {
  CLAIM_SUBMITTED_LINE,
  forgetAnnouncedClaims,
  markClaimAnnounced,
  takeUnannouncedClaims,
  INSTANT_CLAIM_SUBMITTED_TOAST,
  blocksToWait,
  earlyOption,
  formatWait,
  isClaimable,
  isClaimInFlight,
  selectOption,
  splitClaimedDeposits,
} from './depositClaimQuote';

beforeEach(() => forgetAnnouncedClaims());

const option = (confirmationsRequired: number, feeSats = 100): ClaimDepositQuote =>
  ({ confirmationsRequired, feeSats, creditAmountSats: 1_000 - feeSats, isEstimate: false }) as ClaimDepositQuote;

const quoteOf = (instant: ClaimDepositQuote | null, mature: ClaimDepositQuote) =>
  ({ instant: instant ?? undefined, mature, confirmations: 0 }) as FetchClaimDepositQuoteResponse;

const deposit = (submitted: boolean): DepositInfo => ({
  txid: 'a'.repeat(64),
  vout: 0,
  amountSats: 1_000,
  isMature: !submitted,
  ...(submitted ? { instantClaimStatus: { type: 'submitted' as const, claimId: 'c' } } : {}),
}) as DepositInfo;

describe('the claimedDeposits split', () => {
  it('counts an early claim as submitted, not credited', () => {
    expect(splitClaimedDeposits([deposit(true)])).toMatchObject({ settled: 0 });
    expect(splitClaimedDeposits([deposit(true)]).submitted).toHaveLength(1);
  });

  it('counts a claim at maturity as settled', () => {
    expect(splitClaimedDeposits([deposit(false)])).toMatchObject({ settled: 1 });
    expect(splitClaimedDeposits([deposit(false)]).submitted).toEqual([]);
  });

  it('separates a mixed batch, so neither is reported as the other', () => {
    const split = splitClaimedDeposits([deposit(true), deposit(false), deposit(true)]);
    expect(split.submitted).toHaveLength(2);
    expect(split.settled).toBe(1);
  });
});

describe('submitted-claim copy', () => {
  it('says the same thing in the sheet as in the toast', () => {
    // Composed from the toast so the two cannot drift apart.
    expect(CLAIM_SUBMITTED_LINE).toContain(INSTANT_CLAIM_SUBMITTED_TOAST.detail);
  });
});

describe('waiting on confirmations', () => {
  it('counts the gap to the unlock depth, not the depth itself', () => {
    expect(blocksToWait(option(3), 1)).toBe(2);
  });

  it('never goes negative once the deposit is deeper than the option needs', () => {
    expect(blocksToWait(option(3), 9)).toBe(0);
    expect(isClaimable(option(3), 9)).toBe(true);
  });

  it('is not claimable while any gap remains', () => {
    expect(isClaimable(option(3), 2)).toBe(false);
  });
});

describe('formatWait', () => {
  it('says nothing when there is nothing left to wait for', () => {
    expect(formatWait(0)).toBeNull();
    expect(formatWait(-1)).toBeNull();
  });

  it('stays in minutes below the hour', () => {
    expect(formatWait(1)).toBe('~10 min');
    expect(formatWait(5)).toBe('~50 min');
  });

  it('switches to hours at the hour, dropping the decimal when it is whole', () => {
    expect(formatWait(6)).toBe('~1 hr');
    expect(formatWait(12)).toBe('~2 hr');
  });

  it('keeps one decimal for a part hour', () => {
    expect(formatWait(7)).toBe('~1.2 hr');
  });
});

describe('earlyOption', () => {
  it('is absent without a quote at all', () => {
    expect(earlyOption(null)).toBeNull();
  });

  it('is absent when the provider declined to front the deposit', () => {
    expect(earlyOption(quoteOf(null, option(3)))).toBeNull();
  });

  it('is absent when it unlocks no sooner than simply waiting', () => {
    expect(earlyOption(quoteOf(option(3), option(3)))).toBeNull();
  });

  it('is offered when it genuinely arrives first', () => {
    expect(earlyOption(quoteOf(option(0), option(3)))).toMatchObject({ confirmationsRequired: 0 });
  });
});

describe('selectOption', () => {
  it('resolves to nothing without a quote', () => {
    expect(selectOption(null, true)).toBeNull();
  });

  it('follows the preference when both routes are real', () => {
    const q = quoteOf(option(0, 500), option(3, 100));
    expect(selectOption(q, true)).toMatchObject({ feeSats: 500 });
    expect(selectOption(q, false)).toMatchObject({ feeSats: 100 });
  });

  it('falls back to waiting when early is preferred but not on offer', () => {
    expect(selectOption(quoteOf(null, option(3, 100)), true)).toMatchObject({ feeSats: 100 });
  });
});

describe('isClaimInFlight', () => {
  it('is true only for a submitted claim', () => {
    expect(isClaimInFlight({ type: 'submitted', claimId: 'c' })).toBe(true);
    expect(isClaimInFlight({ type: 'declined' })).toBe(false);
    expect(isClaimInFlight(undefined)).toBe(false);
  });
});

describe('announced claims', () => {
  it('hands a claim over exactly once, however often sync repeats it', () => {
    const d = deposit(true);
    expect(takeUnannouncedClaims([d])).toEqual([d]);
    expect(takeUnannouncedClaims([d])).toEqual([]);
  });

  it('keys on the outpoint, so a second vout is its own claim', () => {
    const d = deposit(true);
    takeUnannouncedClaims([d]);
    expect(takeUnannouncedClaims([{ ...d, vout: 1 }])).toHaveLength(1);
  });

  it('passes over one the sheet announced itself', () => {
    const d = deposit(true);
    markClaimAnnounced(d);
    expect(takeUnannouncedClaims([d])).toEqual([]);
  });

  it('separates the new from the repeated within one batch', () => {
    const first = deposit(true);
    const second = { ...first, vout: 1 };
    takeUnannouncedClaims([first]);
    expect(takeUnannouncedClaims([first, second])).toEqual([second]);
  });

  it('forgets everything when the wallet changes', () => {
    const d = deposit(true);
    takeUnannouncedClaims([d]);
    forgetAnnouncedClaims();
    expect(takeUnannouncedClaims([d])).toEqual([d]);
  });
});
