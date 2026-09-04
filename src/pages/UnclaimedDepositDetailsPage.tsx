import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useWallet, useSdkEvents } from '../contexts/WalletContext';
import { useToast } from '../contexts/ToastContext';
import type {
  BreezSdk,
  ClaimDepositQuote,
  DepositInfo,
  FetchClaimDepositQuoteResponse,
  InstantClaimStatus,
  MaxFee,
} from '@breeztech/breez-sdk-spark';
import { BottomSheetContainer, BottomSheetCard, DialogHeader, FormError, PrimaryButton, SecondaryButton, PaymentInfoCard, CollapsibleCodeField } from '../components/ui';
import { FeeBreakdownCard } from '../components/FeeBreakdownCard';
import { SpinnerIcon } from '../components/Icons';
import { AlertCard } from '../components/AlertCard';
import { SatAmount } from '../components/SatAmount';
import { rejectDeposit, removeRejectedDeposit } from '../services/depositState';
import { explorerTxUrl } from '../utils/explorer';
import { isPriorityDepositClaimEnabled } from '../services/settings';
import {
  CLAIM_SUBMITTED_LINE,
  INSTANT_CLAIM_SUBMITTED_TOAST,
  blocksToWait,
  earlyOption,
  formatWait,
  isClaimInFlight as isClaimInFlightStatus,
  markClaimAnnounced,
  isClaimable,
  selectOption,
} from '../utils/depositClaimQuote';
import { useSheetFullSnap } from '../components/ui/sheets/BottomSheetCardContext';
import { useLatest } from '../hooks/useLatest';
import { logger, LogCategory } from '@/services/logger';

