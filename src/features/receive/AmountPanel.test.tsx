import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import type { Sats } from '@/types/sats';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { saveFiatSettings, setDisplayFiatCurrency } from '@/services/settings';
import { waitForSheetOpen } from '@/test/utils/waitForSheetOpen';
import AmountPanel from './AmountPanel';

// Mock rates put BTC at $100,000 and €92,000, so $1 = 1,000 sats.
async function renderAmountPanel(client?: BreezSdk) {
  const setAmountSats = vi.fn();
  const setAmountDisplay = vi.fn();
  const mockClient = client ?? createMockClient();
  render(
    <WalletProvider client={mockClient} isConnected>
      <FiatDataProvider>
        <StableBalanceProvider>
          <AmountPanel
            isOpen
            amountSats={null}
            setAmountSats={setAmountSats}
            setAmountDisplay={setAmountDisplay}
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
  await waitForSheetOpen();
  return { setAmountSats, setAmountDisplay, client: mockClient };
}

/** The panel reads `amountSats` back from its parent, so a static prop can
 *  never enable the button. This holds it the way the dialog does. */
const Stateful: React.FC = () => {
  const [amountSats, setAmountSats] = React.useState<Sats | null>(null);
  return (
    <AmountPanel
      isOpen
      amountSats={amountSats}
      setAmountSats={setAmountSats}
      setAmountDisplay={vi.fn()}
      description=""
      setDescription={vi.fn()}
      isLoading={false}
      error={null}
      onCreateInvoice={vi.fn()}
      onClose={vi.fn()}
      resetCount={0}
    />
  );
};

describe('AmountPanel amount cap', () => {
  it('refuses an amount past the cap, and says the cap', async () => {
    render(
      <WalletProvider client={createMockClient() as unknown as BreezSdk} isConnected>
        <FiatDataProvider>
          <StableBalanceProvider>
            <Stateful />
          </StableBalanceProvider>
        </FiatDataProvider>
      </WalletProvider>,
    );
    await waitForSheetOpen();
    const input = screen.getByTestId('invoice-amount-input');

    // 10 BTC goes through; a sat past it does not.
    fireEvent.change(input, { target: { value: '1000000000' } });
    await waitFor(() => expect(screen.getByTestId('generate-invoice-button')).toBeEnabled());

    fireEvent.change(input, { target: { value: '1000000001' } });
    await waitFor(() => expect(screen.getByTestId('generate-invoice-button')).toBeDisabled());
    expect(screen.getByTestId('invoice-error-message'))
      .toHaveTextContent('Amount must be at most \u20bf1 000 000 000');
  });
});

describe('AmountPanel fiat entry (no stable balance)', () => {
  afterEach(() => {
    saveFiatSettings({ selectedCurrencies: ['USD'] });
    setDisplayFiatCurrency('USD');
  });

  it('converts typed dollars to sats', async () => {
    const { setAmountSats } = await renderAmountPanel();

    // The switcher appears once the USD rate loads.
    fireEvent.click(await screen.findByRole('button', { name: '₿' }));
    fireEvent.change(screen.getByTestId('invoice-amount-input'), { target: { value: '5' } });

    await waitFor(() => expect(setAmountSats).toHaveBeenCalledWith(5000n));
  });

  it('denominates in the currency the balance header is showing', async () => {
    saveFiatSettings({ selectedCurrencies: ['USD', 'EUR'] });
    // What the header writes when the user taps the balance to cycle to EUR.
    setDisplayFiatCurrency('EUR');
    const { setAmountSats } = await renderAmountPanel();

    fireEvent.click(await screen.findByRole('button', { name: '₿' }));
    fireEvent.change(screen.getByTestId('invoice-amount-input'), { target: { value: '5' } });

    // €5 at €92,000/BTC = 5,435 sats.
    await waitFor(() => expect(setAmountSats).toHaveBeenCalledWith(5435n));
    expect(screen.getByRole('button', { name: '€' })).toBeInTheDocument();
  });

  it('falls back to the top of the list when that currency is deselected', async () => {
    setDisplayFiatCurrency('EUR');
    saveFiatSettings({ selectedCurrencies: ['USD'] });
    const { setAmountSats } = await renderAmountPanel();

    fireEvent.click(await screen.findByRole('button', { name: '₿' }));
    fireEvent.change(screen.getByTestId('invoice-amount-input'), { target: { value: '5' } });

    await waitFor(() => expect(setAmountSats).toHaveBeenCalledWith(5000n));
  });

  it('hands the invoice the figure as typed, in the unit it was typed in', async () => {
    const { setAmountDisplay } = await renderAmountPanel();

    // Sats mode: the sats are the figure, so there is nothing else to state.
    fireEvent.change(screen.getByTestId('invoice-amount-input'), { target: { value: '5000' } });
    await waitFor(() => expect(setAmountDisplay).toHaveBeenLastCalledWith(null));

    fireEvent.click(await screen.findByRole('button', { name: '₿' }));
    fireEvent.change(screen.getByTestId('invoice-amount-input'), { target: { value: '5' } });
    await waitFor(() => expect(setAmountDisplay).toHaveBeenLastCalledWith('$5.00'));
  });

  it('offers no fiat toggle while the rate has not loaded', async () => {
    const client = createMockClient({
      listFiatRates: vi.fn().mockResolvedValue({ rates: [] }),
    } as unknown as Partial<BreezSdk>);
    await renderAmountPanel(client);

    await waitFor(() => expect(client.listFiatRates).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '₿' })).toBeNull();
  });
});
