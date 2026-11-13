import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BottomSheetCard,
  BottomSheetContainer,
  CodeValue,
  CollapsibleCodeField,
  CollapsibleSection,
  DialogHeader,
  PaymentInfoCard,
  PaymentInfoRow,
} from '@/components/ui';
import { SatAmount } from '@/components/SatAmount';
import { explorerTxUrl } from '@/utils/explorer';
import type { ArchivedExit } from './storage/archive';

/**
 * A finished exit's details, laid out the way PaymentDetailsDialog shows a
 * withdrawal: it lists as a BTC Transfer, so it opens like one. It adds what
 * only an exit has, since the exit fee was paid from another wallet and this
 * is the one place it is recorded. The figures read as a sum, down to what
 * was received.
 */
export const ArchivedExitDialog: React.FC<{
  exit: ArchivedExit;
  onClose: () => void;
  subtitle?: string;
  exitedLabel?: string;
}> = ({ exit, onClose, subtitle, exitedLabel }) => {
  const { t } = useTranslation('common');
  const [shown, setShown] = useState({ destination: false, exitFeeAddress: false, txids: false });
  const toggle = (field: keyof typeof shown) => setShown(current => ({ ...current, [field]: !current[field] }));

  const { exitFeeAddress } = exit;
  const txids = exit.txids ?? [exit.id];

  return (
    <BottomSheetContainer isOpen onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader title={t('exit.btcTransfer')} onClose={onClose} />
        <p className="-mt-3 mb-4 text-center text-sm text-spark-text-muted">
          {subtitle ?? t('exit.unilateralExit')}
        </p>
        <div className="space-y-4 overflow-y-auto" data-testid="unilateral-exit-details">
          <PaymentInfoCard>
            {exit.exitedSat !== undefined && (
              <PaymentInfoRow
                label={exitedLabel ?? t('exit.balanceExited')}
                value={<SatAmount sats={Math.max(0, exit.exitedSat - (exit.recoverableFundsSat ?? 0))} />}
              />
            )}
            {!!exit.recoverableFundsSat && (
              <PaymentInfoRow label={t('exit.recoverableFunds')} value={<SatAmount sats={exit.recoverableFundsSat} />} />
            )}
            {exit.exitFeePaidSat !== undefined && (
              <PaymentInfoRow label={t('exit.exitFeePaid')} value={<SatAmount sats={exit.exitFeePaidSat} />} />
            )}
            {!!exit.networkFeeSat && (
              <PaymentInfoRow
                label={t('exit.networkFees')}
                value={
                  <span className="inline-flex items-center">
                    -<SatAmount sats={exit.networkFeeSat} />
                  </span>
                }
              />
            )}
            {!!exit.unspentExitFeeSat && (
              <PaymentInfoRow
                label={t('exit.unspentExitFee')}
                value={
                  <span className="inline-flex items-center">
                    -<SatAmount sats={exit.unspentExitFeeSat} />
                  </span>
                }
              />
            )}
            <PaymentInfoRow label={t('exit.receivedLabel')} value={<SatAmount sats={exit.deliveredSat} />} />
            <PaymentInfoRow
              label={t('paymentDetails.dateTime')}
              value={new Date(exit.completedAt).toLocaleString(undefined, {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            />
          </PaymentInfoCard>

          <CollapsibleCodeField
            label={t('paymentDetails.recipientAddress')}
            value={exit.destination}
            isVisible={shown.destination}
            onToggle={() => toggle('destination')}
          />
          {exitFeeAddress && (
            <CollapsibleCodeField
              label={t('exit.exitFeeAddressLabel')}
              value={exitFeeAddress}
              isVisible={shown.exitFeeAddress}
              onToggle={() => toggle('exitFeeAddress')}
            />
          )}
          {/* Every transaction in a block that paid the destination, under one
              field, as the list shows them as one transfer. */}
          {txids.length === 1 && (
            <CollapsibleCodeField
              label={t('labels.transactionId')}
              value={txids[0]}
              isVisible={shown.txids}
              onToggle={() => toggle('txids')}
              href={explorerTxUrl(txids[0])}
            />
          )}
          {txids.length > 1 && (
            <CollapsibleSection label={t('exit.transactionIds')} isVisible={shown.txids} onToggle={() => toggle('txids')}>
              <div className="divide-y divide-spark-border/50">
                {txids.map(txid => (
                  <div key={txid} className="py-3 first:pt-0 last:pb-0">
                    <CodeValue label={t('labels.transactionId')} value={txid} href={explorerTxUrl(txid)} />
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};
