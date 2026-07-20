import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GetInfoResponse } from '@breeztech/breez-sdk-spark';
import { WalletProvider, WalletInfoProvider } from '@/contexts/WalletContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import DeleteAccountPage from './DeleteAccountPage';

function renderPage(balanceSats = 0) {
  const onDelete = vi.fn();
  const client = createMockClient({
    getLightningAddress: vi.fn().mockResolvedValue({ lightningAddress: 'maxi@breez.tips' }),
  });
  render(
    <WalletProvider client={client} isConnected>
      <WalletInfoProvider walletInfo={{ balanceSats } as GetInfoResponse}>
        <DeleteAccountPage
          onBack={vi.fn()}
          onDelete={onDelete}
          onOpenSecurity={vi.fn()}
          onOpenBackup={vi.fn()}
        />
      </WalletInfoProvider>
    </WalletProvider>
  );
  return { onDelete, client };
}

describe('DeleteAccountPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the Lightning address and a funds warning when balance is non-zero', async () => {
    renderPage(5000);

    expect(await screen.findByText(/maxi@breez\.tips/)).toBeInTheDocument();
    expect(screen.getByText(/still holds funds/i)).toBeInTheDocument();
  });

  it('fires onDelete only after the confirm dialog is accepted', () => {
    const { onDelete } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows the passkey warning and removal guide in passkey mode', () => {
    localStorage.setItem('passkeyLabel', 'my-label');
    renderPage();

    expect(screen.getByText(/your passkey is not deleted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /how to remove your passkey/i })).toBeInTheDocument();
  });
});
