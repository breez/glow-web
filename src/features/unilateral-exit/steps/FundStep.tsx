import React, { useEffect, useState } from 'react';
import { AlertCard } from '@/components/AlertCard';
import { FeeBreakdownCard } from '@/components/FeeBreakdownCard';
import { CollapsibleSection, CopyableText, ErrorMessageBox, LoadingSpinner, PrimaryButton, QRCodeContainer } from '@/components/ui';
import { SatAmount } from '@/components/SatAmount';
import { CheckIcon, ClockIcon, CloseIcon } from '@/components/Icons';
import { useToast } from '@/contexts/ToastContext';
import type { ChainUtxo } from '@/services/chain';
import { isPendingFunded, pendingTopUp, type PendingExit, type TopUp } from '../driver';
import { BackupActions, ExitActionRow } from '../BackupCard';
import type { FundingFields } from '../hooks/useUnilateralExitFlow';

const QUOTE_AGE_TICK_MS = 30_000;

const quoteAge = (quotedAt: number): string => {
  const minutes = Math.floor((Date.now() - quotedAt) / 60_000);
  if (minutes < 1) return 'quoted just now';
  return minutes < 60 ? `quoted ${minutes}m ago` : `quoted ${Math.floor(minutes / 60)}h ago`;
};

/** A top-up still waiting for coins. The page keeps it by the action, where it stays on screen as it changes. */
export const FundingStatus: React.FC<Pick<FundingFields, 'quotedAt'>> = ({ quotedAt }) => {
  // The quote's age is the one figure here that goes stale on its own.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(tick => tick + 1), QUOTE_AGE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-center justify-center gap-2" data-testid="unilateral-exit-funding-status">
      <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-spark-warning animate-pulse" />
      <p className="text-sm text-spark-text-secondary">
        Watching the address
        {quotedAt !== null && ` · ${quoteAge(quotedAt)}`}
      </p>
    </div>
  );
};

const Ask: React.FC<{ label: string; sat: number }> = ({ label, sat }) => (
  <div className="text-center py-2">
    <p className="text-spark-text-muted text-sm mb-2">{label}</p>
    <SatAmount sats={sat} className="text-4xl font-bold text-spark-text-primary" />
  </div>
);

const PaymentTarget: React.FC<{ address: string; amountSat: number }> = ({ address, amountSat }) => {
  const { showToast } = useToast();
  // BIP21 so the paying wallet fills the amount in as well as the address:
  // this is money sent from somewhere else, and the figure has to be exact.
  const btc = (amountSat / 100_000_000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const qrValue = amountSat > 0 ? `bitcoin:${address}?amount=${btc}` : address;
  return (
    // The same control the receive sheet gives a bitcoin address, so the
    // address copies and shares rather than sitting in a row of its own.
    <div className="flex flex-col items-center gap-4">
      {/* Sized so the copy and share controls stay on screen with it: this
          is the one screen that exists to copy an address, and at 180 they
          fell below the sheet's fold on a phone. Still above what a camera
          needs at 3x. */}
      <QRCodeContainer value={qrValue} size={130} />
      <CopyableText
        text={address}
        truncate
        showShare
        label="Exit fee address"
        onCopied={() => showToast('success', 'Copied!')}
        onShareError={() => showToast('error', 'Failed to share')}
        data-testid="unilateral-exit-funding-address"
      />
    </div>
  );
};

// The send flow's result shape: an instruction to pay reads as wrong once it
// is paid, so the step becomes the receipt instead. What it waits on sits
// under the title, as a result's detail line does.
const Receipt: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div className="pt-6 flex flex-col items-center">
    <div className="relative mb-4">
      <div className="absolute inset-0 w-20 h-20 rounded-full blur-xl bg-spark-success/30" />
      <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-spark-success/20 border-2 border-spark-success">
        <CheckIcon className="w-10 h-10 text-spark-success" />
      </div>
    </div>
    <h3 className="font-display text-xl font-bold text-spark-text-primary">Exit fee received</h3>
    {children && <div className="mt-2 space-y-2">{children}</div>}
  </div>
);

const Breakdown: React.FC<{ topUp: TopUp; feeRate: number }> = ({ topUp, feeRate }) => (
  <FeeBreakdownCard
    items={[
      { label: `Exit fee at ${feeRate} sat/vB`, value: topUp.neededSat },
      { label: "You've already sent", value: topUp.sentSat, subtract: true },
      { label: 'Still to send', value: topUp.stillToSendSat, highlight: true },
    ]}
  />
);

const Status: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center justify-center gap-2" data-testid="unilateral-exit-pending-status">
    <ClockIcon className="shrink-0 text-spark-primary" />
    <p className="text-sm text-spark-text-secondary">{children}</p>
  </div>
);

/** A higher fee for an exit under way. */
export const FundStep: React.FC<
  FundingFields & {
    error: string | null;
    /** A top-up opens on what it costs, and shows where to pay once asked. */
    isPaying: boolean;
    onTopUp: () => void;
  }
