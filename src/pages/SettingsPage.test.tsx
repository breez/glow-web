import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { WalletProvider } from '@/contexts/WalletContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import { setDevMode } from '@/services/settings';
import SettingsPage from './SettingsPage';

const renderSettings = () => render(
  <ToastProvider>
  <WalletProvider client={createMockClient() as unknown as BreezSdk} isConnected>
  <SettingsPage
    onBack={vi.fn()}
    config={null}
    onOpenFiatCurrencies={vi.fn()}
    onOpenBuyProviders={vi.fn()}
    onOpenPasskeySettings={vi.fn()}
    onOpenSecurity={vi.fn()}
    onOpenBackup={vi.fn()}
    onOpenUnilateralExit={vi.fn()}
  />
  </WalletProvider>
  </ToastProvider>
);

// `vite.config.ts` defines this at build time, so the version line has nothing
// to read under vitest.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');

afterEach(() => {
  setDevMode(false);
  localStorage.clear();
});

describe('unilateral exit on the settings page', () => {
  it('is not offered without dev mode', () => {
    setDevMode(false);
    renderSettings();

    expect(screen.queryByTestId('settings-unilateral-exit')).toBeNull();
  });

  it('is offered with dev mode on', () => {
    setDevMode(true);
    renderSettings();

    expect(screen.getByTestId('settings-unilateral-exit')).toBeInTheDocument();
  });
});
