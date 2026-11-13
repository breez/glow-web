import { LoadingSpinner } from '@/components/ui';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertCard, SimpleAlert } from '@/components/AlertCard';
import { SatAmount } from '@/components/SatAmount';
import type { ExitMode } from '../model/plan';
import type { QuoteFields } from '../hooks/useUnilateralExitFlow';
import { DestinationRow, ErrorCard, LeftOutCard, ReceiveHero, ReviewBreakdown } from './ReviewParts';

export const QuoteStep: React.FC<
  QuoteFields & {
    /** An exit is under way, so the quote named only its leaves. */
    underWay?: boolean;
    /** That exit waits on the update tap rather than rebuilding by itself. */
    paused?: boolean;
    mode?: ExitMode;
    /** The fee address already holds the exit fee, so nothing needs paying from another wallet. */
    feeHeld?: boolean;
    /** What of the exit fee the exit under way still needs. */
    exitFeeDueSat?: number | null;
  }
> = ({ quote, figures, isQuoting, error, underWay = false, paused = false, mode = 'exit', feeHeld = false, exitFeeDueSat }) => {
  const { t } = useTranslation('common');
  if (isQuoting) {
    return (
      <div className="py-16 flex justify-center">
        <LoadingSpinner text={t(`exit.workingOut_${mode}`)} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <ErrorCard title={t(`exit.couldNotQuote_${mode}`)} error={error} testId="unilateral-exit-quote-error" />
      </div>
    );
  }

  const notWorthIt = (
    <div className="space-y-6">
      <AlertCard variant="warning" title={t('exit.nothingWorth_exit')}>
        <p className="text-sm">
          {underWay ? t('exit.notWorthRemaining') : t('exit.notWorthWhole')}
        </p>
      </AlertCard>
    </div>
  );

  if (!quote || !figures || figures.isEmpty) {
    if (underWay) {
      return (
        <div className="space-y-6">
          <AlertCard variant="info" title={t('exit.nothingToRebuild')}>
            <p className="text-sm">
              {paused ? t('exit.pleaseUpdateExit') : t('exit.keepsMovingItself')}
            </p>
          </AlertCard>
        </div>
      );
    }
    if (figures?.leftOutReason === 'fees') return notWorthIt;
    return (
      <div className="space-y-6">
        <AlertCard variant="warning" title={t('exit.nothingHereToExit')}>
          <p className="text-sm">{t('exit.nothingHereToExitBody')}</p>
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
          { label: t('labels.balance'), value: figures.balanceSat },
          ...(figures.recoverableSat > 0 ? [{ label: t('exit.recoverableFunds'), value: figures.recoverableSat }] : []),
        ]}
        feeLabel={figures.isCooperative ? t('labels.networkFee') : t('exit.sweepFee')}
        exitFeeDueSat={exitFeeDueSat}
      />

      {/* Under way, the build spends what the fee address holds first, so this may cost nothing. */}
      {figures.needsFunding && !underWay && !feeHeld && (
        <SimpleAlert variant="warning" hideIcon>
          {t('exit.payExitFeeNotice')}
        </SimpleAlert>
      )}

      {/* The SDK skips leaves for many reasons, few the user can act on, so
          Glow names a reason only when every one is that the fee eats it. */}
      {figures.leftOutSat > 0 &&
        (figures.leftOutForFees ? (
          <LeftOutCard title={t('exit.balanceStaysBehind')}>
            <Trans
              i18nKey="common:exit.staysBehindForFees"
              components={{ amount: <SatAmount sats={figures.leftOutSat} /> }}
            />
          </LeftOutCard>
        ) : (
          <LeftOutCard title={t('exit.fundsStayBehind')}>
            <Trans
              i18nKey="common:exit.staysBehindPlain"
              components={{ amount: <SatAmount sats={figures.leftOutSat} /> }}
            />
          </LeftOutCard>
        ))}

    </div>
  );
};
