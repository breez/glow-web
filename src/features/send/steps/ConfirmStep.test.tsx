import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import ConfirmStep, { type ConfirmStepProps } from './ConfirmStep';

function renderConfirmStep(
  destination?: { label: string; value: string },
  overrides?: Partial<ConfirmStepProps>,
) {
  render(
    <WalletProvider client={createMockClient()} isConnected>
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
