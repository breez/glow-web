import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ConversionEstimate } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { FiatDataProvider } from '@/contexts/FiatDataContext';
import { StableBalanceProvider } from '@/contexts/StableBalanceContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import ConfirmStep, { type ConfirmStepProps } from './ConfirmStep';

// Stable balance needs an SDK round trip to switch on, so the hook is stubbed
// rather than driven: what is under test is which denomination leads.
const stable = vi.hoisted(() => ({ value: { isActive: false, displayConfig: null, btcFiatRate: 0 } }));
vi.mock('@/contexts/StableBalanceContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/StableBalanceContext')>()),
  useStableBalance: () => stable.value,
}));

const USDB_CONFIG = {
  symbol: '$',
  currencyCode: 'USD',
  symbolPosition: 'before',
  fractionSize: 2,
  decimals: 6,
  fiatCurrencyId: 'USD',
  fiatCurrencyName: 'US Dollar',
};

beforeEach(() => {
  stable.value = { isActive: false, displayConfig: null, btcFiatRate: 0 };
});

/** Stable balance holding USDB, with a conversion quoted for this send. */
function inStableBalance(amountIn: bigint, fee: bigint) {
  stable.value = { isActive: true, displayConfig: USDB_CONFIG as never, btcFiatRate: 100000 } as never;
  return { amountIn, fee } as unknown as ConversionEstimate;
}

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

describe('ConfirmStep in stable balance', () => {
  it('leads with the dollar figure and keeps the sats it settles', () => {
    // $200.20 in, of which $0.200668 is the pool's cut.
    const conversionEstimate = inStableBalance(200_200_000n, 200_668n);
    renderConfirmStep(undefined, { conversionEstimate });

    expect(screen.getByTestId('send-total')).toHaveTextContent('~$200.20');
    expect(screen.getByTestId('send-total-sats')).toHaveTextContent('50 010');
    expect(screen.getByText('$0.20')).toBeInTheDocument();
  });

  it('states the fee once, the amount above it already including it', () => {
    renderConfirmStep(undefined, { conversionEstimate: inStableBalance(200_200_000n, 200_668n) });
    expect(screen.queryByText('Conversion amount')).toBeNull();
  });

  it('groups a four-figure amount with commas', () => {
    renderConfirmStep(undefined, { conversionEstimate: inStableBalance(1_234_560_000n, 1_200_000n) });
    expect(screen.getByTestId('send-total')).toHaveTextContent('~$1,234.56');
  });

  it('bounds a sub-cent fee rather than showing it as free', () => {
    renderConfirmStep(undefined, { conversionEstimate: inStableBalance(200_200_000n, 5_036n) });
    expect(screen.getByText('< $0.01')).toBeInTheDocument();
  });

  it('leads with sats when the balance is bitcoin', () => {
    renderConfirmStep(undefined);
    expect(screen.getByTestId('send-total')).toHaveTextContent('50 010');
    expect(screen.queryByTestId('send-total-sats')).toBeNull();
  });
});
