import React from 'react';
import { AlertCard } from '@/components/AlertCard';
import { CopyableText, ErrorMessageBox, QRCodeContainer } from '@/components/ui';
import { SatAmount } from '@/components/SatAmount';
import { CheckIcon, ClockIcon } from '@/components/Icons';
import { useToast } from '@/contexts/ToastContext';
import type { FundingFields } from '../hooks/useUnilateralExitFlow';

export const FundStep: React.FC<FundingFields & { error: string | null }> = ({
  address,
  requiredSat,
  fundedSat,
  isFunded,
  hasPendingDeposit,
  isResuming,
  requiredFundingSat,
  isFeeBudgetFixed,
  error,
}) => {
  const { showToast } = useToast();
  // After a build names what it needs, the address is asked only for the gap.
  const shortfallSat =
    requiredFundingSat !== null ? Math.max(0, requiredFundingSat - fundedSat) : 0;
  const askSat = shortfallSat > 0 ? shortfallSat : isResuming ? 0 : requiredSat;
  // BIP21 so the paying wallet fills the amount in as well as the address:
  // this is money sent from somewhere else, and the figure has to be exact.
  const btc = (askSat / 100_000_000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  const qrValue = askSat > 0 ? `bitcoin:${address}?amount=${btc}` : address;

  if (isResuming && requiredFundingSat !== null && isFeeBudgetFixed) {
    return (
      <AlertCard variant="warning" title="This fee rate is too high">
        <p className="text-sm">
          The rest of this exit cannot pay it. Go back and choose a lower fee rate.
        </p>
      </AlertCard>
    );
  }
  // A resumed exit can still be asked for more, so it keeps the paying view
  // even once the original fee is in.
  const isPaid = isFunded && !isResuming;

  return (
  <div className="space-y-4">
    {isPaid ? (
      // The send flow's result shape: an instruction to pay reads as wrong
      // once it is paid, so the step becomes the receipt instead.
      <div className="py-6 flex flex-col items-center">
        <div className="relative mb-4">
          <div className="absolute inset-0 w-20 h-20 rounded-full blur-xl bg-spark-success/30" />
          <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-spark-success/20 border-2 border-spark-success">
            <CheckIcon className="w-10 h-10 text-spark-success" />
          </div>
        </div>
        <h3 className="font-display text-xl font-bold text-spark-text-primary">Exit fee received</h3>
      </div>
    ) : (
      <>
        <div className="text-center py-2">
          <p className="text-spark-text-muted text-sm mb-2">
            {shortfallSat > 0 ? 'Add to exit fee' : 'Pay exit fee'}
          </p>
          <SatAmount
            sats={shortfallSat > 0 ? shortfallSat : isResuming ? fundedSat : requiredSat}
            className="text-4xl font-bold text-spark-text-primary"
          />
        </div>

        {/* The same control the receive sheet gives a bitcoin address, so the
            address copies and shares rather than sitting in a row of its own. */}
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

        <div className="flex items-center justify-center gap-2">
          {isFunded ? (
            <CheckIcon className="shrink-0 text-spark-success" />
          ) : (
            <ClockIcon className="shrink-0 text-spark-primary" />
          )}
          <p className="text-sm text-spark-text-secondary">
            {isFunded
              ? 'Exit fee received'
              : hasPendingDeposit
                ? 'Waiting for a confirmation'
                : 'Waiting for your deposit'}
          </p>
        </div>
      </>
    )}

    {/* A shortfall is the amount above, so its raw message would only repeat it. */}
    {error && requiredFundingSat === null && (
      <ErrorMessageBox title="Could not build the exit" error={error} />
    )}

    {requiredFundingSat !== null ? (
      <p className="text-spark-text-muted text-xs">
        At this fee rate the exit needs <SatAmount sats={requiredFundingSat} /> at this address, and
        it holds <SatAmount sats={fundedSat} />.
      </p>
    ) : (
      isResuming && (
        <p className="text-spark-text-muted text-xs">
          This exit is part-way done, and what it has left is paid for by the{' '}
          <SatAmount sats={fundedSat} /> already at this address.
        </p>
      )
    )}

  </div>
  );
};