> = ({ address, topUp, isFeeBudgetFixed, feeRate, currentFeeRate, error, isPaying, onTopUp }) => {
  if (topUp && isFeeBudgetFixed) {
    return (
      <AlertCard variant="warning" title="Network fees went up">
        <p className="text-sm">
          Your exit started at {currentFeeRate} sat/vB, and its fee is fixed now, so sending more
          cannot raise it. It continues on its own once fees drop, or you can go back and choose a
          lower rate.
        </p>
      </AlertCard>
    );
  }

  // The build is tried before anything is asked for, so without a top-up there
  // is nothing to pay here: only a failure to explain.
  if (!topUp) {
    return error ? (
      <ErrorMessageBox title="Could not continue the exit" error={error} />
    ) : (
      <p className="text-sm text-spark-text-secondary text-center">
        Continue the exit at {feeRate} sat/vB.
      </p>
    );
  }

  if (topUp.stillToSendSat === 0) return <Receipt />;

  // Waiting costs nothing, so the step shows what continuing now costs before
  // it shows anywhere to pay.
  if (!isPaying) {
    const feesRose = currentFeeRate !== null && feeRate > currentFeeRate;
    return (
      <div className="space-y-4">
        <Breakdown topUp={topUp} feeRate={feeRate} />
        <AlertCard variant="warning" title={feesRose ? 'Network fees went up' : 'The exit needs more'}>
          <p className="text-sm">
            {feesRose
              ? `Your exit started at ${currentFeeRate} sat/vB and continues on its own once fees drop, but they can also keep rising. To continue now at ${feeRate} sat/vB, top up the exit fee address.`
              : `At ${feeRate} sat/vB, the exit needs more at its fee address.`}
          </p>
          <div className="mt-3">
            <PrimaryButton onClick={onTopUp} className="w-full" data-testid="unilateral-exit-top-up">
              Top Up to Continue
            </PrimaryButton>
          </div>
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Ask label="Send to Continue Exit" sat={topUp.stillToSendSat} />
      <PaymentTarget address={address} amountSat={topUp.stillToSendSat} />
    </div>
  );
};

/** A fresh exit waiting on its fee. It is saved, so the sheet can close at any point here, and Exit Spark starts it once the fee confirms. */
export const PendingExitStep: React.FC<{
  pending: PendingExit;
  coins: ChainUtxo[];
  nothingToExit: boolean;
  isStarting: boolean;
  startError: string | null;
  onCancel: () => void;
}> = ({ pending, coins, nothingToExit, isStarting, startError, onCancel }) => {
  const [advanced, setAdvanced] = useState(false);
  const topUp = pendingTopUp(pending, coins);

  if (isStarting) {
    return (
      <div className="py-16 flex justify-center">
        <LoadingSpinner text="Building and signing the exit..." />
      </div>
    );
  }

  const body = (() => {
    if (nothingToExit) {
      return (
        <AlertCard variant="warning" title="Nothing is worth exiting right now">
          <p className="text-sm">
            At {pending.feeRateSatPerVbyte} sat/vB your balance would cost more to move on-chain than it
            is worth. Cancel it under Advanced and start again at a lower rate. The fee you sent counts
            toward it.
          </p>
        </AlertCard>
      );
    }
    if (topUp.stillToSendSat > 0) {
      return (
        <>
          <Ask label="Send from another wallet" sat={topUp.stillToSendSat} />
          <PaymentTarget address={pending.fundingAddress} amountSat={topUp.stillToSendSat} />
          <Status>
            {topUp.sentSat > 0 ? <><SatAmount sats={topUp.sentSat} /> received</> : 'Waiting for your payment'}
          </Status>
        </>
      );
    }
    if (!isPendingFunded(pending, coins)) {
      return (
        <Receipt>
          <Status>Waiting for a confirmation</Status>
          {/* Paid is where the wait is, so it is where closing needs saying. */}
          <p className="text-spark-text-muted text-xs text-center text-balance">
            You can close this. Come back to start the exit once the fee confirms.
          </p>
        </Receipt>
      );
    }
    return (
      <>
        <Receipt />
        {startError && <ErrorMessageBox title="Could not start the exit" error={startError} />}
      </>
    );
  })();

  return (
    <div className="space-y-4">
      {body}
      {/* Out of the way, as on the intro and the tracker. Nothing is lost by
          cancelling: coins already sent count toward the next exit. */}
      <CollapsibleSection label="Advanced" isVisible={advanced} onToggle={() => setAdvanced(v => !v)} bare>
        <BackupActions>
          <ExitActionRow label="Cancel exit" icon={<CloseIcon size="md" />} onClick={onCancel} testId="unilateral-exit-cancel" />
        </BackupActions>
      </CollapsibleSection>
    </div>
  );
};
