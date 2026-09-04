import type { ClaimDepositQuote, DepositInfo, FetchClaimDepositQuoteResponse, InstantClaimStatus } from '@breeztech/breez-sdk-spark';

/** Rough block interval, for turning a confirmation depth into a wait. */
const MINUTES_PER_BLOCK = 10;

/**
 * Copy for a submitted early claim. Shared because the SDK raises no event for a
 * manual claim, so the sheet announces that one itself while background sync
 * announces its own: one wording, two callers.
 */
export const INSTANT_CLAIM_SUBMITTED_TOAST = {
  title: 'Claim Submitted',
  detail: 'Funds will arrive shortly',
} as const;

/**
 * The same confirmation for the sheet, which stays open behind the toast and can
 * be reopened later. Composed from the toast so the two cannot drift apart.
 */
export const CLAIM_SUBMITTED_LINE = `Claim submitted. ${INSTANT_CLAIM_SUBMITTED_TOAST.detail}.`;

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

/** Approximate wait for `blocks`, or null when there is nothing left to wait for. */
export function formatWait(blocks: number): string | null {
  if (blocks <= 0) return null;
  const minutes = blocks * MINUTES_PER_BLOCK;
  if (minutes < 60) return `~${minutes} min`;
  const hours = minutes / 60;
  return `~${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
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
  return quote.instant;
}

/**
 * The option a preference resolves to. Shared so a re-quote can be compared
 * against the same selection the user made, not just against `instant`.
 */
export function selectOption(
  quote: FetchClaimDepositQuoteResponse | null,
  preferEarly: boolean,
): ClaimDepositQuote | null {
  if (!quote) return null;
  const early = earlyOption(quote);
  return early && preferEarly ? early : quote.mature;
}

/** True while a claim is in flight, during which the SDK refuses a second one. */
export function isClaimInFlight(status: InstantClaimStatus | undefined): boolean {
  return status?.type === 'submitted';
}

/** Identifies a deposit across events, which carry records rather than ids. */
function depositOutpoint(deposit: DepositInfo): string {
  return `${deposit.txid}:${deposit.vout}`;
}

/**
 * Outpoints whose submitted claim has already been announced. Sync keeps
 * reporting a claim until it settles, and the sheet announces its own manual
 * claim, so without a marker both doors lead to the same repeated toast. Lives
 * for the session; `forgetAnnouncedClaims` clears it when the wallet changes.
 */
const announcedClaims = new Set<string>();

function claimAlreadyAnnounced(deposit: DepositInfo): boolean {
  return announcedClaims.has(depositOutpoint(deposit));
}

/**
 * The submitted claims worth announcing, marked as they are taken. Reading and
 * marking are one step because sync repeats a claim until it settles, so a
 * caller that read first and marked later would announce the same claim twice.
 */
export function takeUnannouncedClaims(submitted: DepositInfo[]): DepositInfo[] {
  const fresh = submitted.filter(d => !claimAlreadyAnnounced(d));
  fresh.forEach(markClaimAnnounced);
  return fresh;
}

export function markClaimAnnounced(deposit: DepositInfo): void {
  announcedClaims.add(depositOutpoint(deposit));
}

export function forgetAnnouncedClaims(): void {
  announcedClaims.clear();
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
