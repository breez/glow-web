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

describe('receive tabs', () => {
  it('takes the tabs away once an invoice exists, and gives a way back', async () => {
    await openDialog();

    expect(await screen.findByTestId('btc-tab')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('show-amount-panel-button'));
    fireEvent.change(await screen.findByTestId('invoice-amount-input'), { target: { value: '5000' } });
    fireEvent.click(screen.getByTestId('generate-invoice-button'));

    await screen.findByTestId('lightning-invoice-text');
    // The invoice states what it asks for, in place of the old title that
    // only repeated the label on the string below it.
    expect(screen.getByText('Scan to pay')).toBeInTheDocument();
    expect(screen.getByText('5 000')).toBeInTheDocument();
    expect(screen.queryByText('Scan to pay this Lightning invoice')).toBeNull();
    expect(screen.queryByTestId('show-amount-panel-button')).toBeNull();
    expect(screen.queryByTestId('btc-tab')).toBeNull();
    expect(screen.queryByTestId('usd-tab')).toBeNull();

    // `useSheetBack` registers through an effect, so the arrow lands a render late.
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));

    expect(await screen.findByTestId('show-amount-panel-button')).toBeInTheDocument();
    expect(screen.getByTestId('btc-tab')).toBeInTheDocument();
  });
});
