import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk, LightningAddressInfo } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import ReceivePaymentDialog from './ReceivePaymentDialog';

const address = (username: string): LightningAddressInfo => ({
  description: `Pay to ${username}@breez.tips`,
  lightningAddress: `${username}@breez.tips`,
  lnurl: { url: `https://breez.tips/lnurlp/${username}`, bech32: 'lnurl1dp68gurn8ghj7' },
  username,
});

describe('Lightning address edit sheet', () => {
  it('changes the username from its own sheet, after confirming', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    client.getLightningAddress = vi.fn().mockResolvedValue(address('alice'));

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

    fireEvent.click(await screen.findByTitle('Edit Lightning Address'));
    // Let the edit sheet finish opening too, for the reason in waitForSheetOpen.
    const title = await screen.findByText('Edit Address');
    await waitFor(() => expect(title.closest('.react-modal-sheet-root')).toBeVisible());

    fireEvent.change(screen.getByPlaceholderText('satoshi'), { target: { value: 'bob' } });
    fireEvent.click(screen.getByTestId('save-address-button'));
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));

    await waitFor(() =>
      expect(client.registerLightningAddress).toHaveBeenCalledWith(expect.objectContaining({ username: 'bob' })),
    );
    await waitFor(() => expect(screen.queryByText('Edit Address')).toBeNull());
  });
});
