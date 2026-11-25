import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { AlertCard } from '@/components/AlertCard';
import { FeeBreakdownCard } from '@/components/FeeBreakdownCard';
import { CollapsibleSection, CopyableText, LoadingSpinner, PrimaryButton, QRCodeContainer } from '@/components/ui';
import { SatAmount } from '@/components/SatAmount';
import { CheckIcon, ClockIcon, CloseIcon } from '@/components/Icons';
import { useToast } from '@/contexts/ToastContext';
import type { ChainUtxo } from '@/services/chain';
import { isPendingFunded, pendingTopUp, type TopUp } from '../exitFee';
import type { ExitMode, PendingExit } from '../model/plan';
import type { UnilateralExitEngineState } from '../engine/state';
import { BackupActions, ExitActionRow } from '../BackupCard';
import { ErrorCard } from './ReviewParts';
import type { FundingFields } from '../hooks/useUnilateralExitFlow';

const QUOTE_AGE_TICK_MS = 30_000;

const quoteAge = (quotedAt: number): string => {
  const minutes = Math.floor((Date.now() - quotedAt) / 60_000);
  if (minutes < 1) return i18n.t('common:exit.quotedJustNow');
  return minutes < 60
    ? i18n.t('common:exit.quotedMinutesAgo', { count: minutes })
    : i18n.t('common:exit.quotedHoursAgo', { count: Math.floor(minutes / 60) });
};

/** A top-up still waiting for coins. The page keeps it by the action, where it stays on screen as it changes. */
export const FundingStatus: React.FC<Pick<FundingFields, 'quotedAt'>> = ({ quotedAt }) => {
  const { t } = useTranslation('common');
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
        {t('exit.watchingAddress')}
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
  const { t } = useTranslation('common');
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
        label={t('exit.exitFeeAddress')}
        onCopied={() => showToast('success', t('actions.copied'))}
        onShareError={() => showToast('error', t('labels.shareFailed'))}
        data-testid="unilateral-exit-funding-address"
      />
    </div>
  );
};

// The send flow's result shape: an instruction to pay reads as wrong once it
// is paid, so the step becomes the receipt instead. What it waits on sits
// under the title, as a result's detail line does.
export const Receipt: React.FC<{ title?: string; children?: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="pt-6 flex flex-col items-center">
    <div className="relative mb-4">
      <div className="absolute inset-0 w-20 h-20 rounded-full blur-xl bg-spark-success/30" />
      <div className="relative w-20 h-20 rounded-full flex items-center justify-center bg-spark-success/20 border-2 border-spark-success">
        <CheckIcon className="w-10 h-10 text-spark-success" />
      </div>
    </div>
    <h3 className="font-display text-xl font-bold text-spark-text-primary">
      {title ?? i18n.t('common:exit.exitFeeReceived')}
    </h3>
    {children && <div className="mt-2 space-y-2">{children}</div>}
  </div>
);

const Breakdown: React.FC<{ topUp: TopUp; feeRate: number }> = ({ topUp, feeRate }) => {
  const { t } = useTranslation('common');
  return (
  <FeeBreakdownCard
    items={[
      { label: t('exit.exitFeeAtRate', { rate: feeRate }), value: topUp.neededSat },
      { label: t('exit.alreadySent'), value: topUp.sentSat, subtract: true },
      { label: t('exit.stillToSend'), value: topUp.stillToSendSat, highlight: true },
    ]}
  />
  );
};

export const Status: React.FC<{ children: React.ReactNode }> = ({ children }) => (
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
    mode?: ExitMode;
  }
