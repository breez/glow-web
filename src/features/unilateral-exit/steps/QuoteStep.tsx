import { LoadingSpinner } from '@/components/ui';
import React from 'react';
import { AlertCard, SimpleAlert } from '@/components/AlertCard';
import { SatAmount } from '@/components/SatAmount';
import type { QuoteFields } from '../hooks/useUnilateralExitFlow';
import { DestinationRow, ErrorCard, LeftOutCard, ReceiveHero, ReviewBreakdown } from './ReviewParts';

export const QuoteStep: React.FC<
  QuoteFields & {
    /** An exit is under way, so the quote named only its leaves. */
    underWay?: boolean;
    /** That exit waits on the update tap rather than rebuilding by itself. */
    paused?: boolean;
    noun?: string;
    /** The fee address already holds the exit fee, so nothing needs paying from another wallet. */
    feeHeld?: boolean;
    /** What of the exit fee the exit under way still needs. */
    exitFeeDueSat?: number | null;
  }
> = ({ quote, figures, isQuoting, error, underWay = false, paused = false, noun = 'exit', feeHeld = false, exitFeeDueSat }) => {
  if (isQuoting) {
    return (
      <div className="py-16 flex justify-center">
        <LoadingSpinner text={`Working out what can be ${noun === 'exit' ? 'exited' : 'recovered'}...`} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <ErrorCard title={`Could not quote the ${noun}`} error={error} testId="unilateral-exit-quote-error" />
      </div>
    );
  }

  const notWorthIt = (
    <div className="space-y-6">
      <AlertCard variant="warning" title="Nothing is worth exiting right now">
        <p className="text-sm">
          {underWay
            ? 'At this fee rate what is left of your exit would cost more to move on-chain than it is worth. Try a lower fee rate, or wait for the network to get cheaper.'
            : 'At this fee rate every part of your balance would cost more to move on-chain than it is worth. Try a lower fee rate, or wait for the network to get cheaper.'}
        </p>
      </AlertCard>
    </div>
  );

  if (!quote || !figures || figures.isEmpty) {
    if (underWay) {
      return (
        <div className="space-y-6">
          <AlertCard variant="info" title="Nothing to rebuild right now">
            <p className="text-sm">
              {paused ? 'Please update your unilateral exit to continue.' : 'Glow keeps your exit moving on its own.'}
            </p>
          </AlertCard>
        </div>
      );
    }
    if (figures?.leftOutReason === 'fees') return notWorthIt;
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

  if (!figures.isWorthMoving) return notWorthIt;

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
        exitFeeDueSat={exitFeeDueSat}
      />

      {/* Under way, the build spends what the fee address holds first, so this may cost nothing. */}
      {figures.needsFunding && !underWay && !feeHeld && (
        <SimpleAlert variant="warning" hideIcon>
          To start the process you need to pay the exit fee. These are the mining fees required to
          move the Spark tree on-chain.
        </SimpleAlert>
      )}

      {/* The SDK skips leaves for many reasons, few the user can act on, so
          Glow names a reason only when every one is that the fee eats it. */}
      {figures.leftOutSat > 0 &&
        (figures.leftOutForFees ? (
          <LeftOutCard title="Some of your balance stays behind">
            <SatAmount sats={figures.leftOutSat} /> sits in pieces too small to be worth their own
            on-chain fee at this rate, so they are left out of this exit.
          </LeftOutCard>
        ) : (
          <LeftOutCard title="Some funds stay behind">
            <SatAmount sats={figures.leftOutSat} /> is left out of this exit.
          </LeftOutCard>
        ))}

    </div>
  );
};