interface UnclaimedDepositDetailsPageProps {
  deposit: DepositInfo | null;
  onBack: () => void;
  onChanged?: () => void;
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
    const { deposits } = await wallet.listUnclaimedDeposits({});
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
 * The sheet body, capped in dvh so the card stays fully on screen: unbounded,
 * the content snap is measured against the URL-bar-hidden viewport, so the card
 * runs past the visible one while its scroller still believes it fits.
 *
 * Its own component because the cap reads the sheet's snap, and that context is
 * provided by BottomSheetContainer. Read in the component that renders the
 * container it would only ever see the default, leaving the cap stuck at 65dvh.
 */
const SheetBody: React.FC<{ children: ReactNode }> = ({ children }) => {
  const isSheetFull = useSheetFullSnap();
  return (
    <div className="flex flex-col" style={{ maxHeight: isSheetFull ? '85dvh' : '65dvh' }}>
      {children}
    </div>
  );
};

/** One of the two ways to claim, or a faded placeholder when it is not on offer. */
const DeliveryOption: React.FC<{
  label: string;
  active: boolean;
  onSelect: () => void;
  /** The quote, or null when this route is not on offer for this deposit. */
  option: ClaimDepositQuote | null;
  wait: string | null;
}> = ({ label, active, onSelect, option, wait }) => (
  <button
    role="radio"
    aria-checked={active}
    onClick={option ? onSelect : undefined}
    // aria-disabled, not disabled: the route being unavailable is the point, and
    // a disabled control drops out of the group rather than announcing that.
    aria-disabled={!option}
    className={`flex-1 p-3 rounded-2xl border text-left transition-all ${
      !option
        ? 'bg-spark-dark border-spark-border opacity-40 cursor-not-allowed'
        : active
          ? 'bg-spark-primary/10 border-spark-primary'
          : 'bg-spark-dark border-spark-border hover:border-spark-border-light'
    }`}
  >
    <div className="font-display font-medium text-spark-text-primary">{label}</div>
    <div className="text-xs text-spark-text-muted mt-0.5">
      {option ? (wait ?? 'Now') : 'Not available'}
    </div>
    {option && (
      <div className="text-sm text-spark-text-secondary mt-1">
        {/* Until a deposit is deep enough to claim at maturity there is nothing
            for the provider to price, so that figure comes off onchain rates. */}
        {option.isEstimate && '~'}<SatAmount sats={option.feeSats} />
      </div>
    )}
  </button>
);

const UnclaimedDepositDetailsPage: React.FC<UnclaimedDepositDetailsPageProps> = ({
  deposit,
  onBack,
  onChanged,
}) => {
  const wallet = useWallet();
  const subscribeToSdkEvents = useSdkEvents();
  const { showToast } = useToast();

  // Parent keys this component on deposit identity, so the prop is stable per
  // mount and never picks up a later claim outcome. Everything after the first
  // read comes from handleClaim's retries or from the sync listener below.
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
  const [instantError, setInstantError] = useState<string | null>(null);
  const [quote, setQuote] = useState<FetchClaimDepositQuoteResponse | null>(null);
  const [preferEarly, setPreferEarly] = useState<boolean>(true);
  const [feeRequoted, setFeeRequoted] = useState(false);
  // Read by the sync listener, which must not re-price under a claim already
  // sent: the sheet would restate the fee, and could drop the button, while the
  // user is looking at "Processing...".
  const claimInFlightRef = useRef(false);

  const isConfirming = deposit ? !deposit.isMature : false;
  const isClaimInFlight = isClaimInFlightStatus(instantStatus);

  const early = earlyOption(quote);
  const confirmations = quote?.confirmations ?? 0;
  // Without an early route there is nothing to pick, but waiting is still worth
  // pricing: the breakdown shows what the automatic claim will cost.
  const chosen: ClaimDepositQuote | null = selectOption(quote, preferEarly);
  // Which fee is being priced: the provider's spread, or the onchain claim fee
  // that the matured path above already calls "Network fee".
  const chosenIsEarly = Boolean(early) && preferEarly;

  /** Switching route drops the last attempt's failure, which priced a different one. */
  const chooseRoute = (early_: boolean) => {
    setPreferEarly(early_);
    setInstantError(null);
    setFeeRequoted(false);
  };
  // Quoted is not claimable: an option whose floor is above the deposit's
  // current depth is an offer for N blocks' time, and claiming against it throws.
  const chosenReady = chosen ? isClaimable(chosen, confirmations) : false;
  const blocksLeft = chosen ? blocksToWait(chosen, confirmations) : 0;
  // What the deposit is doing, when nothing else on screen already says it. A
  // ready early route speaks through its own button, so it needs no line, and a
  // line about waiting would contradict the one being offered.
  const statusLine = isClaimInFlight
    // Says what the toast said, so reopening the sheet mid-settlement reports
    // the claim rather than showing an amount and nothing else.
    ? CLAIM_SUBMITTED_LINE
    : !isConfirming
      ? 'This transfer will be claimed automatically.'
      : chosen
        ? (blocksLeft > 0
            ? `Waiting for ${blocksLeft} confirmation${blocksLeft === 1 ? '' : 's'}.`
            // Nothing left to wait for, and no button on this route: the only
            // thing left to say is who does the claiming.
            : chosenIsEarly ? null : 'This transfer will be claimed automatically.')
        : 'Waiting for 3 confirmations.';

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
      await wallet.claimDeposit({ txid: deposit.txid, vout: deposit.vout, maxFee });
      // Remove from rejected list if it was there
      removeRejectedDeposit(deposit.txid, deposit.vout);
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
    }
  }, [wallet]);

  useEffect(() => {
    if (!deposit || deposit.isMature || isClaimInFlightStatus(deposit.instantClaimStatus)) return;
    // TEMPORARY: gated on the dev setting while the feature is being tested.
    // Skipping the quote is the whole gate, since the options, the breakdown and
    // the claim button all render off it: without one the sheet is what it was
    // before this feature. Remove this line to ship the choice to everyone.
    if (!isPriorityDepositClaimEnabled()) return;
    // loadQuote awaits the SDK before it sets anything, so nothing is written during this render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadQuote(deposit);
  }, [deposit, loadQuote]);

  // A quote is a snapshot at one depth. Left alone it goes stale in place: the
  // block that unlocks the early route lands, and the sheet still shows the
  // wait and no button until it is reopened.
  useEffect(() => {
    if (!deposit || deposit.isMature) return;
    // TEMPORARY: the same dev gate as the quote above, and it goes with it.
    if (!isPriorityDepositClaimEnabled()) return;
    let cancelled = false;
    const unsubscribe = subscribeToSdkEvents(event => {
      if (event.type !== 'synced' || claimInFlightRef.current) return;
      void (async () => {
        const found = await findFreshDeposit(wallet, deposit);
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
        // A deposit that matures with the sheet open gets claimed automatically,
        // and that claim can trip the fee ceiling. Without this the outcome sits
        // unread on the record and the approve panel never appears.
        setClaim(deriveClaimState(found.deposit));
        if (isClaimInFlightStatus(found.deposit.instantClaimStatus)) return;
        await loadQuote(deposit);
      })();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [deposit, dismissAsSettledRef, loadQuote, subscribeToSdkEvents, wallet]);

  const handleQuotedClaim = async () => {
    if (!deposit || !chosen) return;
    setInstantError(null);
    setFeeRequoted(false);
    setIsProcessing(true);
    claimInFlightRef.current = true;
    try {
      // At least the quoted fee, or the SDK declines this route and falls back
      // to waiting for maturity.
      const maxFee: MaxFee = { type: 'fixed', amount: chosen.feeSats };
      const { payment } = await wallet.claimDeposit({ txid: deposit.txid, vout: deposit.vout, maxFee });
      removeRejectedDeposit(deposit.txid, deposit.vout);
      // No payment means it was claimed early and settles asynchronously, so
      // nothing else will announce it: the sheet is about to close over it.
      // Marked first, or the next sync reports the same claim as news.
      if (!payment) {
        markClaimAnnounced(deposit);
        showToast('success', INSTANT_CLAIM_SUBMITTED_TOAST.title, INSTANT_CLAIM_SUBMITTED_TOAST.detail);
      }
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
        // A claim already in flight is not a failure to report: the SDK refuses
        // the second attempt, and the status line now says the first was taken.
        if (isClaimInFlightStatus(found.deposit.instantClaimStatus)) return;
      }
      // The price moves with depth, so a failure is a reason to re-price rather
      // than to retry against the figure that just failed.
      const fresh = selectOption(await loadQuote(deposit), preferEarly);
      if (fresh && fresh.feeSats > chosen.feeSats) {
        // A fee that outran the ceiling explains itself: the sheet has already
        // repriced, so the raw SDK message would only repeat it worse.
        setFeeRequoted(true);
        return;
      }
      setInstantError(e instanceof Error ? e.message : 'Failed to claim transfer');
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
          <div className="space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-y-none touch-pan-y">
          {/* Transaction ID */}
          <PaymentInfoCard>
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
              <FeeBreakdownCard
                items={chosen
                  ? [
                      { label: 'Amount', value: depositAmount },
                      // Same estimate caveat as the option cards above: an
                      // unpriced maturity fee is marked, not presented as firm.
                      { label: chosenIsEarly ? 'Priority fee' : 'Network fee', value: chosen.feeSats, prefix: chosen.isEstimate ? '~' : undefined },
                      { label: 'You receive', value: chosen.creditAmountSats, highlight: true },
                    ]
                  : [{ label: 'Amount', value: depositAmount, highlight: true }]}
              />

              {/* Both ways of claiming, priced. The pair always renders: with no
                  early route the provider declined to front this deposit, and
                  fading that card says so more plainly than dropping it. */}
              {quote && !isClaimInFlight && (
                <div className="flex gap-2" role="radiogroup" aria-label="How to claim">
                  <DeliveryOption
                    label="Priority"
                    active={Boolean(early) && preferEarly}
                    onSelect={() => chooseRoute(true)}
                    option={early}
                    wait={early ? formatWait(blocksToWait(early, confirmations)) : null}
                  />
                  <DeliveryOption
                    label="Standard"
                    active={!early || !preferEarly}
                    onSelect={() => chooseRoute(false)}
                    option={quote.mature}
                    wait={formatWait(blocksToWait(quote.mature, confirmations))}
                  />
                </div>
              )}

              {statusLine && (
                <p className="text-spark-text-muted text-sm text-center">{statusLine}</p>
              )}

              {feeRequoted && (
                /* The figure is in the breakdown and on the cards above, both
                   already repriced, so this only needs to say what to do. */
                <AlertCard variant="warning" title="Fee changed">
                  <p className="text-sm">Claim again to accept the new fee.</p>
                </AlertCard>
              )}

              <FormError error={instantError} />
            </>
          )}

          {/* Error message for failed automatic claim (non-fee error) */}
          {claimError && (
            <AlertCard variant="warning" title="Claim Failed">
              <p className="text-sm">{claimError}</p>
              <p className="text-spark-primary text-sm mt-2">You can reject to process a refund instead.</p>
            </AlertCard>
          )}

          </div>

          <div className="shrink-0 space-y-4 pt-4">
            {/* Only the early route is the user's to commit. Waiting is claimed
                automatically at maturity, so a button for it would race the
                SDK's own claim to do the same thing a moment sooner. A recorded
                fee means that automatic claim has already run and been refused,
                so the approve panel below owns the sheet. */}
            {isConfirming && !isClaimInFlight && chosenIsEarly && chosenReady && requiredFeeSats === null && (
              <PrimaryButton onClick={handleQuotedClaim} disabled={isProcessing} className="w-full">
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <SpinnerIcon size="md" />
                    Processing...
                  </span>
                ) : (
                  'Claim now'
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
