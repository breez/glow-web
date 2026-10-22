import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { explorerTxUrl } from '@/utils/explorer';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import type { ArchivedExit } from './storage/archive';
import { ArchivedExitDialog } from './ArchivedExitDialog';

const openExternalUrl = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/utils/externalLink', () => ({ openExternalUrl }));

const record = (over: Partial<ArchivedExit> = {}): ArchivedExit => ({
  id: 'sweep-last',
  destination: 'bc1qdest',
  deliveredSat: 625_624,
  completedAt: Date.UTC(2026, 9, 1),
  exitedSat: 630_000,
  ...over,
});

const show = async (exit: ArchivedExit, exitedLabel?: string) => {
  render(<ArchivedExitDialog exit={exit} onClose={vi.fn()} exitedLabel={exitedLabel} />);
  await waitForSheetOpen();
  return within(screen.getByTestId('unilateral-exit-details'));
};

/** Each figure row's label and amount, in the order shown. */
const figures = (details: Awaited<ReturnType<typeof show>>) =>
  details
    .getAllByText(/^(Balance Exited|Funds Recovered|Recoverable Funds|Exit Fee Paid|Network Fees|Unspent Exit Fee|Received)$/)
    .map(label => label.closest('.justify-between')?.textContent);

describe('ArchivedExitDialog', () => {
  it('reads as a sum, down to what was received', async () => {
    const details = await show(record({ exitedSat: 600_000, exitFeePaidSat: 3_122, networkFeeSat: 2_240, deliveredSat: 600_882 }));
    expect(figures(details)).toEqual([
      'Balance Exited₿600 000',
      'Exit Fee Paid₿3 122',
      'Network Fees-₿2 240',
      'Received₿600 882',
    ]);
  });

  it('shows the exit fee the exit left at its address', async () => {
    const details = await show(record({ exitFeePaidSat: 3_122, networkFeeSat: 2_240, unspentExitFeeSat: 1_500 }));
    expect(figures(details).slice(-2)).toEqual(['Unspent Exit Fee-₿1 500', 'Received₿625 624']);
  });

  it('shows no unspent exit fee when the exit left none', async () => {
    const details = await show(record({ exitFeePaidSat: 3_122, unspentExitFeeSat: 0 }));
    expect(details.queryByText('Unspent Exit Fee')).toBeNull();
  });

  it('shows no network fees on a record from before they were kept', async () => {
    const details = await show(record({ exitFeePaidSat: 3_122 }));
    expect(details.queryByText('Network Fees')).toBeNull();
  });

  it("reads a co-signed recovery's details as a sum too", async () => {
    const recovery = record({ mode: 'recover', exitedSat: 200_000, networkFeeSat: 1_054, deliveredSat: 198_946 });
    const details = await show(recovery, 'Funds Recovered');
    expect(figures(details)).toEqual(['Funds Recovered₿200 000', 'Network Fees-₿1 054', 'Received₿198 946']);
  });

  it('shows no network fees when none came off', async () => {
    const details = await show(record({ mode: 'recover', exitedSat: 30_000, networkFeeSat: 0, deliveredSat: 30_000 }));
    expect(details.queryByText('Network Fees')).toBeNull();
  });

  it('lists every transaction that paid the destination under one field, each linking its own', async () => {
    const details = await show(record({ txids: ['coop', 'sweep-old'] }));
    expect(details.queryByRole('button', { name: 'Transaction ID' })).toBeNull();

    fireEvent.click(details.getByRole('button', { name: 'Transaction IDs' }));
    expect(details.getByText('coop')).toBeInTheDocument();
    details.getAllByRole('button', { name: 'Open Transaction ID' }).forEach(link => fireEvent.click(link));
    expect(openExternalUrl.mock.calls).toEqual([[explorerTxUrl('coop')], [explorerTxUrl('sweep-old')]]);
    expect(details.queryByText('sweep-last')).toBeNull();
  });

  it('shows the id of a record from before transactions were listed', async () => {
    const details = await show(record());
    fireEvent.click(details.getByRole('button', { name: 'Transaction ID' }));
    expect(details.getByText('sweep-last')).toBeInTheDocument();
  });

  it('never shows a negative balance exited on a record whose recoverable funds exceed it', async () => {
    const details = await show(record({ exitedSat: 30_000, recoverableFundsSat: 48_200 }));
    const row = details.getByText('Balance Exited').closest('.justify-between');
    expect(row).toHaveTextContent(/^Balance Exited₿0$/);
  });
});
