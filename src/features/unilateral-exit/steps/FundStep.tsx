import React, { useEffect, useState } from 'react';
import { AlertCard } from '@/components/AlertCard';
import { FeeBreakdownCard } from '@/components/FeeBreakdownCard';
import { CopyableText, ErrorMessageBox, PrimaryButton, QRCodeContainer } from '@/components/ui';
import { SatAmount } from '@/components/SatAmount';
import { CheckIcon, ClockIcon } from '@/components/Icons';
import { useToast } from '@/contexts/ToastContext';
import type { FundingFields } from '../hooks/useUnilateralExitFlow';

const QUOTE_AGE_TICK_MS = 30_000;

const quoteAge = (quotedAt: number): string => {
  const minutes = Math.floor((Date.now() - quotedAt) / 60_000);
  if (minutes < 1) return 'quoted just now';
  return minutes < 60 ? `quoted ${minutes}m ago` : `quoted ${Math.floor(minutes / 60)}h ago`;
};

/** A top-up still waiting for coins. The page keeps it by the action, where it stays on screen as it changes. */
export const FundingStatus: React.FC<
  Pick<FundingFields, 'isResuming' | 'hasPendingDeposit' | 'quotedAt'>
> = ({ isResuming, hasPendingDeposit, quotedAt }) => {
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
        {/* The exit's own unconfirmed transactions pay this address too, so
            only a fresh exit can tell a pending deposit apart. */}
        {!isResuming && hasPendingDeposit ? 'Waiting for a confirmation' : 'Watching the address'}
        {quotedAt !== null && ` · ${quoteAge(quotedAt)}`}
      </p>
    </div>
  );
};

export const FundStep: React.FC<
  FundingFields & {
    error: string | null;
    /** A resumed exit's top-up opens on what it costs, and shows where to pay once asked. */
    isPaying: boolean;
    onTopUp: () => void;
  }
> = ({
  address,
  requiredSat,
  isFunded,
  hasPendingDeposit,
  isResuming,
  topUp,
  isFeeBudgetFixed,
  feeRate,
  currentFeeRate,
  error,
  isPaying,
  onTopUp,
}) => {
  const { showToast } = useToast();

  const askSat = topUp ? topUp.stillToSendSat : isResuming ? 0 : requiredSat;
  // BIP21 so the paying wallet fills the amount in as well as the address:
  // this is money sent from somewhere else, and the figure has to be exact.
  const btc = (askSat / 100_000_000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const qrValue = askSat > 0 ? `bitcoin:${address}?amount=${btc}` : address;
  const feesRose = isResuming && currentFeeRate !== null && feeRate > currentFeeRate;

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

  // A resumed exit tries its build before asking for anything, so without a
  // top-up there is nothing to pay here: only a failure to explain.
  if (isResuming && !topUp) {
    return error ? (
      <ErrorMessageBox title="Could not continue the exit" error={error} />
    ) : (
      <p className="text-sm text-spark-text-secondary text-center">
        Continue the exit at {feeRate} sat/vB.
      </p>
    );
  }

  const paymentTarget = (
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

  // The send flow's result shape: an instruction to pay reads as wrong once it
  // is paid, so the step becomes the receipt instead.
  const receipt = (
    <div className="py-6 flex flex-col items-center">
      <div className="relative mb-4">
        <div className="absolute inset-0 w-20 h-20 rounded-full blur-xl bg-spark-success/30" />
        <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-spark-success/20 border-2 border-spark-success">
          <CheckIcon className="w-10 h-10 text-spark-success" />
        </div>
      </div>
      <h3 className="font-display text-xl font-bold text-spark-text-primary">Exit fee received</h3>
    </div>
  );

  if (topUp) {
    if (topUp.stillToSendSat === 0) return receipt;
    const breakdown = (
      <FeeBreakdownCard
        items={[
          { label: `Exit fee at ${feeRate} sat/vB`, value: topUp.neededSat },
          { label: "You've already sent", value: topUp.sentSat, subtract: true },
          { label: 'Still to send', value: topUp.stillToSendSat, highlight: true },
        ]}
      />
    );
    const ask = (label: string) => (
      <div className="text-center py-2">
        <p className="text-spark-text-muted text-sm mb-2">{label}</p>
        <SatAmount sats={topUp.stillToSendSat} className="text-4xl font-bold text-spark-text-primary" />
      </div>
    );

    // Waiting costs nothing, so a resumed exit shows what continuing now costs
    // before it shows anywhere to pay.
    if (isResuming && !isPaying) {
      return (
        <div className="space-y-4">
          {breakdown}
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

    if (isResuming) {
      return (
        <div className="space-y-4">
          {ask('Send to Continue Exit')}
          {paymentTarget}
        </div>
      );
    }

    // A fresh exit cannot start without it, so there is no choice to make first.
    return (
      <div className="space-y-4">
        {ask('Send to Exit Spark')}
        {paymentTarget}
        {breakdown}
        <AlertCard variant="warning" title="The exit needs more">
          <p className="text-sm">
            At {feeRate} sat/vB, building the exit takes more than its quote. Sending the amount above
            starts it.
          </p>
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isFunded ? (
        receipt
      ) : (
        <>
          <div className="text-center py-2">
            <p className="text-spark-text-muted text-sm mb-2">Pay exit fee</p>
            <SatAmount sats={requiredSat} className="text-4xl font-bold text-spark-text-primary" />
          </div>

          {paymentTarget}

          <div className="flex items-center justify-center gap-2">
            <ClockIcon className="shrink-0 text-spark-primary" />
            <p className="text-sm text-spark-text-secondary">
              {hasPendingDeposit ? 'Waiting for a confirmation' : 'Waiting for your deposit'}
            </p>
          </div>
        </>
      )}

      {error && <ErrorMessageBox title="Could not build the exit" error={error} />}
    </div>
  );
};
