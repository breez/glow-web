import React from 'react';
import { AlertCard, SimpleAlert } from '@/components/AlertCard';
import { SatAmount } from '@/components/SatAmount';
import type { QuoteFigures } from '../quote';
import { DestinationRow, ErrorCard, LeftOutCard, ReceiveHero, ReviewBreakdown } from './ReviewParts';

const Verdict: React.FC<{ variant: 'info' | 'warning'; title: string; children: React.ReactNode }> = ({
  variant,
  title,
  children,
}) => (
  <AlertCard variant={variant} title={title}>
    <p className="text-sm">{children}</p>
  </AlertCard>
);

/**
 * The Recover Funds review: the same quote as the Unilateral Exit's, in this
 * flow's words. What a quote that moves something leaves out is shown as an
 * amount, never a reason: few reasons are anything the user can act on.
 */
export const RecoverReviewStep: React.FC<{
  figures: QuoteFigures;
  destination: string;
  /** Why the recovery did not start, under the review it was started from. */
  error?: string | null;
  /** A recovery is under way or its fee is being raised, so the quote named only its leaves. */
  underWay?: boolean;
  /** The recovery under way waits on the update tap rather than rebuilding by itself. */
  paused?: boolean;
}> = ({ figures, destination, error = null, underWay = false, paused = false }) => {
  const notWorthIt = (
    <Verdict variant="warning" title="Nothing is worth recovering right now">
      {underWay
        ? 'At this fee rate these funds would cost more to move on-chain than they are worth. Try a lower fee rate, or wait for the network to get cheaper.'
        : "At today's fee rates these funds would cost more to move on-chain than they are worth. Try again once the network is cheaper."}
    </Verdict>
  );

  if (figures.isEmpty) {
    if (paused) {
      return (
        <Verdict variant="info" title="Nothing to rebuild right now">
          Please update your recovery to continue.
        </Verdict>
      );
    }
    if (underWay) {
      return (
        <Verdict variant="info" title="Nothing to rebuild right now">
          Glow keeps your recovery moving on its own.
        </Verdict>
      );
    }
    switch (figures.leftOutReason) {
      case null:
        return (
          <Verdict variant="info" title="Nothing left to recover">
            These funds were already recovered.
          </Verdict>
        );
      case 'unavailable':
        return (
          <Verdict variant="warning" title="Nothing can be recovered right now">
            Try again later.
          </Verdict>
        );
      case 'fees':
        return notWorthIt;
      case 'notRecoverable':
        return (
          <Verdict variant="info" title="Nothing left to recover">
            These funds can&apos;t be recovered.
          </Verdict>
        );
    }
  }

  if (!figures.isWorthMoving) return notWorthIt;

  return (
    <div className="space-y-4">
      <ReceiveHero figures={figures} />
      <DestinationRow address={destination} />
      <ReviewBreakdown figures={figures} amounts={[{ label: 'Funds', value: figures.fundsSat }]} feeLabel="Network fee" />

      {/* Under way, the build spends what the fee address holds first, so this may cost nothing. */}
      {figures.needsFunding && !underWay && (
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

      {error && (
        <ErrorCard
          title={underWay ? 'Could not continue the recovery' : 'Could not recover the funds'}
          error={error}
          testId="unilateral-exit-recover-error"
        />
      )}
    </div>
  );
};
