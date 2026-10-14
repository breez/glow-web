import React, { useState } from 'react';
import { CollapsibleCodeField, CopyableRow } from '@/components/ui';
import { AlertCard } from '@/components/AlertCard';
import { FeeBreakdownCard, type FeeBreakdownItem } from '@/components/FeeBreakdownCard';
import { SatAmount } from '@/components/SatAmount';
import { truncateAddress } from '@/utils/crossChainFormat';
import type { QuoteFigures } from '../quote';

// The pieces the Unilateral Exit and Recover Funds screens share. Each flow
// keeps its own wording; the figures come from the quote module.

export const ReceiveHero: React.FC<{ figures: QuoteFigures }> = ({ figures }) => (
  <div className="text-center py-2">
    <p className="text-spark-text-muted text-sm mb-2">You&apos;ll receive</p>
    <SatAmount
      sats={figures.willReceiveSat}
      className="text-4xl font-bold text-spark-text-primary"
    />
  </div>
);

export const DestinationRow: React.FC<{ address: string; testId?: string }> = ({ address, testId }) => (
  <CopyableRow label="To address" value={address} display={truncateAddress(address, 32)} data-testid={testId} />
);

/** What the quote moves, then what it costs: the fee off it, and the exit fee where it needs funding. */
export const ReviewBreakdown: React.FC<{ figures: QuoteFigures; amounts: FeeBreakdownItem[]; feeLabel: string }> = ({
  figures,
  amounts,
  feeLabel,
}) => (
  <FeeBreakdownCard
    items={[
      ...amounts,
      { label: feeLabel, value: figures.networkFeeSat },
      ...(figures.needsFunding ? [{ label: 'Exit fee', value: figures.exitFeeSat, highlight: true }] : []),
    ]}
  />
);

export const LeftOutCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <AlertCard variant="warning" title={title}>
    <p className="text-sm">{children}</p>
  </AlertCard>
);

/** The node's or the SDK's own words, folded away: support needs them, the user rarely does. */
export const ErrorDetails: React.FC<{ text: string; testId: string }> = ({ text, testId }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2" data-testid={testId}>
      <CollapsibleCodeField label="Details" value={text} isVisible={open} onToggle={() => setOpen(v => !v)} />
    </div>
  );
};

/** A failure to try again: the title says what failed, and the raw text stays folded under Details. */
export const ErrorCard: React.FC<{ title: string; error: string; testId: string }> = ({ title, error, testId }) => (
  <AlertCard variant="error" title={title}>
    <p className="text-sm">Please try again.</p>
    <ErrorDetails text={error} testId={testId} />
  </AlertCard>
);
