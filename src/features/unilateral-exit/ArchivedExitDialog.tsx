import React, { useEffect, useState } from 'react';
import {
  BottomSheetCard,
  BottomSheetContainer,
  CollapsibleCodeField,
  DialogHeader,
  PaymentInfoCard,
  PaymentInfoRow,
} from '@/components/ui';
import { SatAmount } from '@/components/SatAmount';
import { createChainClient, type ChainClient } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { explorerTxUrl } from '@/utils/explorer';
import type { ArchivedExit } from './archive';

/**
 * A finished exit's details, laid out the way PaymentDetailsDialog shows a
 * withdrawal: it lists as a BTC Transfer, so it opens like one. It adds what
 * only an exit has, since the exit fee was paid from another wallet and this
 * is the one place it is recorded.
 */
export const ArchivedExitDialog: React.FC<{
  exit: ArchivedExit;
  onClose: () => void;
  subtitle?: string;
  exitedLabel?: string;
  /** Reads the unspent exit fee. Absent means the backend for the exit's network. */
  chain?: ChainClient;
}> = ({ exit, onClose, subtitle = 'Unilateral Exit', exitedLabel = 'Balance Exited', chain }) => {
  const [shown, setShown] = useState({ destination: false, exitFeeAddress: false });
  const toggle = (field: keyof typeof shown) => setShown(current => ({ ...current, [field]: !current[field] }));
  const [openTxids, setOpenTxids] = useState<ReadonlySet<string>>(new Set());
  const toggleTxid = (txid: string) =>
    setOpenTxids(current => {
      const next = new Set(current);
      if (!next.delete(txid)) next.add(txid);
      return next;
    });

  // Read live rather than kept: the leftover is the user's to move, and a figure
  // saved when the exit landed would still show it after they had.
  const [unspentSat, setUnspentSat] = useState<number | null>(null);
  const { exitFeeAddress, network } = exit;
  useEffect(() => {
    if (!exitFeeAddress || !network) return;
    let cancelled = false;
    (chain ?? createChainClient(network))
      .addressUtxos(exitFeeAddress)
      .then(utxos => {
        if (!cancelled) setUnspentSat(utxos.reduce((sum, utxo) => sum + utxo.value, 0));
      })
      .catch(e =>
        logger.warn(LogCategory.SDK, 'Could not read the exit fee address', {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    return () => {
      cancelled = true;
    };
  }, [exitFeeAddress, network, chain]);

  return (
    <BottomSheetContainer isOpen onClose={onClose}>
      <BottomSheetCard>
        <DialogHeader title="BTC Transfer" onClose={onClose} />
        <p className="-mt-3 mb-4 text-center text-sm text-spark-text-muted">{subtitle}</p>
        <div className="space-y-4 overflow-y-auto" data-testid="unilateral-exit-details">
          <PaymentInfoCard>
            <PaymentInfoRow label="Received" value={<SatAmount sats={exit.deliveredSat} />} />
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
            {unspentSat !== null && unspentSat > 0 && (
              <PaymentInfoRow label="Unspent Exit Fee" value={<SatAmount sats={unspentSat} />} />
            )}
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
