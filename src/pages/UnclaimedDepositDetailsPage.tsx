import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWallet, useSdkEvents } from '../contexts/WalletContext';
import type {
  BreezSdk,
  ClaimDepositQuote,
  DepositInfo,
  FetchClaimDepositQuoteResponse,
  InstantClaimStatus,
  MaxFee,
} from '@breeztech/breez-sdk-spark';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, PrimaryButton, SecondaryButton, PaymentInfoCard, CollapsibleCodeField, LoadingSpinner } from '../components/ui';
import { FeeBreakdownCard } from '../components/FeeBreakdownCard';
import { SpinnerIcon } from '../components/Icons';
import { AlertCard } from '../components/AlertCard';
import { SatAmount } from '../components/SatAmount';
import { forgetClaimFee, readClaimFee, rejectDeposit, rememberClaimFee, removeRejectedDeposit } from '../services/depositState';
import { explorerTxUrl } from '../utils/explorer';
import { getSettings } from '../services/settings';
import {
  CLAIM_SUBMITTED_LINE,
  autoClaimsEarly,
  blocksToWait,
  ceilingForWait,
  earlyOption,
  earlyClaimCeiling,
  formatWait,
  isClaimInFlight as isClaimInFlightStatus,
  isClaimable,
  selectOption,
} from '../utils/depositClaimQuote';
import { useSheetFullSnap } from '../components/ui/sheets/BottomSheetCardContext';
import { useLatest } from '../hooks/useLatest';
import { unsettledDeposits } from '../utils/depositHelpers';
import { logger, LogCategory } from '@/services/logger';

interface UnclaimedDepositDetailsPageProps {
  deposit: DepositInfo | null;
  onBack: () => void;
  /** The deposit is done with: refresh the list and stand this sheet down. */
  onChanged?: () => void;
  /**
   * The deposit's record moved but the sheet stays up. Separate from
   * `onChanged` because that one closes the sheet, which a recorded ceiling
   * must not: the sheet is still showing a deposit that is still waiting.
   */
  onRefresh?: () => void;
}

interface ClaimState {
  claimError: string | null;
  requiredFeeSats: number | null;
}

// Derive the claim/fee state from a deposit record's last claim outcome,
// whether that came from an automatic claim or from a manual retry. A
// confirming deposit has an automatic claim still ahead of it, so a stored
// error there is not yet the user's to answer.
function deriveClaimState(deposit: DepositInfo | null): ClaimState {
  if (!deposit || !deposit.isMature) {
    return { claimError: null, requiredFeeSats: null };
  }
  const claimErrorData = deposit.claimError;
  if (!claimErrorData) {
    return { claimError: null, requiredFeeSats: null };
  }
  if (claimErrorData.type === 'maxDepositClaimFeeExceeded') {
    // Fee exceeded - show required fee for user approval
    return { claimError: null, requiredFeeSats: claimErrorData.requiredFeeSats || 0 };
  }
  if (claimErrorData.type === 'generic') {
    return { claimError: claimErrorData.message || 'Automatic claim failed', requiredFeeSats: null };
  }
  // missingUtxo or other error - can only reject
  return { claimError: 'Automatic claim failed', requiredFeeSats: null };
}

// claimDeposit stores the fresh claim error before it throws, so the deposit
// record already carries the fee the operator just quoted. Re-reading it is
// the only way back to that number: the thrown error crosses the WASM
// boundary as a plain string.
//
// The three outcomes are kept apart because they call for opposite handling:
// `gone` means the deposit has left the unclaimed set, so it was claimed
// elsewhere and nothing here still applies to it, whereas `unknown` means the
// read itself failed and the panel must keep whatever it already had.
type FreshDeposit =
  | { kind: 'found'; deposit: DepositInfo }
  | { kind: 'gone' }
  | { kind: 'unknown' };

