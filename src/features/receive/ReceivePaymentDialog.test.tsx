import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import ReceivePaymentDialog from './ReceivePaymentDialog';

const openDialog = async () => {
  const client = createMockClient() as unknown as BreezSdk;
  render(
    <ToastProvider>
      <WalletProvider client={client} isConnected>
        <FiatDataProvider>
          <StableBalanceProvider>
            <ReceivePaymentDialog isOpen onClose={vi.fn()} />
          </StableBalanceProvider>
        </FiatDataProvider>
      </WalletProvider>
    </ToastProvider>,
  );
  await waitForSheetOpen();
};

describe('a created invoice', () => {
  it('states what it asks for, in place of the old title', async () => {
    await openDialog();

    fireEvent.click(await screen.findByTestId('show-amount-panel-button'));
    fireEvent.change(await screen.findByTestId('invoice-amount-input'), { target: { value: '5000' } });
    fireEvent.click(screen.getByTestId('generate-invoice-button'));

    await screen.findByTestId('lightning-invoice-text');
    expect(screen.getByText('Scan to pay')).toBeInTheDocument();
    expect(screen.getByText('5 000')).toBeInTheDocument();
    expect(screen.queryByText('Scan to pay this Lightning invoice')).toBeNull();
  });
});
