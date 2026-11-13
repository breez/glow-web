import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
  /** The fee address already holds the exit fee, so nothing needs paying from another wallet. */
  feeHeld?: boolean;
  /** What of the exit fee the recovery under way still needs. */
  exitFeeDueSat?: number | null;
}> = ({ figures, destination, error = null, underWay = false, paused = false, feeHeld = false, exitFeeDueSat }) => {
  const { t } = useTranslation('common');
  const notWorthIt = (
    <Verdict variant="warning" title={t('exit.nothingWorth_recover')}>
      {t('exit.notWorthRecover')}
    </Verdict>
  );

  if (figures.isEmpty) {
    if (paused) {
      return (
        <Verdict variant="info" title={t('exit.nothingToRebuild')}>
          {t('exit.pleaseUpdateRecovery')}
        </Verdict>
      );
    }
    if (underWay) {
      return (
        <Verdict variant="info" title={t('exit.nothingToRebuild')}>
          {t('exit.keepsMovingRecovery')}
        </Verdict>
      );
    }
    switch (figures.leftOutReason) {
      case null:
        return (
          <Verdict variant="info" title={t('exit.nothingLeftToRecover')}>
            {t('exit.alreadyRecovered')}
          </Verdict>
        );
      case 'unavailable':
        return (
          <Verdict variant="warning" title={t('exit.unavailable_recover')}>
            {t('exit.tryAgainLater')}
          </Verdict>
        );
      case 'fees':
        return notWorthIt;
      case 'notRecoverable':
        return (
          <Verdict variant="info" title={t('exit.nothingLeftToRecover')}>
            {t('exit.cannotBeRecovered')}
          </Verdict>
        );
    }
  }

  if (!figures.isWorthMoving) return notWorthIt;

  return (
    <div className="space-y-4">
      <ReceiveHero figures={figures} />
      <DestinationRow address={destination} />
      <ReviewBreakdown
        figures={figures}
        amounts={[{ label: t('exit.funds'), value: figures.fundsSat }]}
        feeLabel={t('labels.networkFee')}
        exitFeeDueSat={exitFeeDueSat}
      />

      {/* Under way, the build spends what the fee address holds first, so this may cost nothing. */}
      {figures.needsFunding && !underWay && !feeHeld && (
        <SimpleAlert variant="warning" hideIcon>
          {figures.isCooperative ? (
            <Trans
              i18nKey="common:exit.cooperativeSplitNotice"
              components={{
                now: <SatAmount sats={figures.recoverableReceiveSat} />,
                later: <SatAmount sats={figures.balanceReceiveSat} />,
              }}
            />
          ) : (
            t('exit.payExitFeeRecoverNotice')
          )}
        </SimpleAlert>
      )}

      {figures.leftOutSat > 0 && (
        <LeftOutCard title={t('exit.fundsStayBehind')}>
          <Trans
            i18nKey="common:exit.staysBehindRecovery"
            components={{ amount: <SatAmount sats={figures.leftOutSat} /> }}
          />
        </LeftOutCard>
      )}

      {error && (
        <ErrorCard
          title={underWay ? t('exit.couldNotContinue_recover') : t('exit.couldNotRecoverFunds')}
          error={error}
          testId="unilateral-exit-recover-error"
        />
      )}
    </div>
  );
};
