import { CopyableRow, ErrorMessageBox, LoadingSpinner } from '@/components/ui';
import React from 'react';
import { AlertCard, SimpleAlert } from '@/components/AlertCard';
import { FeeBreakdownCard, type FeeBreakdownItem } from '@/components/FeeBreakdownCard';
import { SatAmount } from '@/components/SatAmount';
import { truncateAddress } from '@/utils/crossChainFormat';
import { cooperativeFeeSats } from '../driver';
import type { QuoteFields } from '../hooks/useUnilateralExitFlow';

export const QuoteStep: React.FC<QuoteFields> = ({
  quote,
  sweepFeeSat,
  willReceiveSat,
  isQuoting,
  error,
  leftBehindSat,
  recoverableFundsSat = 0,
}) => {
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

  if (!quote || quote.leaves.length === 0) {
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

  if (quote.totalFeeSat >= quote.recoverableValueSat || willReceiveSat <= 0) {
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

  // Recoverable funds sit outside the balance, so they get their own row rather
  // than a Balance that no longer matches the wallet's. Co-signed recoveries
  // add their fee to the sweep's, so the row is no longer the sweep's alone.
  const isCosigned = recoverableFundsSat > 0 || cooperativeFeeSats(quote) > 0;
  const items: FeeBreakdownItem[] = [
    { label: 'Balance', value: quote.recoverableValueSat - recoverableFundsSat },
    ...(recoverableFundsSat > 0 ? [{ label: 'Recoverable Funds', value: recoverableFundsSat }] : []),
    { label: isCosigned ? 'Network fee' : 'Sweep fee', value: sweepFeeSat, approximate: true },
    { label: 'Exit fee', value: quote.singleUtxoFundingSat, highlight: true },
  ];

  return (
    <div className="space-y-4">
      <div className="text-center py-2">
        <p className="text-spark-text-muted text-sm mb-2">You&apos;ll receive</p>
        {/* Approximate: a refund the operators' watchtower lands first pays
            its own fee, which the quote cannot know in advance. */}
        <SatAmount
          sats={willReceiveSat}
          approximate
          className="text-4xl font-bold text-spark-text-primary"
        />
      </div>

      <CopyableRow
        label="To address"
        value={quote.destination}
        display={truncateAddress(quote.destination, 32)}
        data-testid="unilateral-exit-quote-destination"
      />

      <FeeBreakdownCard items={items} />

      <SimpleAlert variant="warning" hideIcon>
        To start the process you need to pay the exit fee. These are the mining fees required to
        move the Spark tree on-chain.
      </SimpleAlert>

      {leftBehindSat > 0 && (
        <AlertCard variant="warning" title="Some of your balance stays behind">
          <p className="text-sm">
            <SatAmount sats={leftBehindSat} /> sits in pieces too small to be worth their own
            on-chain fee at this rate, so they are left out of this exit.
          </p>
        </AlertCard>
      )}

    </div>
  );
};