> = ({ address, topUp, waitsForConfirmation, feeRate, currentFeeRate, networkFloorFeeRate, error, isPaying, onTopUp, mode = 'exit' }) => {
  const { t } = useTranslation('common');
  // The build is tried before anything is asked for, so without a top-up there
  // is nothing to pay here: only a failure to explain.
  if (!topUp) {
    return error ? (
      <ErrorCard title={t(`exit.couldNotContinue_${mode}`)} error={error} testId="unilateral-exit-build-error" />
    ) : (
      <p className="text-sm text-spark-text-secondary text-center">
        {t(`exit.continueAtRate_${mode}`, { rate: feeRate })}
      </p>
    );
  }

  // Says why Continue Exit is not yet open, as the pending exit's receipt does.
  if (topUp.stillToSendSat === 0) {
    return waitsForConfirmation ? (
      <Receipt title={t('exit.exitFeeSent')}>
        <Status>{t('exit.waitingConfirmation')}</Status>
      </Receipt>
    ) : (
      <Receipt />
    );
  }

  // Waiting costs nothing, so the step shows what continuing now costs before
  // it shows anywhere to pay.
  if (!isPaying) {
    // Fees rose only if the network is now above the rate the exit was built
    // at. A higher rate the user picked themselves is not the network's doing.
    const feesRose =
      currentFeeRate !== null && networkFloorFeeRate !== null && networkFloorFeeRate > currentFeeRate;
    return (
      <div className="space-y-4">
        <Breakdown topUp={topUp} feeRate={feeRate} />
        <AlertCard variant="warning" title={feesRose ? t('exit.feesWentUp') : t(`exit.needsMore_${mode}`)}>
          <p className="text-sm">
            {feesRose
              ? t(`exit.feesRoseBody_${mode}`, { started: currentFeeRate, rate: feeRate })
              : t(`exit.needsMoreBody_${mode}`, { rate: feeRate })}
          </p>
          <div className="mt-3">
            <PrimaryButton onClick={onTopUp} className="w-full" data-testid="unilateral-exit-top-up">
              {t('exit.topUpToContinue')}
            </PrimaryButton>
          </div>
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Ask label={t(`exit.sendToContinue_${mode}`)} sat={topUp.stillToSendSat} />
      <PaymentTarget address={address} amountSat={topUp.stillToSendSat} />
    </div>
  );
};

/** A fresh exit waiting on its fee. It is saved, so the sheet can close at any point here, and Exit Spark starts it once the fee confirms. */
export const PendingExitStep: React.FC<{
  pending: PendingExit;
  coins: ChainUtxo[];
  nothingToExit: UnilateralExitEngineState['nothingToExit'];
  isStarting: boolean;
  startError: string | null;
  onCancel: () => void;
  mode?: ExitMode;
}> = ({ pending, coins, nothingToExit, isStarting, startError, onCancel, mode = 'exit' }) => {
  const { t } = useTranslation('common');
  const [advanced, setAdvanced] = useState(false);
  const topUp = pendingTopUp(pending, coins);

  if (isStarting) {
    return (
      <div className="py-16 flex justify-center">
        <LoadingSpinner text={t(`exit.buildingAndSigning_${mode}`)} />
      </div>
    );
  }

  const reason = nothingToExit?.reason;
  const body = (() => {
    if (reason === 'fees') {
      return (
        <AlertCard
          variant="warning"
          title={t(`exit.nothingWorth_${mode}`)}
        >
          <p className="text-sm">
            {t(`exit.nothingWorthBody_${mode}`, { rate: pending.feeRateSatPerVbyte })}
          </p>
        </AlertCard>
      );
    }
    // The fresh quote's words for the same verdict.
    if (nothingToExit && reason !== 'unavailable') {
      return mode === 'exit' ? (
        <AlertCard variant="warning" title={t('exit.nothingHereToExit')}>
          <p className="text-sm">{t('exit.nothingHereToExitBody')}</p>
        </AlertCard>
      ) : (
        <AlertCard variant="info" title={t('exit.nothingLeftToRecover')}>
          <p className="text-sm">{reason === null ? t('exit.alreadyRecovered') : t('exit.cannotBeRecovered')}</p>
        </AlertCard>
      );
    }
    if (topUp.stillToSendSat > 0) {
      return (
        <>
          <Ask label={t('exit.sendFromElsewhere')} sat={topUp.stillToSendSat} />
          <PaymentTarget address={pending.fundingAddress} amountSat={topUp.stillToSendSat} />
          <Status>
            {topUp.sentSat > 0 ? (
              <Trans i18nKey="common:exit.amountReceived" components={{ amount: <SatAmount sats={topUp.sentSat} /> }} />
            ) : (
              t('exit.waitingForPayment')
            )}
          </Status>
        </>
      );
    }
    if (!isPendingFunded(pending, coins)) {
      return (
        <Receipt title={t('exit.exitFeeSent')}>
          <Status>{t('exit.waitingConfirmation')}</Status>
          {/* Paid is where the wait is, so it is where closing needs saying. */}
          <p className="text-spark-text-muted text-xs text-center text-balance">
            {t(`exit.closeComeBack_${mode}`)}
          </p>
        </Receipt>
      );
    }
    return (
      <>
        <Receipt />
        {reason === 'unavailable' ? (
          <AlertCard variant="warning" title={t(`exit.unavailable_${mode}`)}>
            <p className="text-sm">{t('exit.tryAgainLater')}</p>
          </AlertCard>
        ) : (
          startError && <ErrorCard title={t(`exit.couldNotStart_${mode}`)} error={startError} testId="unilateral-exit-start-error" />
        )}
      </>
    );
  })();

  return (
    <div className="space-y-4">
      {body}
      {/* Out of the way, as on the intro and the tracker. Nothing is lost by
          cancelling: coins already sent count toward the next exit. */}
      <CollapsibleSection label={t('exit.advanced')} isVisible={advanced} onToggle={() => setAdvanced(v => !v)} bare>
        <BackupActions mode={mode}>
          <ExitActionRow label={t(`exit.cancel_${mode}`)} icon={<CloseIcon size="md" />} onClick={onCancel} testId="unilateral-exit-cancel" />
        </BackupActions>
      </CollapsibleSection>
    </div>
  );
};
