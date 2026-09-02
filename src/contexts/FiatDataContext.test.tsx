import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from './WalletContext';
import { FiatDataProvider, useFiatData } from './FiatDataContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';

const UsdRate = () => {
  const { fiatRates } = useFiatData();
  return <span data-testid="usd">{fiatRates.find(r => r.coin === 'USD')?.value ?? 'none'}</span>;
};

function renderWithRates(client: BreezSdk) {
  render(
    <WalletProvider client={client} isConnected>
      <FiatDataProvider><UsdRate /></FiatDataProvider>
    </WalletProvider>
  );
}

function returnToForeground(event = 'visibilitychange', times = 1) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  act(() => {
    const target = event === 'pageshow' ? window : document;
    for (let i = 0; i < times; i++) target.dispatchEvent(new Event(event));
    vi.advanceTimersByTime(1500);
  });
}

const goToBackgroundAndReturn = () => returnToForeground();

const RefreshButton = () => {
  const { fiatRates, refreshFiatData } = useFiatData();
  return (
    <button onClick={() => void refreshFiatData()}>
      {fiatRates.find(r => r.coin === 'USD')?.value ?? 'none'}
    </button>
  );
};

describe('refreshFiatData', () => {
  it('fetches a current rate instead of reusing the loaded one', async () => {
    const client = createMockClient();
    render(
      <WalletProvider client={client} isConnected>
        <FiatDataProvider><RefreshButton /></FiatDataProvider>
      </WalletProvider>
    );
    const button = await screen.findByRole('button', { name: '100000' });

    vi.mocked(client.listFiatRates).mockResolvedValue({ rates: [{ coin: 'USD', value: 123456 }] });
    button.click();

    await screen.findByRole('button', { name: '123456' });
  });

  it('falls back to the last known rate so a blip does not break the caller', async () => {
    const client = createMockClient();
    render(
      <WalletProvider client={client} isConnected>
        <FiatDataProvider><RefreshButton /></FiatDataProvider>
      </WalletProvider>
    );
    const button = await screen.findByRole('button', { name: '100000' });

    vi.mocked(client.listFiatRates).mockRejectedValue(new Error('offline'));
    button.click();

    await waitFor(() => expect(client.listFiatRates).toHaveBeenCalledTimes(2));
    expect(button).toHaveTextContent('100000');
  });
});

describe('FiatDataProvider', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('refetches rates when the app returns to the foreground', async () => {
    // A frozen interval is why a resumed WebView keeps showing an old price.
    const client = createMockClient();
    renderWithRates(client);
    await screen.findByText('100000');

    vi.mocked(client.listFiatRates).mockResolvedValue({ rates: [{ coin: 'USD', value: 123456 }] });
    goToBackgroundAndReturn();

    await waitFor(() => expect(screen.getByTestId('usd')).toHaveTextContent('123456'));
  });

  it('refetches on a bfcache restore, which skips visibilitychange', async () => {
    const client = createMockClient();
    renderWithRates(client);
    await screen.findByText('100000');

    vi.mocked(client.listFiatRates).mockResolvedValue({ rates: [{ coin: 'USD', value: 123456 }] });
    returnToForeground('pageshow');

    await waitFor(() => expect(screen.getByTestId('usd')).toHaveTextContent('123456'));
  });

  it('coalesces a burst of foreground events into one refetch', async () => {
    const client = createMockClient();
    renderWithRates(client);
    await screen.findByText('100000');
    expect(client.listFiatRates).toHaveBeenCalledTimes(1);

    returnToForeground('visibilitychange', 3);

    await waitFor(() => expect(client.listFiatRates).toHaveBeenCalledTimes(2));
  });

  it('keeps the last good rates when a refetch fails', async () => {
    const client = createMockClient();
    renderWithRates(client);
    await screen.findByText('100000');

    vi.mocked(client.listFiatRates).mockRejectedValue(new Error('offline'));
    goToBackgroundAndReturn();

    await waitFor(() => expect(client.listFiatRates).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('usd')).toHaveTextContent('100000');
  });
});
