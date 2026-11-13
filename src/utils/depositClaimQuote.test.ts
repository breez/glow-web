import { describe, expect, it } from 'vitest';
import type { DepositInfo } from '@breeztech/breez-sdk-spark';
import type { ClaimDepositQuote, FetchClaimDepositQuoteResponse } from '@breeztech/breez-sdk-spark';
import {
  claimSubmittedLine,
  autoClaimsEarly,
  blocksToWait,
  ceilingForWait,
  claimCeilingSats,
  earlyOption,
  earlyClaimCeiling,
  formatWait,
  isClaimable,
  isClaimInFlight,
  selectOption,
  splitClaimedDeposits,
} from './depositClaimQuote';


const option = (confirmationsRequired: number, feeSats = 100): ClaimDepositQuote =>
  ({ confirmationsRequired, feeSats, creditAmountSats: 1_000 - feeSats, isEstimate: false }) as ClaimDepositQuote;

const quoteOf = (instant: ClaimDepositQuote | null, mature: ClaimDepositQuote, confirmations = 0) =>
  ({ instant: instant ?? undefined, mature, confirmations }) as FetchClaimDepositQuoteResponse;

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
  it('tells the user the funds are on their way', () => {
    expect(claimSubmittedLine()).toBe('Claim submitted. Funds will arrive shortly.');
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

  it('counts blocks, singular and plural, and glosses each in minutes', () => {
    expect(formatWait(1)).toBe('1 confirmation (~10 mins)');
    expect(formatWait(2)).toBe('2 confirmations (~20 mins)');
  });

  // The count leads because it is the exact part. Minutes on their own would
  // read as a countdown that never counts down: block arrival is memoryless, so
  // twenty minutes into a two-block wait the expectation is still two blocks.
  it('leads with the count and keeps the time approximate', () => {
    expect(formatWait(3)).toMatch(/^3 confirmations \(~/);
    expect(formatWait(3)).toContain('~30 mins');
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

  // Paying the spread at maturity depth buys one sync cycle at many times the
  // fee the SDK is about to pay on its own.
  it('is withdrawn once the automatic claim is already due', () => {
    expect(earlyOption(quoteOf(option(1), option(3), 3))).toBeNull();
  });
});

describe('selectOption', () => {
  it('resolves to nothing without a quote', () => {
    expect(selectOption(null)).toBeNull();
  });

  it('prices the early route once it can actually be claimed', () => {
    expect(selectOption(quoteOf(option(0, 500), option(3, 100)))).toMatchObject({ feeSats: 500 });
  });

  // Priced before it unlocks, the early route would headline the proceeds of a
  // purchase the user cannot make, against a wait that is what will happen.
  it('prices the wait while the early route is still locked', () => {
    expect(selectOption(quoteOf(option(2, 500), option(3, 100)))).toMatchObject({ feeSats: 100 });
  });

  it('prices the wait when no early route is on offer', () => {
    expect(selectOption(quoteOf(null, option(3, 100)))).toMatchObject({ feeSats: 100 });
  });
});

describe('isClaimInFlight', () => {
  it('is true only for a submitted claim', () => {
    expect(isClaimInFlight({ type: 'submitted', claimId: 'c' })).toBe(true);
    expect(isClaimInFlight({ type: 'declined' })).toBe(false);
    expect(isClaimInFlight(undefined)).toBe(false);
  });
});

// What the SDK does with a deposit is decided by the configured limit, not by
// the sheet, so the sheet has to be able to read that decision to avoid showing
// a route the SDK is about to overrule.
describe('predicting the automatic early claim', () => {
  const covered = () => quoteOf(option(1, 300), option(3, 198), 0);

  it('sees the claim coming when the fee is inside a fixed limit', () => {
    expect(autoClaimsEarly(covered(), { onchain: { type: 'fixed', amount: 500 } })).toBe(true);
  });

  it('counts a fee exactly at the limit as covered, as the SDK does', () => {
    expect(autoClaimsEarly(covered(), { onchain: { type: 'fixed', amount: 300 } })).toBe(true);
  });

  it('leaves the choice alone when the fee is above the limit', () => {
    expect(autoClaimsEarly(covered(), { onchain: { type: 'fixed', amount: 200 } })).toBe(false);
  });

  // Not gated on the deposit's current depth: the point is to say what will
  // happen, and a route that opens a block from now still will.
  it('predicts it before the route has opened', () => {
    const deep = quoteOf(option(2, 300), option(3, 198), 0);
    expect(autoClaimsEarly(deep, { onchain: { type: 'fixed', amount: 500 } })).toBe(true);
  });

  it('predicts nothing for a deposit the provider will not front', () => {
    expect(autoClaimsEarly(quoteOf(null, option(3, 198), 0), { onchain: { type: 'fixed', amount: 500 } }))
      .toBe(false);
    expect(autoClaimsEarly(null, { onchain: { type: 'fixed', amount: 500 } })).toBe(false);
  });

  // A rate limit is sat-per-vbyte, and only the SDK can price it for this
  // deposit. The quote carries that figure; without it, guessing would be worse
  // than the unchanged screen, which offers the choice rather than pre-empting it.
  it('reads a rate limit through the ceiling the SDK priced for the deposit', () => {
    const priced = (maxFeeSats: number) =>
      quoteOf({ ...option(1, 300), maxFeeSats }, option(3, 198), 0);
    expect(autoClaimsEarly(priced(400), { onchain: { type: 'rate', satPerVbyte: 1 } })).toBe(true);
    expect(autoClaimsEarly(priced(250), { onchain: { type: 'networkRecommended', leewaySatPerVbyte: 0 } }))
      .toBe(false);
  });

  it('declines to predict against a rate limit the quote does not price', () => {
    expect(autoClaimsEarly(covered(), { onchain: { type: 'rate', satPerVbyte: 1 } })).toBe(false);
    expect(autoClaimsEarly(covered(), { onchain: { type: 'networkRecommended', leewaySatPerVbyte: 0 } }))
      .toBe(false);
  });

  // The sheet records a fixed ceiling before the quote is fetched again, so the
  // quote's figure can still be the one it replaced.
  it('holds a fixed limit over the ceiling the quote was priced at', () => {
    const stale = quoteOf({ ...option(1, 300), maxFeeSats: 500 }, option(3, 198), 0);
    expect(autoClaimsEarly(stale, { onchain: { type: 'fixed', amount: 200 } })).toBe(false);
  });
});

describe('the ceiling an early claim is held to', () => {
  it('prefers the ceiling standing on the deposit to the configured one', () => {
    expect(earlyClaimCeiling({ onchain: { type: 'fixed', amount: 3_200 } }, { onchain: { type: 'fixed', amount: 500 } }))
      .toEqual({ onchain: { type: 'fixed', amount: 3_200 } });
  });

  // The direction nobody's intuition gets right, and true only of the early
  // route: a standing ceiling below the configured default holds the deposit
  // back from being fronted. The claim at maturity runs under whichever admits
  // more, so it is not held back with it.
  it('holds a deposit back from the front when its ceiling sits below the default', () => {
    expect(earlyClaimCeiling({ onchain: { type: 'fixed', amount: 100 } }, { onchain: { type: 'fixed', amount: 500 } }))
      .toEqual({ onchain: { type: 'fixed', amount: 100 } });
  });

  it('falls back to the configured ceiling when the deposit carries none', () => {
    expect(earlyClaimCeiling(undefined, { onchain: { type: 'fixed', amount: 500 } }))
      .toEqual({ onchain: { type: 'fixed', amount: 500 } });
  });

  it('reads a fixed ceiling in sats and declines to name the rate kinds', () => {
    expect(claimCeilingSats({ onchain: { type: 'fixed', amount: 500 } })).toBe(500);
    expect(claimCeilingSats({ onchain: { type: 'rate', satPerVbyte: 1 } })).toBeNull();
    expect(claimCeilingSats({ onchain: { type: 'networkRecommended', leewaySatPerVbyte: 0 } })).toBeNull();
  });

  it('declines to name a fixed ceiling that takes a share of the deposit', () => {
    expect(claimCeilingSats({ onchain: { type: 'fixed', amount: 500 }, proportionalPpm: 1_000 })).toBeNull();
  });

  // Not derived from the early fee: the spread falls as the deposit gets
  // deeper, so a ceiling set just under today's spread is above tomorrow's and
  // fronts the deposit anyway, which is what choosing the wait refused.
  // Low enough to refuse the front, and no lower: the claim at maturity runs
  // under whichever ceiling admits more, so naming the wait's own cost keeps
  // that claim covered even where the configured ceiling sits below it.
  it('refuses the front at the cost of the wait itself', () => {
    expect(ceilingForWait(option(3, 198))).toBe(198);
  });
});
