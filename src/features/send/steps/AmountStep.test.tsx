import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import AmountStep, { AmountStepProps } from './AmountStep';

// Mock rates put BTC at $100,000, so $1 = 1,000 sats.
function renderAmountStep(props: Partial<AmountStepProps> = {}, client?: BreezSdk) {
  const onNext = vi.fn();
  const mockClient = client ?? createMockClient();
  render(
    <WalletProvider client={mockClient} isConnected>
      <FiatDataProvider>
        <StableBalanceProvider>
          <AmountStep
            paymentInput="sp1test"
            amount=""
            balanceSats={100000}
            isLoading={false}
            error={null}
            onBack={vi.fn()}
            onNext={onNext}
            {...props}
          />
        </StableBalanceProvider>
      </FiatDataProvider>
    </WalletProvider>
  );
  return { onNext, client: mockClient };
}

describe('AmountStep USD entry (no stable balance)', () => {
  it('starts in sats and continues with a sats amount', async () => {
    const { onNext } = renderAmountStep();

    const input = screen.getByTestId('amount-input');
    expect(input).toHaveAttribute('placeholder', 'Enter amount in satoshis');

    fireEvent.change(input, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onNext).toHaveBeenCalledWith(1500n, false));
  });

  it('toggles to USD and converts the typed dollars to sats', async () => {
    const { onNext } = renderAmountStep();

    // The switcher appears once the USD rate loads.
    const switcher = await screen.findByRole('button', { name: '₿' });
    fireEvent.click(switcher);

    const input = screen.getByTestId('amount-input');
    expect(input).toHaveAttribute('placeholder', 'Enter amount in $');

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onNext).toHaveBeenCalledWith(5000n, false));
  });

  it('rejects a USD amount that exceeds the BTC balance', async () => {
    const { onNext } = renderAmountStep();

    fireEvent.click(await screen.findByRole('button', { name: '₿' }));
    fireEvent.change(screen.getByTestId('amount-input'), { target: { value: '500' } });

    // $500 = 500,000 sats > 100,000 sats balance
    await screen.findByText('Amount exceeds available balance');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('offers no USD toggle while the rate has not loaded', async () => {
    const client = createMockClient({
      listFiatRates: vi.fn().mockResolvedValue({ rates: [] }),
    } as unknown as Partial<BreezSdk>);
    renderAmountStep({}, client);

    await waitFor(() => expect(client.listFiatRates).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '₿' })).toBeNull();
    expect(screen.getByTestId('amount-input')).toHaveAttribute(
      'placeholder',
      'Enter amount in satoshis'
    );
  });

  it('keeps cross-chain (amountFirst) USD-only with no toggle', async () => {
    renderAmountStep({ amountFirst: true });

    expect(screen.getByTestId('amount-input')).toHaveAttribute(
      'placeholder',
      'Enter amount in USD'
    );
    expect(screen.queryByRole('button', { name: '₿' })).toBeNull();
    expect(screen.queryByRole('button', { name: '$' })).toBeNull();
  });
});
