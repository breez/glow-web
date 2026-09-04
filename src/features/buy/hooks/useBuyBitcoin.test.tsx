import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { useBuyBitcoin } from './useBuyBitcoin';
import BuyBitcoinDialog from '../BuyBitcoinDialog';

const CASH_APP_URL = 'https://cash.app/launch/lightning/lnbc100n1test';

function renderBuy() {
  const client = createMockClient({
    buyBitcoin: vi.fn().mockResolvedValue({ url: CASH_APP_URL }),
  } as never);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <WalletProvider client={client} isConnected>
      <FiatDataProvider>
        <StableBalanceProvider>{children}</StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
  return { client, ...renderHook(() => useBuyBitcoin({
    isOpen: true,
    onSelectRedirectProvider: vi.fn(),
    onMobileRedirectComplete: vi.fn(),
    onInvoicePaid: vi.fn(),
  }), { wrapper }) };
}

describe('Cash App on mobile web', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands the URL to the link step instead of navigating for the user', async () => {
    // Scripted navigation loses the tap: iOS only resolves a universal link
    // from a real click, and Chrome will not hand an App Link to an app
    // without user activation, which awaiting the invoice has already spent.
    const open = vi.spyOn(window, 'open');
    const { result } = renderBuy();

    act(() => result.current.setAmount('50000'));
    await act(() => result.current.generate());

    await waitFor(() => expect(result.current.step).toBe('link'));
    expect(result.current.cashAppUrl).toBe(CASH_APP_URL);
    expect(open).not.toHaveBeenCalled();
  });

  it('stays on the amount step when the invoice fails', async () => {
    const { client, result } = renderBuy();
    vi.mocked(client.buyBitcoin).mockRejectedValueOnce(new Error('nope'));

    act(() => result.current.setAmount('50000'));
    await act(() => result.current.generate());

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.cashAppUrl).toBeNull();
  });
});

describe('the Cash App link', () => {
  it('reaches the person as an anchor they tap, not a scripted navigation', async () => {
    const client = createMockClient({
      buyBitcoin: vi.fn().mockResolvedValue({ url: CASH_APP_URL }),
    } as never);
    render(
      <ToastProvider>
        <WalletProvider client={client} isConnected>
          <FiatDataProvider>
            <StableBalanceProvider>
              <BuyBitcoinDialog
                isOpen
                onClose={vi.fn()}
                onBuyBitcoin={vi.fn()}
                network="mainnet"
              />
            </StableBalanceProvider>
          </FiatDataProvider>
        </WalletProvider>
      </ToastProvider>,
    );

    await userEvent.click(await screen.findByText('Cash App'));
    await userEvent.type(screen.getByTestId('cashapp-amount-input'), '50000');
    await userEvent.click(screen.getByTestId('cashapp-continue-button'));

    // Both openers, the worded link and the code itself.
    for (const id of ['cashapp-open-link', 'cashapp-open-qr']) {
      const link = await screen.findByTestId(id);
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', CASH_APP_URL);
      // Without `_blank` an installed PWA navigates its own window away, and
      // standalone mode leaves no way back to Glow.
      expect(link).toHaveAttribute('target', '_blank');
    }
  });
});
