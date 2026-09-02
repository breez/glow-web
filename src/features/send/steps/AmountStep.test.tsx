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
    expect(input).toHaveAttribute('placeholder', 'Enter amount in sats');

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
    expect(input).toHaveAttribute('placeholder', 'Enter amount in USD');

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
      'Enter amount in sats'
    );
  });

  const buttonLabels = () => screen.getAllByRole('button').map((b) => b.textContent);

  // The mock puts BTC at $100,000, which is also the pre-rate fallback scale, so
  // a test that asserts against it cannot tell the two apart. Waiting for the
  // switcher is what proves the rate landed first.
  const ratedLabels = async () => {
    await screen.findByRole('button', { name: '₿' });
    return buttonLabels();
  };

  it('offers only quick amounts the balance covers', async () => {
    // 3,000 sats clears ₿1 000 and ₿2 000 and nothing above.
    renderAmountStep({ balanceSats: 3000 });

    const labels = await ratedLabels();
    expect(labels).toContain('₿1 000');
    expect(labels).toContain('₿2 000');
    expect(labels).not.toContain('₿5 000');
    expect(labels).not.toContain('₿100 000');
  });

  it('never offers the whole balance as a quick amount', async () => {
    // 100,000 sats: the largest round amount inside the fee headroom is
    // ₿50 000, so tapping a quick amount can't dead-end on insufficient funds.
    renderAmountStep();

    const labels = await ratedLabels();
    expect(labels).toEqual(expect.arrayContaining(['₿2 000', '₿10 000', '₿50 000']));
    expect(labels).not.toContain('₿100 000');
  });

  it('scales the quick amounts to the loaded rate, not the fallback', async () => {
    // BTC at $50,000 makes a dollar 2,000 sats, so the smallest round amount
    // worth a dollar is ₿2 000. The fallback scale would still offer ₿1 000.
    const client = createMockClient({
      listFiatRates: vi.fn().mockResolvedValue({ rates: [{ coin: 'USD', value: 50000 }] }),
    } as unknown as Partial<BreezSdk>);
    renderAmountStep({ balanceSats: 3000 }, client);

    await waitFor(() => expect(buttonLabels()).not.toContain('₿1 000'));
    expect(buttonLabels()).toContain('₿2 000');
  });

  it('offers sat quick amounts before any rate has loaded', () => {
    // Sats entry works without a rate, so the row falls back rather than
    // waiting. Asserted synchronously: the rate never arrives here.
    const client = createMockClient({
      listFiatRates: vi.fn(() => new Promise(() => {})),
    } as unknown as Partial<BreezSdk>);
    renderAmountStep({ balanceSats: 3000 }, client);

    expect(buttonLabels()).toEqual(expect.arrayContaining(['₿1 000', '₿2 000']));
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
