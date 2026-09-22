import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import StableBalanceToggleFlow from './StableBalanceToggleFlow';

const toggleStableBalance = vi.fn();

vi.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({ getInfo: async () => ({ balanceSats: 0, tokenBalances: [] }) }),
}));
vi.mock('../contexts/StableBalanceContext', () => ({
  useStableBalance: () => ({ toggleStableBalance, displayConfig: null }),
}));
vi.mock('../contexts/FiatDataContext', () => ({
  useFiatData: () => ({ fiatRates: [], fiatCurrencies: [] }),
}));
// Partial: the logger reads its own settings through this module, and a bare
// mock takes those with it.
vi.mock('../services/settings', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/settings')>()),
  hasAcceptedStableDisclaimer: () => true,
  setStableDisclaimerAccepted: () => {},
}));

beforeEach(() => {
  cleanup();
  toggleStableBalance.mockReset();
});

describe('switching to USD', () => {
  const renderFlow = () => {
    const onComplete = vi.fn();
    render(
      <StableBalanceToggleFlow isOpen direction="toToken" onComplete={onComplete} onCancel={() => {}} />,
    );
    return { onComplete };
  };

  it('holds the sheet open and names the failure when the switch fails', async () => {
    toggleStableBalance.mockRejectedValue(new Error('user settings unavailable'));
    const { onComplete } = renderFlow();

    fireEvent.click(await screen.findByText('Confirm'));

    expect(await screen.findByText(/user settings unavailable/)).toBeInTheDocument();
    // The whole point: a failed switch must not report itself as done.
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('completes when the switch goes through', async () => {
    toggleStableBalance.mockResolvedValue(undefined);
    const { onComplete } = renderFlow();

    fireEvent.click(await screen.findByText('Confirm'));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });
});