async function findFreshDeposit(wallet: BreezSdk, deposit: DepositInfo): Promise<FreshDeposit> {
  try {
    const deposits = unsettledDeposits((await wallet.listUnclaimedDeposits({})).deposits);
    const fresh = deposits.find(d => d.txid === deposit.txid && d.vout === deposit.vout);
    return fresh ? { kind: 'found', deposit: fresh } : { kind: 'gone' };
  } catch (e) {
    logger.warn(LogCategory.SDK, 'Failed to re-read deposit after a failed claim', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { kind: 'unknown' };
  }
}

/**
 * True while there is content below the scroller's current position: not merely
 * whether it can scroll, so the hint disappears once you have reached the end
 * rather than sitting over the last line of it.
 */
function useMoreBelow(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // Catches the sheet resizing; the deps catch the content changing under it.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
  return moreBelow;
}

/**
 * The sheet body, capped in dvh so the card stays fully on screen: unbounded,
 * the content snap is measured against the URL-bar-hidden viewport, so the card
 * runs past the visible one while its scroller still believes it fits.
 *
 * 74dvh is the smallest cap that fits every ordinary state on an iPhone 14 with
 * nothing clipped. It stays a cap rather than growing for the taller states: the
 * container measures content once and holds that snap, so a body that grew
 * afterwards would carry the footer past the bottom of the viewport with it.
 */
const SheetBody: React.FC<{ children: ReactNode }> = ({ children }) => {
  const isSheetFull = useSheetFullSnap();
  return (
    <div className="flex flex-col" style={{ maxHeight: isSheetFull ? '85dvh' : '74dvh' }}>
      {children}
    </div>
  );
};

/** Ties the claim button to the offer it takes without putting it in the label. */
const INSTANT_OFFER_ID = 'instant-claim-offer';

/**
 * One delivery speed. A full-width row rather than a half-width tile: the names
 * are what distinguish the two, so they get the space, and the fees line up in
 * one column down the right where they can be compared.
 *
 * Both rows are always live. Either can be committed as the deposit's fee
 * ceiling, so neither is ever an outcome the user cannot have: the selection
 * starts on whichever one the standing ceiling will take.
 */
const SpeedOption: React.FC<{
  label: string;
  detail: string;
  feeSats: number;
  isEstimate: boolean;
  selected: boolean;
  onSelect: () => void;
}> = ({ label, detail, feeSats, isEstimate, selected, onSelect }) => (
  <button
    role="radio"
    aria-checked={selected}
    onClick={onSelect}
    className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-left transition-colors ${
      selected
        ? 'bg-spark-primary/10 border-spark-primary'
        : 'bg-spark-dark border-spark-border hover:border-spark-border-light'
    }`}
  >
    <span className="flex items-center gap-3 min-w-0">
      <span className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
        selected ? 'border-spark-primary' : 'border-spark-border-light'
      }`}>
        {selected && <span className="w-2 h-2 rounded-full bg-spark-primary" />}
      </span>
      <span className="min-w-0">
        <span className="block font-display font-medium text-spark-text-primary">{label}</span>
        <span className="block text-xs text-spark-text-muted mt-1">{detail}</span>
      </span>
    </span>
    <span className="shrink-0 text-sm text-spark-text-secondary whitespace-nowrap">
      <SatAmount sats={feeSats} approximate={isEstimate} />
    </span>
  </button>
);

