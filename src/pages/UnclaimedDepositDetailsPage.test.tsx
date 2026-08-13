import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk, DepositInfo } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import UnclaimedDepositDetailsPage from './UnclaimedDepositDetailsPage';

function depositWithFee(requiredFeeSats: number): DepositInfo {
  return {
    txid: 'e'.repeat(64),
    vout: 0,
    amountSats: 5555,
    isMature: true,
    claimError: {
      type: 'maxDepositClaimFeeExceeded',
      tx: 'e'.repeat(64),
      vout: 0,
      requiredFeeSats,
      requiredFeeRateSatPerVbyte: requiredFeeSats / 99,
    },
  };
}

// The operator re-quotes on every attempt, so a claim can be rejected for a
// fee the sheet was showing a second earlier. Re-sending that fee fails the
// same way forever, which is what QA hit in #369.
it('retries at the fee the failed claim quoted, not the one it rejected', async () => {
  const client = createMockClient() as unknown as BreezSdk;
  client.claimDeposit = vi.fn().mockRejectedValueOnce(new Error('Max deposit claim fee exceeded'));
  client.listUnclaimedDeposits = vi.fn().mockResolvedValue({ deposits: [depositWithFee(297)] });

  render(
    <WalletProvider client={client} isConnected>
      <UnclaimedDepositDetailsPage deposit={depositWithFee(198)} onBack={vi.fn()} />
    </WalletProvider>,
  );

  fireEvent.click(screen.getByText('Approve'));
  await waitFor(() => expect(screen.getByText('Network fee changed')).toBeInTheDocument());
  expect(client.claimDeposit).toHaveBeenLastCalledWith(
    expect.objectContaining({ maxFee: { type: 'fixed', amount: 198 } }),
  );

  fireEvent.click(screen.getByText('Approve'));
  await waitFor(() =>
    expect(client.claimDeposit).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxFee: { type: 'fixed', amount: 297 } }),
    ),
  );
});

describe('when the failure is not a fee change', () => {
  it('falls back to the error and offers only a refund', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    client.claimDeposit = vi.fn().mockRejectedValue(new Error('Network error: timed out'));
    client.listUnclaimedDeposits = vi.fn().mockResolvedValue({ deposits: [depositWithFee(198)] });

    render(
      <WalletProvider client={client} isConnected>
        <UnclaimedDepositDetailsPage deposit={depositWithFee(198)} onBack={vi.fn()} />
      </WalletProvider>,
    );

    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => expect(screen.getByText('Network error: timed out')).toBeInTheDocument());
    expect(screen.queryByText('Approve')).toBeNull();
  });
});
