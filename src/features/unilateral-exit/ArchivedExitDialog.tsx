import React, { useState } from 'react';
import {
  BottomSheetCard,
  BottomSheetContainer,
  CollapsibleCodeField,
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
}> = ({ exit, onClose, subtitle = 'Unilateral Exit', exitedLabel = 'Balance Exited' }) => {
  const [shown, setShown] = useState({ destination: false, exitFeeAddress: false });
  const toggle = (field: keyof typeof shown) => setShown(current => ({ ...current, [field]: !current[field] }));
  const [openTxids, setOpenTxids] = useState<ReadonlySet<string>>(new Set());
  const toggleTxid = (txid: string) =>
    setOpenTxids(current => {
      const next = new Set(current);
      if (!next.delete(txid)) next.add(txid);
      return next;
    });

  const { exitFeeAddress } = exit;

  return (
    <BottomSheetContainer isOpen onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader title="BTC Transfer" onClose={onClose} />
        <p className="-mt-3 mb-4 text-center text-sm text-spark-text-muted">{subtitle}</p>
        <div className="space-y-4 overflow-y-auto" data-testid="unilateral-exit-details">
          <PaymentInfoCard>
            {exit.exitedSat !== undefined && (
              <PaymentInfoRow
                label={exitedLabel}
                value={<SatAmount sats={Math.max(0, exit.exitedSat - (exit.recoverableFundsSat ?? 0))} />}
              />
            )}
            {!!exit.recoverableFundsSat && (
              <PaymentInfoRow label="Recoverable Funds" value={<SatAmount sats={exit.recoverableFundsSat} />} />
            )}
            {exit.exitFeePaidSat !== undefined && (
              <PaymentInfoRow label="Exit Fee Paid" value={<SatAmount sats={exit.exitFeePaidSat} />} />
            )}
            {exit.networkFeeSat !== undefined && (
              <PaymentInfoRow
                label="Network Fees"
                value={
                  <span className="inline-flex items-center">
                    -<SatAmount sats={exit.networkFeeSat} />
                  </span>
                }
              />
            )}
            {!!exit.unspentExitFeeSat && (
              <PaymentInfoRow label="Unspent Exit Fee" value={<SatAmount sats={exit.unspentExitFeeSat} />} />
            )}
            <PaymentInfoRow label="Received" value={<SatAmount sats={exit.deliveredSat} />} />
            <PaymentInfoRow
              label="Date & Time"
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
            label="Recipient Address"
            value={exit.destination}
            isVisible={shown.destination}
            onToggle={() => toggle('destination')}
          />
          {exitFeeAddress && (
            <CollapsibleCodeField
              label="Exit Fee Address"
              value={exitFeeAddress}
              isVisible={shown.exitFeeAddress}
              onToggle={() => toggle('exitFeeAddress')}
            />
          )}
          {/* Each transaction in a block that paid the destination. */}
          {(exit.txids ?? [exit.id]).map(txid => (
            <CollapsibleCodeField
              key={txid}
              label="Transaction ID"
              value={txid}
              isVisible={openTxids.has(txid)}
              onToggle={() => toggleTxid(txid)}
              href={explorerTxUrl(txid)}
            />
          ))}
        </div>
      </BottomSheetCard>
    </BottomSheetContainer>
  );
};
