import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { BreezSdk, DepositInfo } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { rejectDeposit } from '@/services/depositState';
import GetRefundPage from './GetRefundPage';

const DEPOSIT: DepositInfo = {
  txid: 'a'.repeat(64),
  vout: 0,
  amountSats: 50_000,
  isMature: true,
};

async function renderPage() {
  rejectDeposit(DEPOSIT.txid, DEPOSIT.vout);
  const client = createMockClient() as unknown as BreezSdk;
  client.listUnclaimedDeposits = vi
    .fn()
    .mockResolvedValue({ deposits: [DEPOSIT] });

  render(
    <WalletProvider client={client} isConnected>
      <GetRefundPage onBack={vi.fn()} />
    </WalletProvider>,
  );

  // Card Continue opens the refund sheet on the address step.
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  const destination = await screen.findByPlaceholderText('bc1q...');
  return { destination };
}

// react-modal-sheet keeps its root visibility:hidden until the open
// animation runs, which it never does here. That empties every
// accessible name inside the sheet, so role queries cannot reach these
// buttons: match on text and scope to the step's action row.
function sheetButton(label: string) {
  const actions = screen.getByText('Cancel').parentElement as HTMLElement;
  return within(actions).getByText(label);
}

// The sheet's Continue must never be pressable in a state its handler
// rejects: the press is swallowed with no feedback.
describe('GetRefundPage address step', () => {
  beforeEach(() => localStorage.clear());

  it('advances to fee selection once a destination is entered', async () => {
    const { destination } = await renderPage();
    fireEvent.change(destination, { target: { value: 'bc1qdest' } });

    const continueButton = sheetButton('Continue');
    expect(continueButton).toBeEnabled();

    fireEvent.click(continueButton);
    expect(await screen.findByText('Select Fee Rate')).toBeInTheDocument();
  });

  it('disables Continue after Cancel clears the selected deposit', async () => {
    const { destination } = await renderPage();
    fireEvent.change(destination, { target: { value: 'bc1qdest' } });

    // Cancel nulls selectedDeposit, but the sheet body stays mounted
    // through the close animation and keeps the typed destination.
    fireEvent.click(sheetButton('Cancel'));

    expect(sheetButton('Continue')).toBeDisabled();
  });
});
