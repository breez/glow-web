import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { saveFiatSettings, setDisplayFiatCurrency } from '@/services/settings';
import AmountPanel from './AmountPanel';

// Mock rates put BTC at $100,000 and €92,000, so $1 = 1,000 sats.
function renderAmountPanel(client?: BreezSdk) {
  const setAmountSats = vi.fn();
  const mockClient = client ?? createMockClient();
  render(
    <WalletProvider client={mockClient} isConnected>
      <FiatDataProvider>
        <StableBalanceProvider>
          <AmountPanel
            isOpen
            amountSats={null}
            setAmountSats={setAmountSats}
            description=""
            setDescription={vi.fn()}
            isLoading={false}
            error={null}
            onCreateInvoice={vi.fn()}
            onClose={vi.fn()}
            resetCount={0}
          />
        </StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
  return { setAmountSats, client: mockClient };
}

describe('AmountPanel fiat entry (no stable balance)', () => {
  afterEach(() => {
    saveFiatSettings({ selectedCurrencies: ['USD'] });
    setDisplayFiatCurrency('USD');
  });

  it('converts typed dollars to sats', async () => {
    const { setAmountSats } = renderAmountPanel();

    // The switcher appears once the USD rate loads.
    fireEvent.click(await screen.findByRole('button', { name: '₿' }));
    fireEvent.change(screen.getByTestId('invoice-amount-input'), { target: { value: '5' } });

    await waitFor(() => expect(setAmountSats).toHaveBeenCalledWith(5000n));
  });

  it('denominates in the currency the balance header is showing', async () => {
    saveFiatSettings({ selectedCurrencies: ['USD', 'EUR'] });
    // What the header writes when the user taps the balance to cycle to EUR.
    setDisplayFiatCurrency('EUR');
    const { setAmountSats } = renderAmountPanel();

    fireEvent.click(await screen.findByRole('button', { name: '₿' }));
    fireEvent.change(screen.getByTestId('invoice-amount-input'), { target: { value: '5' } });

    // €5 at €92,000/BTC = 5,435 sats.
    await waitFor(() => expect(setAmountSats).toHaveBeenCalledWith(5435n));
    expect(screen.getByRole('button', { name: '€' })).toBeInTheDocument();
  });

  it('falls back to the top of the list when that currency is deselected', async () => {
    setDisplayFiatCurrency('EUR');
    saveFiatSettings({ selectedCurrencies: ['USD'] });
    const { setAmountSats } = renderAmountPanel();

    fireEvent.click(await screen.findByRole('button', { name: '₿' }));
    fireEvent.change(screen.getByTestId('invoice-amount-input'), { target: { value: '5' } });

    await waitFor(() => expect(setAmountSats).toHaveBeenCalledWith(5000n));
  });

  it('offers no fiat toggle while the rate has not loaded', async () => {
    const client = createMockClient({
      listFiatRates: vi.fn().mockResolvedValue({ rates: [] }),
    } as unknown as Partial<BreezSdk>);
    renderAmountPanel(client);

    await waitFor(() => expect(client.listFiatRates).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '₿' })).toBeNull();
  });
});