const UnclaimedDepositDetailsPage: React.FC<UnclaimedDepositDetailsPageProps> = ({
  deposit,
  onBack,
  onChanged,
  onRefresh,
}) => {
  const wallet = useWallet();
  const subscribeToSdkEvents = useSdkEvents();

  // Seeded from the record and kept current by handleClaim's retries and by the
  // sync listener below, either of which can turn a confirming deposit into one
  // whose automatic claim has already run and been refused.
  const [{ claimError, requiredFeeSats }, setClaim] = useState<ClaimState>(() => deriveClaimState(deposit));
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [feeRaised, setFeeRaised] = useState<boolean>(false);
  const [isTxIdVisible, setIsTxIdVisible] = useState<boolean>(false);

  // Refreshed from the SDK after a declined instant claim, which persists the
  // outcome before it throws. The `deposit` prop is a snapshot taken when the
  // row was tapped, so it never picks that up on its own.
  const [instantStatus, setInstantStatus] = useState<InstantClaimStatus | undefined>(
    () => deposit?.instantClaimStatus,
  );
  // The deposit's own claim ceiling, which outranks the configured one in both
  // directions. Refreshed like instantClaimStatus above: claimDeposit records a
  // requested ceiling before it attempts anything, so the record moves under a
  // sheet that is still open.
  const [standingCeiling, setStandingCeiling] = useState<MaxFee | undefined>(
    () => deposit?.maxClaimFee,
  );
  const [instantError, setInstantError] = useState<string | null>(null);
  const [quote, setQuote] = useState<FetchClaimDepositQuoteResponse | null>(null);
  // Only the first pricing, and only while it is out: a failed one leaves the
  // sheet on plain waiting rather than on a promise it cannot keep.
  const [isPricing, setIsPricing] = useState<boolean>(true);
  // The fee a rejected claim was quoted at, so the re-price can name what moved.
  const [instantFeeFrom, setInstantFeeFrom] = useState<number | null>(null);
  // Which delivery speed the user has asked for, or null to follow whatever the
  // standing ceiling will do. Null by default so the selection always starts on
  // the route that is really going to run.
  const [instantOn, setInstantOn] = useState<boolean | null>(null);
  // Read by the sync listener, which must not re-price under a claim already
  // sent: the sheet would restate the fee, and could drop the button, while the
  // user is looking at "Processing...".
  const claimInFlightRef = useRef(false);

  // The prop is re-derived from the unclaimed list on every sync, so it is a new
  // object each time with the same identity. Effects key on the outpoint and read
  // the record through the ref, or each sync would re-subscribe and re-quote.
  const depositRef = useLatest(deposit);
  const txid = deposit?.txid;
  const vout = deposit?.vout;

  const isConfirming = deposit ? !deposit.isMature : false;
  const isClaimInFlight = isClaimInFlightStatus(instantStatus);

  const early = earlyOption(quote);
  const confirmations = quote?.confirmations ?? 0;
  // An offer for N blocks' time is not one the user can take now: claiming
  // against a floor above the deposit's depth throws.
  const earlyReady = early !== null && isClaimable(early, confirmations);
  // The offer worth putting a switch beside, when there is one to take.
  const offer = early && quote && !isClaimInFlight
    ? { option: early, ready: earlyReady }
    : null;
  // The ceiling every automatic attempt on this deposit is held to. The
  // deposit's own outranks the configured one in both directions, so a standing
  // ceiling below the default holds this deposit back rather than being ignored.
  const maxFee = earlyClaimCeiling(standingCeiling, getSettings().depositMaxFee);
  // What happens if nothing is committed here. The default selection, so the fee
  // on screen is always the one that will be charged.
  const willClaimEarly = autoClaimsEarly(quote, maxFee);
  // What is selected, which is what the breakdown prices. A route still short
  // of its depth counts: it is a wait, not a refusal.
  const earlySelected = offer !== null && (instantOn ?? willClaimEarly);
  // The one tap that spends, and so the only one left for a button: the early
  // route is picked, already at its depth, and the ceiling does not cover it
  // yet. Every other instruction is carried by the switch itself.
  const claimsNow = offer !== null && earlySelected && offer.ready && !willClaimEarly;
  // Waiting is still worth pricing without an early route: the breakdown then
  // shows what the automatic claim will cost. Nothing to price under a claim in
  // flight with no receipt: that claim is one this sheet did not send, so there
  // is no figure for what it cost and the maturity fee is emphatically not it.
  const chosen: ClaimDepositQuote | null = isClaimInFlight
    ? null
    : quote ? (earlySelected && early ? early : quote.mature) : null;
  // A submitted claim is never re-quoted, so the breakdown would otherwise show
  // the deposit and nothing about what it cost. The receipt is the figure the
  // user agreed to, which a fresh quote would not be.
  const receipt = deposit && isClaimInFlight ? readClaimFee(deposit.txid, deposit.vout) : null;
  /**
   * Whether picking `early` is a new instruction rather than a return to what
   * already happens. Symmetric on purpose: switching away from the route the
   * ceiling delivers asks for something, and switching back to it asks for
   * nothing, so the round trip leaves the deposit exactly as it was.
   */
  const instructs = (early: boolean) => early !== willClaimEarly;
  /**
   * Choosing a speed, refused mid-flight so the route cannot change under it.
   *
   * The choice is itself the instruction, so the ceiling it implies is recorded
   * on the tap. Held back only where the tap would spend rather than record: an
   * early route already at its depth is claimed the moment its ceiling covers
   * it, and spending is the button's to ask for, not a radio's.
   */
  const chooseSpeed = (early: boolean) => {
    if (isProcessing) return;
    setInstantOn(early);
    const spendsNow = early && offer !== null && offer.ready;
    if (!spendsNow && instructs(early)) void claimRoute(early);
  };
  /** The paid row names what it is: a route that has not opened yet is not instant. */
  const earlyLabel = offer?.ready ? 'Instant delivery' : 'Expedited delivery';

  // Null once the automatic claim is due, which is a different sentence.
  const matureWait = quote ? formatWait(blocksToWait(quote.mature, confirmations)) : null;
  // Deep enough that the SDK's own claim is due rather than pending. Without
  // this the screen reads exactly like a deposit the provider never offered to
  // front, which is a different thing entirely.
  const matureDue = quote !== null && blocksToWait(quote.mature, confirmations) === 0;
  // Both ways a tap on the claim button ends badly, reported the same way: a
  // re-price is not gentler news than any other decline, the claim did not
  // happen either way. The amount goes through SatAmount rather than into the
  // string, or its grouping space becomes a line break and splits the figure.
  const scrollRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);
  // The body is capped, so a failure arriving under the fold is a message the
  // user never sees. Bring it into the scroller rather than growing the sheet,
  // which would carry the footer past the bottom of the viewport with it.
  // Keyed on the state behind the message: the message itself is a node, and a
  // new one every render would re-fire this on every render.
  useEffect(() => {
    if (instantFeeFrom !== null || instantError) {
      failureRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [instantFeeFrom, instantError]);
  const claimFailure: ReactNode = instantFeeFrom !== null
    ? <>Your claim did not go through: the fee changed from <SatAmount sats={instantFeeFrom} />.</>
    : instantError;
  // What the deposit is doing, when nothing else on screen already says it. A
  // ready early route speaks through its own button, so it needs no line.
  // Only draw the scroll fade when something is actually under it: on the states
  // that fit, an unconditional one dims the last card for no reason.
  const moreBelow = useMoreBelow(scrollRef, [quote, earlySelected, instantFeeFrom, instantError, requiredFeeSats, claimError, isClaimInFlight, standingCeiling, claimsNow]);
  const statusLine: ReactNode = isClaimInFlight
    // Says what the toast said, so reopening the sheet mid-settlement reports
    // the claim rather than showing an amount and nothing else.
    ? CLAIM_SUBMITTED_LINE
    : !isConfirming
      ? 'This transfer will be claimed automatically.'
      // Nothing until the quote lands. The depth a deposit matures at is not
      // the depth the early route opens at, so any figure named here is one
      // the next render contradicts.
      : !quote
        ? null
        // The group names both speeds and both waits, so a line under it
        // repeating either would only say the same thing twice.
        : offer !== null
          ? null
          // No wait quoted here either: with no offer on the table there is
          // nothing for a countdown to be weighed against. The wait is priced
          // inside the group, or it is not priced at all.
          : matureDue
            ? 'This transfer is being claimed.'
            : 'This transfer will be claimed automatically.';

  const handleClose = () => {
    onBack();
  };

  const handleClaim = async () => {
    if (!deposit || requiredFeeSats === null) return;
    setFeeRaised(false);
    setIsProcessing(true);
    claimInFlightRef.current = true;
    try {
      const maxFee: MaxFee = { type: 'fixed', amount: requiredFeeSats };
      const { outcome } = await wallet.claimDeposit({ txid: deposit.txid, vout: deposit.vout, maxFee });
      // Remove from rejected list if it was there
      removeRejectedDeposit(deposit.txid, deposit.vout);
      // A matured deposit either settles or throws, so anything else means the
      // approval moved nothing and the panel has to stay up. Standing the sheet
      // down here would report an approval that never happened.
      if (outcome.type === 'deferred') {
        setStandingCeiling(maxFee);
        setInstantError('Could not claim this transfer yet. Please try again.');
        return;
      }
      onChanged?.();
      handleClose();
    } catch (e) {
      logger.error(LogCategory.PAYMENT, 'Failed to claim transfer', {
        error: e instanceof Error ? e.message : String(e),
      });
      // The operator re-quotes on every attempt, so the fee we just sent can
      // already be stale. Retrying at it fails the same way with the same
      // number, so adopt the quote behind the failure when there is one.
      const found = await findFreshDeposit(wallet, deposit);
      const fresh = found.kind === 'found' ? deriveClaimState(found.deposit) : null;
      if (fresh?.requiredFeeSats != null && fresh.requiredFeeSats !== requiredFeeSats) {
        setClaim(fresh);
        setFeeRaised(true);
      } else {
        const errorMessage = e instanceof Error ? e.message : 'Failed to claim transfer';
        setClaim({ claimError: errorMessage, requiredFeeSats: null });
      }
    } finally {
      claimInFlightRef.current = false;
      setIsProcessing(false);
    }
  };

  /** Stands the sheet down: the deposit is settled or gone, so it has no actions left. */
  const dismissAsSettled = () => {
    // Settled or gone: the receipt has nothing left to describe.
    if (deposit) forgetClaimFee(deposit.txid, deposit.vout);
    onChanged?.();
    handleClose();
  };
  const dismissAsSettledRef = useLatest(dismissAsSettled);

  /**
   * Prices both ways of claiming. A pure read, so it runs on open rather than
   * behind a tap, and again on every sync and after a failed claim: the
   * provider's spread falls as the deposit gets deeper, so a figure held from
   * one depth is already out of date at the next.
   */
  const loadQuote = useCallback(async (target: DepositInfo) => {
    try {
      const fresh = await wallet.fetchClaimDepositQuote({ txid: target.txid, vout: target.vout });
      setQuote(fresh);
      return fresh;
    } catch (e) {
      // Keeps the last good quote. Clearing it would strip the options, the
      // breakdown and the button mid-flow, turning a failed re-price into a
      // sheet that looks like it never had a choice to offer.
      logger.warn(LogCategory.PAYMENT, 'Failed to quote deposit claim', {
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    } finally {
      setIsPricing(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (!deposit || deposit.isMature || isClaimInFlightStatus(deposit.instantClaimStatus)) return;
    // loadQuote awaits the SDK before it sets anything, so nothing is written during this render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadQuote(deposit);
    // Prices once on open; the listener below re-prices from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txid, vout, loadQuote]);

  // A quote is a snapshot at one depth. Left alone it goes stale in place: the
  // block that unlocks the early route lands, and the sheet still shows the
  // wait and no button until it is reopened.
  useEffect(() => {
    const target = depositRef.current;
    if (!target) return;
    let cancelled = false;
    const unsubscribe = subscribeToSdkEvents(event => {
      if (event.type !== 'synced' || claimInFlightRef.current) return;
      void (async () => {
        const found = await findFreshDeposit(wallet, target);
        if (cancelled || claimInFlightRef.current) return;
        if (found.kind === 'gone') {
          // Claimed by background sync. Leaving the sheet up would keep offering
          // routes for a deposit that no longer exists, and the funds announce
          // themselves as a receive either way.
          dismissAsSettledRef.current();
          return;
        }
        if (found.kind !== 'found') return;
        setInstantStatus(found.deposit.instantClaimStatus);
        setStandingCeiling(found.deposit.maxClaimFee);
        // A deposit that matures with the sheet open gets claimed automatically,
        // and that claim can trip the fee ceiling. Without this the outcome sits
        // unread on the record and the approve panel never appears.
        setClaim(deriveClaimState(found.deposit));
        if (isClaimInFlightStatus(found.deposit.instantClaimStatus)) return;
        // Nothing left to price once it matures: the SDK claims it itself, and
        // the approve panel is priced off the record rather than off a quote.
        if (found.deposit.isMature) return;
        await loadQuote(found.deposit);
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [txid, vout, depositRef, dismissAsSettledRef, loadQuote, subscribeToSdkEvents, wallet]);

  /**
   * Records the ceiling a route needs, which claims it outright when the route
   * is already at its depth and only records the instruction otherwise.
   *
   * Takes the route rather than reading the selection: a row's tap commits, and
   * the state behind `earlySelected` has not updated by the time it runs.
   */
  const claimRoute = async (early: boolean) => {
    if (!deposit || !quote || !offer) return;
    const route = early ? offer.option : quote.mature;
    // Read before the awaits: the quote moves under them, and what a failure
    // means turns on what was asked for.
    const claimsNow = early && offer.ready;
    const committing = !claimsNow;
    // Picking the wait commits a ceiling that refuses to have the deposit
    // fronted, which is the cost of the wait rather than of the route skipped.
    const requested = early ? route.feeSats : ceilingForWait(quote.mature);
    setInstantError(null);
    setInstantFeeFrom(null);
    setIsProcessing(true);
    claimInFlightRef.current = true;
    try {
      const requestedCeiling: MaxFee = { type: 'fixed', amount: requested };
      const { outcome } = await wallet.claimDeposit({
        txid: deposit.txid, vout: deposit.vout, maxFee: requestedCeiling,
      });
      removeRejectedDeposit(deposit.txid, deposit.vout);
      // Nothing was claimed, but the ceiling asked for still stands on the
      // deposit and is what the next automatic attempt is held to. An ordinary
      // outcome rather than a failure, so the sheet stays open and reports the
      // instruction it just recorded. Set here rather than re-read: the SDK
      // records the ceiling before it attempts anything, and the prop behind
      // this state is only reseeded on the next sync.
      if (outcome.type === 'deferred') {
        setStandingCeiling(requestedCeiling);
        // Committing the wait asks for a ceiling the spread is meant to exceed,
        // so that reason is this outcome working rather than a price that moved.
        if (early && outcome.reason.type === 'maxFeeExceeded') {
          setInstantFeeFrom(requested);
          await loadQuote(deposit);
        }
        // Only worth saying when the front was what was asked for: a provider
        // that declined to front a deposit the user chose to wait for has
        // refused nothing they wanted. The message is a diagnostic, not copy:
        // it is the provider's own wording and names its internals.
        if (early && outcome.reason.type === 'providerDeclined') {
          logger.warn(LogCategory.PAYMENT, 'Provider declined to front the deposit', {
            message: outcome.reason.message,
          });
          setInstantError('Early delivery is not available right now, so this transfer will be claimed automatically instead.');
        }
        // The recorded ceiling has to reach the list this sheet is opened from:
        // a reopened sheet seeds its selection from that copy, so without this
        // it reads the configured ceiling again and offers the route the user
        // just refused. Not `onChanged`, which stands the sheet down.
        onRefresh?.();
        return;
      }
      // Claimed ahead of maturity, settling asynchronously, so nothing else
      // will announce it: the sheet is about to close over it. Marked first, or
      // the next sync reports the same claim as news.
      if (outcome.type === 'submitted') {
        // The only record of what this cost: the SDK keeps no fee on a
        // submitted claim, so without this the sheet cannot price itself when
        // it is reopened mid-settlement.
        rememberClaimFee(deposit.txid, deposit.vout, {
          feeSats: requested,
          creditAmountSats: route.creditAmountSats,
        });
      }
      // Settled falls through: the payment carries the claim and announces itself.
      onChanged?.();
      handleClose();
    } catch (e) {
      logger.error(LogCategory.PAYMENT, 'Failed to claim transfer', {
        error: e instanceof Error ? e.message : String(e),
      });
      const found = await findFreshDeposit(wallet, deposit);
      if (found.kind === 'gone') {
        // Claimed while we were working. Reporting a failure over a deposit
        // that is no longer pending would be false.
        dismissAsSettled();
        return;
      }
      if (found.kind === 'found') {
        setInstantStatus(found.deposit.instantClaimStatus);
        setStandingCeiling(found.deposit.maxClaimFee);
        // A claim already in flight is not a failure to report: the SDK refuses
        // the second attempt, and the status line now says the first was taken.
        if (isClaimInFlightStatus(found.deposit.instantClaimStatus)) return;
      }
      // The price moves with depth, so a failure is a reason to re-price rather
      // than to retry against the figure that just failed.
      const fresh = selectOption(await loadQuote(deposit));
      if (fresh && fresh.feeSats > route.feeSats) {
        // A fee that outran the ceiling explains itself: the sheet has already
        // repriced, so the raw SDK message would only repeat it worse. The old
        // figure is kept so the line can say which way it moved.
        setInstantFeeFrom(route.feeSats);
        return;
      }
      setInstantError(committing
        ? 'Could not set this transfer up to be claimed. Please try again.'
        : (e instanceof Error ? e.message : 'Failed to claim transfer'));
    } finally {
      claimInFlightRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleReject = () => {
    if (!deposit) return;
    // Mark transfer as rejected
    rejectDeposit(deposit.txid, deposit.vout);
    onChanged?.();
    handleClose();
  };

  if (!deposit) {
    return (
      <BottomSheetContainer isOpen={false} onClose={handleClose}>
        <BottomSheetCard>
          <div></div>
        </BottomSheetCard>
      </BottomSheetContainer>
    );
  }

  const depositAmount = deposit.amountSats;
  const receiveAmount = requiredFeeSats !== null ? depositAmount - requiredFeeSats : depositAmount;

  return (
    <BottomSheetContainer isOpen={deposit != null} onClose={handleClose}>
      <BottomSheetCard>
        <DialogHeader title="BTC Transfer" onClose={handleClose} />
        <SheetBody>
          {/* The scroller sits in its own box so a fade can sit over its bottom
              edge. Without it a cut lands flush against the footer and reads as
              a clipped card rather than as more content below. */}
          <div className="relative flex-1 min-h-0 flex flex-col">
          <div ref={scrollRef} className="space-y-3 flex-1 min-h-0 overflow-y-auto overscroll-y-none touch-pan-y">
          {/* Which transfer this is, before anything priced about it. */}
          <PaymentInfoCard compact>
            <CollapsibleCodeField
              label="Transaction ID"
              value={deposit.txid}
              isVisible={isTxIdVisible}
              onToggle={() => setIsTxIdVisible(prev => !prev)}
              href={explorerTxUrl(deposit.txid)}
            />
          </PaymentInfoCard>


          {/* Show fee breakdown only when we have a required fee from claim error */}
          {!claimError && requiredFeeSats !== null && (
            <>
              {feeRaised && (
                <AlertCard variant="warning" title="Network fee changed">
                  <p className="text-sm">
                    The fee rose to <SatAmount sats={requiredFeeSats} /> while you were confirming.
                    Approve to claim at the new fee.
                  </p>
                </AlertCard>
              )}

              <FeeBreakdownCard
                items={[
                  { label: 'Amount', value: depositAmount },
                  { label: 'Network fee', value: requiredFeeSats },
                  { label: 'You receive', value: receiveAmount, highlight: true },
                ]}
              />

              <p className="text-spark-text-muted text-sm text-center">
                Approve to claim this transfer, or reject to process a refund.
              </p>
            </>
          )}

          {/* Confirming or pending automatic claim */}
          {!claimError && requiredFeeSats === null && (
            <>
              {/* Pricing is a network read, so the speeds land a moment after
                  the sheet does. Holding their place and saying what is
                  happening keeps the card from growing under the user with
                  nothing on screen to account for it. */}
              {isConfirming && isPricing && !quote && (
                <div id={INSTANT_OFFER_ID} data-testid="delivery-speed-pending" className="space-y-2">
                  <span className="block text-sm text-spark-text-secondary">Speed</span>
                  {/* 9.25rem is the two option rows it stands in for (70px
                      each, 8px apart), so the sheet is the same height before
                      and after and nothing moves under the reader when the
                      prices land. */}
                  <LoadingSpinner text="Checking delivery options" className="min-h-[9.25rem]" />
                </div>
              )}

              {/* Both speeds, named, in one group, and either committable: the
                  ceiling the button records is what decides which route runs,
                  so choosing the wait is as real an instruction as paying to
                  skip it. */}
              {offer && quote && (
                <div id={INSTANT_OFFER_ID} data-testid="delivery-speed" className="space-y-2">
                  <span className="block text-sm text-spark-text-secondary">Speed</span>
                  <div role="radiogroup" aria-label="Speed" className="space-y-2">
                    <SpeedOption
                      label="Standard delivery"
                      detail={matureWait ?? 'Claimed automatically'}
                      feeSats={quote.mature.feeSats}
                      isEstimate={quote.mature.isEstimate}
                      selected={!earlySelected}
                      onSelect={() => chooseSpeed(false)}
                    />
                    <SpeedOption
                      label={earlyLabel}
                      detail={offer.ready
                        ? 'Arrives in seconds'
                        : `Unlocks in ${formatWait(blocksToWait(offer.option, confirmations))}`}
                      feeSats={offer.option.feeSats}
                      isEstimate={offer.option.isEstimate}
                      selected={earlySelected}
                      onSelect={() => chooseSpeed(true)}
                    />
                  </div>
                </div>
              )}

              <FeeBreakdownCard
                items={receipt
                  ? [
                      { label: 'Amount', value: depositAmount },
                      { label: 'Delivery fee', value: receipt.feeSats, emphasis: true },
                      { label: 'You receive', value: receipt.creditAmountSats, highlight: true },
                    ]
                  : chosen
                  ? [
                      { label: 'Amount', value: depositAmount },
                      // Same estimate caveat as the row above: an unpriced
                      // maturity fee is marked, not presented as firm.
                      // The one row the group above changes, so it is lifted
                      // without taking the accent that marks what lands.
                      { label: earlySelected ? 'Delivery fee' : 'Network fee', value: chosen.feeSats, approximate: chosen.isEstimate, emphasis: earlySelected },
                      { label: 'You receive', value: chosen.creditAmountSats, highlight: true },
                    ]
                  : isPricing
                  ? [
                      { label: 'Amount', value: depositAmount },
                      { label: 'Network fee', pending: true },
                      { label: 'You receive', pending: true, highlight: true },
                    ]
                  : [{ label: 'Amount', value: depositAmount, highlight: true }]}
              />

              {statusLine && (
                <p className="text-spark-text-muted text-sm text-center">{statusLine}</p>
              )}

              {/* Sits under the figures it refers to, which the failed claim
                  re-quoted: the new fee is already in the row and the breakdown,
                  so only the one it moved from is still worth naming. */}
            </>
          )}

          {/* Above the hard-failure card and outside both panels: an approval can
              fail as readily as a claim, and only the quote panel could say so. */}
          {claimFailure && (
            <p ref={failureRef} className="text-sm text-spark-primary">{claimFailure}</p>
          )}

          {/* Error message for failed automatic claim (non-fee error) */}
          {claimError && (
            <AlertCard variant="warning" title="Claim Failed">
              <p className="text-sm">{claimError}</p>
              <p className="text-spark-primary text-sm mt-2">You can reject to process a refund instead.</p>
            </AlertCard>
          )}

          </div>
          {moreBelow && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-spark-surface to-transparent"
            />
          )}
          </div>

          <div className="shrink-0 space-y-4 pt-4">
            {/* Inert rather than absent when the selection already matches the
                ceiling: there is nothing to commit, but a group with no button
                under it would be deciding nothing. Present while pricing too,
                so the footer does not grow under the user when the prices land.
                A recorded fee means the automatic claim has already run and
                been refused, so the approve panel below owns the sheet. */}
            {isConfirming && !isClaimInFlight && (offer !== null || (isPricing && !quote)) && requiredFeeSats === null && !claimError && (
              // Described by the group rather than labelled with a price, so the
              // label stays the plain action and a screen reader still hears it.
              <PrimaryButton
                onClick={() => void claimRoute(true)}
                disabled={isProcessing || !claimsNow}
                aria-describedby={INSTANT_OFFER_ID}
                className="w-full"
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <SpinnerIcon size="md" />
                    Processing...
                  </span>
                ) : (
                  'Claim'
                )}
              </PrimaryButton>
            )}

            {/* Action Buttons - Approve/Reject for fee exceeded, hide when claim error shown */}
            {requiredFeeSats !== null && !claimError && (
              <div className="flex gap-3">
                <SecondaryButton onClick={handleReject} disabled={isProcessing} className="flex-1">
                  Reject
                </SecondaryButton>
                <PrimaryButton onClick={handleClaim} disabled={isProcessing} className="flex-1">
                  {isProcessing ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon size="md" />
                      Processing...
                    </span>
                  ) : (
                    'Approve'
                  )}
                </PrimaryButton>
              </div>
            )}

            {/* Only Reject button when claim error is shown */}
            {claimError && (
              <SecondaryButton onClick={handleReject} disabled={isProcessing} className="w-full">
                Reject
              </SecondaryButton>
            )}
          </div>
        </SheetBody>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};

export default UnclaimedDepositDetailsPage;
