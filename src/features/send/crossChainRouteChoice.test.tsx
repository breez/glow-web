import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BreezSdk, CrossChainRoutePair } from '@breeztech/breez-sdk-spark';
import { WalletProvider, WalletInfoProvider, WalletStatusProvider } from '@/contexts/WalletContext';
import { ContactsProvider } from '@/contexts/ContactsContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { getLastSendRoute } from '@/services/settings';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import SendPaymentDialog from './SendPaymentDialog';

// One address per test: `settings.ts` caches its reads in memory, so a
// `localStorage.clear()` between tests does not unwrite what one recorded.
const ADDRESSES = {
  picked: '0xEA4C510da2E39183D99832A51e2892820Fc37AB1',
  named: '0xEA4C510da2E39183D99832A51e2892820Fc37AB2',
  bare: '0xEA4C510da2E39183D99832A51e2892820Fc37AB3',
};

const CHAINS: Record<string, string> = { base: '8453', arbitrum: '42161', polygon: '137' };
const CONTRACTS: Record<string, string> = { USDC: '0xaf88USDC', USDT: '0xdAC1USDT' };

const routeOn = (asset: string, chain: string): CrossChainRoutePair => ({
  provider: 'orchestra', chain, asset, decimals: 6, exactOutEligible: false,
  chainId: CHAINS[chain], contractAddress: CONTRACTS[asset],
  acceptedAssets: [{ asset: { type: 'bitcoin' }, limits: { minUsdCents: 80, maxUsdCents: 8_980_000 } }],
  deliveryMethods: ['spark'],
}) as unknown as CrossChainRoutePair;

const openOnAmountStep = async (address: string, parsed?: Record<string, unknown>) => {
  const client = createMockClient() as unknown as BreezSdk;
  client.listContacts = vi.fn().mockResolvedValue([]);
  client.getCrossChainRoutes = vi.fn().mockResolvedValue([
    routeOn('USDC', 'base'), routeOn('USDC', 'arbitrum'),
    routeOn('USDT', 'base'), routeOn('USDT', 'arbitrum'),
  ]);
  client.parse = vi.fn().mockResolvedValue({
    type: 'crossChainAddress', address, addressFamily: 'evm', ...parsed,
  });
  render(
    <ToastProvider>
      <WalletProvider client={client} isConnected>
        <WalletInfoProvider walletInfo={{ balanceSats: 500_000 } as never}>
          <WalletStatusProvider hasPendingConversion={false}>
            <FiatDataProvider>
              <StableBalanceProvider>
                <ContactsProvider>
                  <SendPaymentDialog isOpen onClose={vi.fn()} />
                </ContactsProvider>
              </StableBalanceProvider>
            </FiatDataProvider>
          </WalletStatusProvider>
        </WalletInfoProvider>
      </WalletProvider>
    </ToastProvider>,
  );
  await waitForSheetOpen();
  fireEvent.change(await screen.findByTestId('payment-input'), { target: { value: address } });
  fireEvent.click(screen.getByTestId('continue-button'));
  await screen.findByTestId('amount-input');
};

describe('cross-chain send network choice', () => {
  beforeEach(() => localStorage.clear());

  it('picks the network before the amount and remembers it for the quote', async () => {
    await openOnAmountStep(ADDRESSES.picked);

    // Nothing remembered, so the chip has no network to name yet.
    const chip = await screen.findByTestId('cross-chain-send-route-chip');
    expect(chip).toHaveTextContent('Select network');

    fireEvent.click(chip);
    fireEvent.click(await screen.findByText('USDC'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByText('Base'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Back on the amount, with the network named and its bounds beside it.
    expect(await screen.findByTestId('amount-input')).toBeInTheDocument();
    expect(screen.getByTestId('cross-chain-send-route-chip')).toHaveTextContent('USDC on Base');
    expect(screen.getByTestId('send-amount-hint')).toHaveTextContent('$0.80 – $89 800');

    // Recorded, which is what lets the workflow skip straight to the quote.
    expect(getLastSendRoute(ADDRESSES.picked)).toEqual({ asset: 'USDC', chain: 'base' });
  });

  it('takes the network and coin a destination names for itself', async () => {
    // What a scanned cross-chain URI carries: the chain id and the token
    // contract, which between them leave nothing to ask.
    await openOnAmountStep(ADDRESSES.named, { chainId: 42161, contractAddress: '0xDAC1USDT' });

    expect(await screen.findByTestId('cross-chain-send-route-chip'))
      .toHaveTextContent('USDT on Arbitrum');
    expect(getLastSendRoute(ADDRESSES.named)).toEqual({ asset: 'USDT', chain: 'arbitrum' });
  });

  it('still asks when a bare address leaves the network open', async () => {
    await openOnAmountStep(ADDRESSES.bare);

    expect(await screen.findByTestId('cross-chain-send-route-chip'))
      .toHaveTextContent('Select network');
    expect(getLastSendRoute(ADDRESSES.bare)).toBeNull();
  });
});
