import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { SdkEvent } from '@breeztech/breez-sdk-spark';
import { StableBalanceProvider, useStableBalance } from './StableBalanceContext';
import { getStableConversionFailure, setStableConversionFailure } from '../services/settings';

const updateUserSettings = vi.fn();
const fetchConversionLimits = async () => ({ minFromAmount: undefined });
let emit: (event: SdkEvent) => void = () => {};

vi.mock('./WalletContext', () => ({
  useWalletConnection: () => ({ sdk: { updateUserSettings, fetchConversionLimits }, isConnected: true }),
  useSdkEvents: () => (listener: (event: SdkEvent) => void) => {
    emit = listener;
    return () => {};
  },
  useWalletInfo: () => null,
}));
vi.mock('./FiatDataContext', () => ({
  useFiatData: () => ({ fiatRates: [], fiatCurrencies: [] }),
}));

const Probe: React.FC = () => {
  const { toggleStableBalance } = useStableBalance();
  return (
    <button
      onClick={() => {
        void toggleStableBalance('USDB').then(
          () => { document.title = 'switched'; },
          (e: Error) => { document.title = e.message; },
        );
      }}
    >
      toggle
    </button>
  );
};

beforeEach(() => {
  cleanup();
  updateUserSettings.mockReset();
  setStableConversionFailure(null);
  document.title = '';
});

describe('toggleStableBalance', () => {
  it('reports a failed switch to its caller rather than swallowing it', async () => {
    updateUserSettings.mockRejectedValue(new Error('user settings unavailable'));
    render(<StableBalanceProvider><Probe /></StableBalanceProvider>);

    fireEvent.click(screen.getByText('toggle'));

    // Swallowed here, the toggle flow reads a failure as a completed switch.
    await waitFor(() => expect(document.title).toBe('user settings unavailable'));
  });

  // The SDK queues the new conversion inside updateUserSettings, so its
  // failure can arrive before the call returns.
  it('keeps a failure the switch reports before it returns', async () => {
    setStableConversionFailure({ kind: 'deactivation', retryAt: 1 });
    updateUserSettings.mockImplementation(async () => {
      emit({ type: 'stableBalanceConversionFailed', conversion: 'autoConvert', error: 'no route', retryInSecs: 30 });
    });
    render(<StableBalanceProvider><Probe /></StableBalanceProvider>);

    fireEvent.click(screen.getByText('toggle'));

    await waitFor(() => expect(document.title).toBe('switched'));
    expect(getStableConversionFailure()?.kind).toBe('autoConvert');
  });

  it('puts the old failure back when the switch fails', async () => {
    setStableConversionFailure({ kind: 'deactivation', retryAt: 1 });
    updateUserSettings.mockRejectedValue(new Error('user settings unavailable'));
    render(<StableBalanceProvider><Probe /></StableBalanceProvider>);

    fireEvent.click(screen.getByText('toggle'));

    await waitFor(() => expect(document.title).toBe('user settings unavailable'));
    expect(getStableConversionFailure()).toEqual({ kind: 'deactivation', retryAt: 1 });
  });
});
