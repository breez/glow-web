import React from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { createMockClient } from '../mocks/mockWalletApi';

/**
 * Extended render options that allow injecting a custom BreezSdk mock
 */
interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  client?: BreezSdk;
}

/**
 * Extended render result that includes the mock client for assertions
 */
interface ExtendedRenderResult extends RenderResult {
  client: BreezSdk;
}

/**
 * Renders a React component with all necessary providers for testing.
 * Automatically creates a mock BreezSdk client unless one is provided.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { getByTestId } = renderWithProviders(<MyComponent />);
 *
 * // With custom mock
 * const mockClient = createMockClient({
 *   getInfo: vi.fn().mockResolvedValue({ balanceSats: 50000 }),
 * });
 * const { client } = renderWithProviders(<MyComponent />, { client: mockClient });
 *
 * // Assert on mock calls
 * expect(client.getInfo).toHaveBeenCalled();
 * ```
 */
export function renderWithProviders(
  ui: React.ReactElement,
  { client, ...options }: ExtendedRenderOptions = {}
): ExtendedRenderResult {
  const mockClient = client ?? createMockClient();

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ToastProvider>
        <WalletProvider client={mockClient}>{children}</WalletProvider>
      </ToastProvider>
    );
  }

  const renderResult = render(ui, { wrapper: Wrapper, ...options });

  return {
    ...renderResult,
    client: mockClient,
  };
}

/**
 * Creates a wrapper component for use with @testing-library/react-hooks
 * or custom hook testing scenarios.
 */
export function createTestWrapper(client?: BreezSdk) {
  const mockClient = client ?? createMockClient();

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ToastProvider>
      <WalletProvider client={mockClient}>{children}</WalletProvider>
    </ToastProvider>
  );

  return { Wrapper, client: mockClient };
}

// Re-export everything from @testing-library/react for convenience
export * from '@testing-library/react';

// Also export the mock creator for direct use
export { createMockClient } from '../mocks/mockWalletApi';
