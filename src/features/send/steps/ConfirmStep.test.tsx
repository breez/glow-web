import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { saveFiatSettings, setDisplayFiatCurrency } from '@/services/settings';
import ConfirmStep, { type ConfirmStepProps } from './ConfirmStep';

function renderConfirmStep(
  destination?: { label: string; value: string },
  overrides?: Partial<ConfirmStepProps>,
  client = createMockClient(),
) {
  render(
    <WalletProvider client={client} isConnected>
      <FiatDataProvider>
        <StableBalanceProvider>
          <ConfirmStep
            amountSats={50000n}
            feesSat={10}
            balanceSats={1000000}
            destination={destination}
            error={null}
            isLoading={false}
            onConfirm={vi.fn()}
            {...overrides}
          />
        </StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
}

describe('ConfirmStep destination', () => {
  it('shows the destination alongside the Send action', () => {
    const value = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    renderConfirmStep({ label: 'To address', value });

    const row = screen.getByTestId('send-destination');
    // Middle-truncated, so both ends stay checkable against the source.
    expect(row).toHaveTextContent(/^bc1qw508d6qejx.*0c5xw7kv8f3t4$/);
    expect(row).toHaveAttribute('title', value);
    expect(screen.getByTestId('send-confirm-button')).toBeEnabled();
  });

  it('renders without a destination when prepare produced no payment method', () => {
    renderConfirmStep(undefined);
    expect(screen.queryByTestId('send-destination')).toBeNull();
  });
});

describe('ConfirmStep prepare failure', () => {
  it('shows the prepare error, not a balance verdict it cannot make', () => {
    // Sat balance below the amount is the normal state for a wallet holding
    // its balance in a token: the sat funding comes from a conversion the
    // failed prepare never got to quote.
    renderConfirmStep(undefined, {
      feesSat: null,
      balanceSats: 0,
      error: 'Failed to prepare payment: no route to destination',
      disableConfirm: true,
    });

    expect(screen.getByText(/no route to destination/)).toBeInTheDocument();
    expect(screen.queryByText('Insufficient funds')).toBeNull();
    expect(screen.getByTestId('send-confirm-button')).toBeDisabled();
  });
});

describe('ConfirmStep fiat equivalent', () => {
  afterEach(() => {
    saveFiatSettings({ selectedCurrencies: ['USD'] });
    setDisplayFiatCurrency('USD');
  });

  // The provider fetches rates on mount. A test that expects no line waits
  // for that fetch to settle, so it cannot pass just by looking too early.
  async function renderAfterRates(overrides?: Partial<ConfirmStepProps>, client = createMockClient()) {
    renderConfirmStep(undefined, overrides, client);
    await waitFor(() => expect(vi.mocked(client.listFiatRates).mock.settledResults[0]?.type).toBe('fulfilled'));
  }

  it('shows the total in the currency the balance header shows', async () => {
    saveFiatSettings({ selectedCurrencies: ['USD', 'EUR'] });
    setDisplayFiatCurrency('EUR');
    renderConfirmStep();

    // 50,010 sats at 92,000 EUR/BTC = 46.0092 EUR
    expect(await screen.findByTestId('send-fiat-equivalent')).toHaveTextContent('~\u20ac46.01');
  });

  it('counts the fee once when it is included in the amount', async () => {
    renderConfirmStep(undefined, { feesIncluded: true });

    // 50,000 sats at 100,000 USD/BTC
    expect(await screen.findByTestId('send-fiat-equivalent')).toHaveTextContent('~$50.00');
  });

  it('has no fiat line for a total worth less than the smallest unit', async () => {
    await renderAfterRates({ amountSats: 3n, feesSat: 1 });

    expect(screen.queryByTestId('send-fiat-equivalent')).toBeNull();
  });

  it('has no fiat line without a rate', async () => {
    await renderAfterRates({}, createMockClient({ listFiatRates: vi.fn().mockResolvedValue({ rates: [] }) }));

    expect(screen.queryByTestId('send-fiat-equivalent')).toBeNull();
  });

  it('has no fiat line when no currency is enabled', async () => {
    saveFiatSettings({ selectedCurrencies: [] });
    await renderAfterRates();

    expect(screen.queryByTestId('send-fiat-equivalent')).toBeNull();
  });
});
