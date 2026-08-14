import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider, WalletInfoProvider, WalletStatusProvider } from '@/contexts/WalletContext';
import { ContactsProvider } from '@/contexts/ContactsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { isSendSheetOpen } from './sendSheetVisibility';
import SendPaymentDialog from './SendPaymentDialog';

function renderDialog(isOpen: boolean) {
  const client = createMockClient() as unknown as BreezSdk;
  client.listContacts = vi.fn().mockResolvedValue([]);

  return render(
    <ToastProvider>
      <WalletProvider client={client} isConnected>
        <WalletInfoProvider walletInfo={{ balanceSats: 500_000 } as never}>
          <WalletStatusProvider hasPendingConversion={false} isOutOfSync={false}>
            <FiatDataProvider>
              <StableBalanceProvider>
                <ContactsProvider>
                  <SendPaymentDialog isOpen={isOpen} onClose={vi.fn()} />
                </ContactsProvider>
              </StableBalanceProvider>
            </FiatDataProvider>
          </WalletStatusProvider>
        </WalletInfoProvider>
      </WalletProvider>
    </ToastProvider>,
  );
}

// The SDK event handler reports a send's outcome itself only when this
// reads false. WalletPage pre-mounts the dialog closed, so a flag scoped
// to mount stays true for the whole session and silences that report.
describe('isSendSheetOpen', () => {
  it('reports closed while the pre-mounted dialog is closed', () => {
    renderDialog(false);
    expect(isSendSheetOpen()).toBe(false);
  });

  it('reports open while the dialog is open', () => {
    renderDialog(true);
    expect(isSendSheetOpen()).toBe(true);
  });

  it('reports closed again once the dialog closes', () => {
    const { rerender } = renderDialog(true);
    expect(isSendSheetOpen()).toBe(true);

    rerender(
      <ToastProvider>
        <WalletProvider client={createMockClient() as unknown as BreezSdk} isConnected>
          <WalletInfoProvider walletInfo={{ balanceSats: 500_000 } as never}>
            <WalletStatusProvider hasPendingConversion={false} isOutOfSync={false}>
              <FiatDataProvider>
                <StableBalanceProvider>
                  <ContactsProvider>
                    <SendPaymentDialog isOpen={false} onClose={vi.fn()} />
                  </ContactsProvider>
                </StableBalanceProvider>
              </FiatDataProvider>
            </WalletStatusProvider>
          </WalletInfoProvider>
        </WalletProvider>
      </ToastProvider>,
    );

    expect(isSendSheetOpen()).toBe(false);
  });

  it('reports closed after the dialog unmounts while open', () => {
    const { unmount } = renderDialog(true);
    unmount();
    expect(isSendSheetOpen()).toBe(false);
  });
});
