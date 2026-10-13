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

const show = async (exit: ArchivedExit) => {
  render(<ArchivedExitDialog exit={exit} onClose={vi.fn()} />);
  await waitForSheetOpen();
  return within(screen.getByTestId('unilateral-exit-details'));
};

describe('ArchivedExitDialog', () => {
  it('lists each transaction that paid the destination, each linking its own', async () => {
    const details = await show(record({ txids: ['coop', 'sweep-old'] }));
    const fields = details.getAllByRole('button', { name: 'Transaction ID' });
    expect(fields).toHaveLength(2);

    fields.forEach(field => fireEvent.click(field));
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
