import React from 'react';
import { CopyableRow } from '@/components/ui';
import { AlertCard } from '@/components/AlertCard';
import { FeeBreakdownCard, type FeeBreakdownItem } from '@/components/FeeBreakdownCard';
import { SatAmount } from '@/components/SatAmount';
import { truncateAddress } from '@/utils/crossChainFormat';
import type { QuoteFigures } from '../quote';

// The pieces the Unilateral Exit and Recover Funds reviews share. Each review
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
