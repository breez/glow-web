import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import ConfirmStep from './ConfirmStep';

function renderConfirmStep(destination?: { label: string; value: string }) {
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
