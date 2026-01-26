import React from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import type { WalletAPI } from '@/services/WalletAPI';
import { createMockWalletApi } from '../mocks/mockWalletApi';

/**
 * Extended render options that allow injecting a custom WalletAPI
 */
interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  walletApi?: WalletAPI;
}

/**
 * Extended render result that includes the walletApi for assertions
 */
interface ExtendedRenderResult extends RenderResult {
  walletApi: WalletAPI;
}

/**
 * Renders a React component with all necessary providers for testing.
 * Automatically creates a mock WalletAPI unless one is provided.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { getByTestId } = renderWithProviders(<MyComponent />);
 *
 * // With custom mock
 * const mockApi = createMockWalletApi({
 *   getWalletInfo: vi.fn().mockResolvedValue({ balanceSat: 50000n }),
 * });
 * const { walletApi } = renderWithProviders(<MyComponent />, { walletApi: mockApi });
 *
 * // Assert on mock calls
 * expect(walletApi.getWalletInfo).toHaveBeenCalled();
 * ```
 */
export function renderWithProviders(
  ui: React.ReactElement,
  { walletApi, ...options }: ExtendedRenderOptions = {}
): ExtendedRenderResult {
  const mockWalletApi = walletApi ?? createMockWalletApi();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ToastProvider>
        <WalletProvider api={mockWalletApi}>{children}</WalletProvider>
      </ToastProvider>
    );
  }

  const renderResult = render(ui, { wrapper: Wrapper, ...options });

  return {
    ...renderResult,
    walletApi: mockWalletApi,
  };
}

/**
 * Creates a wrapper component for use with @testing-library/react-hooks
 * or custom hook testing scenarios.
 */
export function createTestWrapper(walletApi?: WalletAPI) {
  const mockWalletApi = walletApi ?? createMockWalletApi();

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ToastProvider>
      <WalletProvider api={mockWalletApi}>{children}</WalletProvider>
    </ToastProvider>
  );

  return { Wrapper, walletApi: mockWalletApi };
}

// Re-export everything from @testing-library/react for convenience
export * from '@testing-library/react';

// Also export the mock creator for direct use
export { createMockWalletApi } from '../mocks/mockWalletApi';
