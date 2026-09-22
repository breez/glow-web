import type { ClaimDepositQuote, DepositInfo, FetchClaimDepositQuoteResponse, InstantClaimStatus, MaxFee } from '@breeztech/breez-sdk-spark';

/** What the sheet says once an early claim is in, until the funds land. */
export const CLAIM_SUBMITTED_LINE = 'Claim submitted. Funds will arrive shortly.';

/**
 * Blocks still to wait before an option can be claimed. `confirmationsRequired`
 * is the depth at which the option unlocks, not a countdown, so the deposit's
 * current depth has to come off it.
 */
export function blocksToWait(option: ClaimDepositQuote, confirmations: number): number {
  return Math.max(0, option.confirmationsRequired - confirmations);
}

/** True once the deposit is deep enough for this option; claiming earlier throws. */
export function isClaimable(option: ClaimDepositQuote, confirmations: number): boolean {
  return blocksToWait(option, confirmations) === 0;
}

/** Rough block interval, for glossing a confirmation count in minutes. */
const MINUTES_PER_BLOCK = 10;

/**
 * A wait led by its confirmation count, with the time in parentheses. The count
 * is exact and drops each time a block lands; the minutes only say what a
 * confirmation costs. Leading with minutes would read as a countdown that never
 * counts down, since block arrival is memoryless: twenty minutes into a
 * two-block wait the expectation is still two blocks, not one minute.
 */
export function formatWait(blocks: number): string | null {
  if (blocks <= 0) return null;
  const plural = blocks === 1 ? '' : 's';
  return `${blocks} confirmation${plural} (~${blocks * MINUTES_PER_BLOCK} mins)`;
}

/**
 * The early option worth offering, or null. Absent means the provider declined
 * to front this deposit or would only credit at maturity's own depth, and
 * claiming against it would be refused.
 */
export function earlyOption(quote: FetchClaimDepositQuoteResponse | null): ClaimDepositQuote | null {
  if (!quote?.instant) return null;
  // No point offering a route that unlocks no sooner than simply waiting.
  if (quote.instant.confirmationsRequired >= quote.mature.confirmationsRequired) return null;
  // Nothing left to skip once the automatic claim is due: the spread would buy
  // one sync cycle at many times the fee the SDK is about to pay anyway.
  if (blocksToWait(quote.mature, quote.confirmations) === 0) return null;
  return quote.instant;
}

/**
 * The limit in sats, or null when it cannot be named. Only a fixed limit is
 * already a sat figure: the rate types are sat-per-vbyte and mean nothing
 * without the size of a claim transaction that has not been built yet.
 */
export function claimCeilingSats(maxFee: MaxFee): number | null {
  return maxFee.type === 'fixed' ? maxFee.amount : null;
}

/**
 * The ceiling an early claim is held to: the deposit's standing one outright,
 * else the configured default. A standing ceiling wins here in both directions,
 * so one set below the default does hold the deposit back from being fronted.
 *
 * Named for the early route because the claim at maturity resolves differently:
 * the SDK takes whichever of the two admits more, so a lowered ceiling cannot
 * keep a matured deposit from being claimed. Do not reason about maturity with
 * this.
 */
export function earlyClaimCeiling(standing: MaxFee | undefined, configured: MaxFee): MaxFee {
  return standing ?? configured;
}

/**
 * The ceiling that refuses to have the deposit fronted: pay no more than the
 * wait itself costs.
 *
 * Deliberately not derived from the early fee. The provider's spread falls as
 * the deposit gets deeper, so a ceiling set just under today's spread is above
 * tomorrow's and fronts the deposit anyway, which is the opposite of what
 * choosing the wait asked for. The maturity fee is the one figure the spread
 * does not fall below while fronting is still worth anything.
 *
 * It is also the floor worth recording rather than a lower one: the claim at
 * maturity runs under whichever ceiling admits more, so naming the wait's own
 * cost keeps that claim covered even where the configured ceiling sits below it.
 */
export function ceilingForWait(mature: ClaimDepositQuote): number {
  return mature.feeSats;
}

/**
 * True when the SDK will take the early route on its own, so the fee the user is
 * shown has to be the early one. Deliberately not gated on the deposit's current
 * depth: the point is to say what will happen, and a route that unlocks a block
 * from now still will.
 */
export function autoClaimsEarly(
  quote: FetchClaimDepositQuoteResponse | null,
  maxFee: MaxFee,
): boolean {
  const early = earlyOption(quote);
  const ceiling = claimCeilingSats(maxFee);
  return early !== null && ceiling !== null && early.feeSats <= ceiling;
}

/**
 * The option the sheet prices. The early route only once it can actually be
 * claimed: priced before then it would headline the proceeds of a purchase the
 * user cannot make, against a wait that is what will really happen.
 */
export function selectOption(quote: FetchClaimDepositQuoteResponse | null): ClaimDepositQuote | null {
  if (!quote) return null;
  const early = earlyOption(quote);
  return early && isClaimable(early, quote.confirmations) ? early : quote.mature;
}

/** True while a claim is in flight, during which the SDK refuses a second one. */
export function isClaimInFlight(status: InstantClaimStatus | undefined): boolean {
  return status?.type === 'submitted';
}

/**
 * Splits a `claimedDeposits` batch into the credited and the merely submitted.
 * Background sync reports both through the one event, and an early claim in it
 * has not credited anything yet, so the two need different copy. The submitted
 * come back whole because sync repeats them while they settle, and telling one
 * apart from the same one again needs the outpoint.
 */
export function splitClaimedDeposits(claimed: DepositInfo[]): { submitted: DepositInfo[]; settled: number } {
  const submitted = claimed.filter(d => isClaimInFlight(d.instantClaimStatus));
  return { submitted, settled: claimed.length - submitted.length };
}
