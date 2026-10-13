import React from 'react';
import { ErrorMessageBox } from '@/components/ui';
import { AlertCard, SimpleAlert } from '@/components/AlertCard';
import { SatAmount } from '@/components/SatAmount';
import type { QuoteFigures } from '../quote';
import { DestinationRow, LeftOutCard, ReceiveHero, ReviewBreakdown } from './ReviewParts';

/**
 * The Recover Funds review: the same quote as the Unilateral Exit's, in this
 * flow's words. Whatever the quote leaves out is shown as an amount, never a
 * reason: few reasons are anything the user can act on.
 */
export const RecoverReviewStep: React.FC<{
  figures: QuoteFigures;
  destination: string;
  /** Why the recovery did not start, under the review it was started from. */
  error?: string | null;
}> = ({ figures, destination, error = null }) => {
  // The SDK may have skipped every leaf of an empty quote for any reason, fees
  // among them, so Glow blames the fees only for a quote that moves something.
  // With nothing skipped either, it left out leaves it found already recovered.
  if (figures.isEmpty && figures.leftOutSat === 0) {
    return (
      <AlertCard variant="info" title="Nothing left to recover">
        <p className="text-sm">These funds were already recovered.</p>
      </AlertCard>
    );
  }
  if (figures.isEmpty) {
    return (
      <AlertCard variant="warning" title="Nothing can be recovered right now">
        <p className="text-sm">Try again later.</p>
      </AlertCard>
    );
  }

  if (!figures.isWorthMoving) {
    return (
      <AlertCard variant="warning" title="Nothing is worth recovering right now">
        <p className="text-sm">
          At today&apos;s fee rates these funds would cost more to move on-chain than they are worth. Try again
          once the network is cheaper.
        </p>
      </AlertCard>
    );
  }

  return (
    <div className="space-y-4">
      <ReceiveHero figures={figures} />
      <DestinationRow address={destination} />
      <ReviewBreakdown figures={figures} amounts={[{ label: 'Funds', value: figures.fundsSat }]} feeLabel="Network fee" />

      {figures.needsFunding && (
        <SimpleAlert variant="warning" hideIcon>
          {figures.isCooperative ? (
            <>
              <SatAmount sats={figures.recoverableReceiveSat} /> goes to this address now. The other{' '}
              <SatAmount sats={figures.balanceReceiveSat} /> needs the exit fee from another wallet, then
              takes several days.
            </>
          ) : (
            <>
              To start the recovery you need to pay the exit fee from another wallet. These are the mining fees that
              move your funds on-chain, which takes several days.
            </>
          )}
        </SimpleAlert>
      )}

      {figures.leftOutSat > 0 && (
        <LeftOutCard title="Some funds stay behind">
          <SatAmount sats={figures.leftOutSat} /> is left out of this recovery.
        </LeftOutCard>
      )}

      {error && <ErrorMessageBox title="Could not recover the funds" error={error} />}
    </div>
  );
};
