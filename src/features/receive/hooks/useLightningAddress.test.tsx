import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { useLightningAddress } from './useLightningAddress';

// The LNURL server reaches the WebView as an opaque fetch failure, which is
// what the user reported seeing pasted verbatim into the Receive sheet.
const RAW_SDK_ERROR = new Error(
  'Network error: Request error: error sending request : JsValue(TypeError: Load failed\nundefined)',
);

function renderLightningAddress(client: BreezSdk) {
  return renderHook(() => useLightningAddress(), {
    wrapper: ({ children }) => (
      <WalletProvider client={client} isConnected>
        {children}
      </WalletProvider>
    ),
  });
}

describe('useLightningAddress error copy', () => {
  it('shows a generic message instead of the raw SDK error when loading fails', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    vi.mocked(client.getLightningAddress).mockRejectedValue(RAW_SDK_ERROR);

    const { result } = renderLightningAddress(client);

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe("Couldn't load your Lightning address. Please try again.");
    expect(result.current.error).not.toContain('Load failed');
  });

  it('shows a generic message instead of the raw SDK error when saving fails', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    vi.mocked(client.registerLightningAddress).mockRejectedValue(RAW_SDK_ERROR);

    const { result } = renderLightningAddress(client);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setEditValue('umiyahara'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.error).toBe("Couldn't save your Lightning address. Please try again.");
    expect(result.current.error).not.toContain('Load failed');
  });

  it('still names a taken username rather than falling back to the generic message', async () => {
    const client = createMockClient() as unknown as BreezSdk;
    vi.mocked(client.checkLightningAddressAvailable).mockResolvedValue(false);

    const { result } = renderLightningAddress(client);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setEditValue('umiyahara'));
    await act(async () => {
      await result.current.save();
    });

    expect(result.current.error).toBe('This username is not available');
  });
});
