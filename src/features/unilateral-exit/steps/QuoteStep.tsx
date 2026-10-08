import { ErrorMessageBox, LoadingSpinner } from '@/components/ui';
import React from 'react';
import { AlertCard, SimpleAlert } from '@/components/AlertCard';
import { SatAmount } from '@/components/SatAmount';
import type { QuoteFields } from '../hooks/useUnilateralExitFlow';
import { DestinationRow, LeftOutCard, ReceiveHero, ReviewBreakdown } from './ReviewParts';

export const QuoteStep: React.FC<QuoteFields> = ({ quote, figures, isQuoting, error }) => {
  if (isQuoting) {
    return (
      <div className="py-16 flex justify-center">
        <LoadingSpinner text="Working out what can be exited..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <ErrorMessageBox title="Could not quote the exit" error={error} />
      </div>
    );
  }

  if (!quote || !figures || figures.isEmpty) {
    return (
      <div className="space-y-6">
        <AlertCard variant="warning" title="Nothing here to exit">
          <p className="text-sm">
            This wallet holds no funds on Spark that can be moved on-chain. If you were expecting
            some, the leaf data this needs may be missing from this device.
          </p>
        </AlertCard>
      </div>
    );
  }

  if (!figures.isWorthMoving) {
    return (
      <div className="space-y-6">
        <AlertCard variant="warning" title="Nothing is worth exiting right now">
          <p className="text-sm">
            At this fee rate every part of your balance would cost more to move on-chain than it is
            worth. Try a lower fee rate, or wait for the network to get cheaper.
          </p>
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ReceiveHero figures={figures} />

      <DestinationRow address={quote.destination} testId="unilateral-exit-quote-destination" />

      {/* Recoverable funds sit outside the balance, so they get their own row
          rather than a Balance that no longer matches the wallet's. */}
      <ReviewBreakdown
        figures={figures}
        amounts={[
          { label: 'Balance', value: figures.balanceSat },
          ...(figures.recoverableSat > 0 ? [{ label: 'Recoverable Funds', value: figures.recoverableSat }] : []),
        ]}
        feeLabel={figures.isCooperative ? 'Network fee' : 'Sweep fee'}
      />

      {figures.needsFunding && (
        <SimpleAlert variant="warning" hideIcon>
          To start the process you need to pay the exit fee. These are the mining fees required to
          move the Spark tree on-chain.
        </SimpleAlert>
      )}

      {figures.leftOutSat > 0 && (
        <LeftOutCard title="Some of your balance stays behind">
          <SatAmount sats={figures.leftOutSat} /> sits in pieces too small to be worth their own
          on-chain fee at this rate, so they are left out of this exit.
        </LeftOutCard>
      )}

    </div>
  );
};
