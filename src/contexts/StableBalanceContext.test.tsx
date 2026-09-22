import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StableBalanceProvider, useStableBalance } from './StableBalanceContext';

const updateUserSettings = vi.fn();

vi.mock('./WalletContext', () => ({
  useWalletConnection: () => ({ sdk: { updateUserSettings }, isConnected: true }),
}));
vi.mock('./FiatDataContext', () => ({
  useFiatData: () => ({ fiatRates: [], fiatCurrencies: [] }),
}));

const Probe: React.FC = () => {
  const { toggleStableBalance } = useStableBalance();
  return (
    <button onClick={() => { void toggleStableBalance('USDB').catch((e: Error) => { document.title = e.message; }); }}>
      toggle
    </button>
  );
};

describe('toggleStableBalance', () => {
  it('reports a failed switch to its caller rather than swallowing it', async () => {
    updateUserSettings.mockRejectedValue(new Error('user settings unavailable'));
    render(<StableBalanceProvider><Probe /></StableBalanceProvider>);

    fireEvent.click(screen.getByText('toggle'));

    // Swallowed here, the toggle flow reads a failure as a completed switch.
    await waitFor(() => expect(document.title).toBe('user settings unavailable'));
  });
});
