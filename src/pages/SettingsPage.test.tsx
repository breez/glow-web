import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalletProvider } from '@/contexts/WalletContext';
import { createMockClient } from '@/test/mocks/mockWalletApi';
import SettingsPage from './SettingsPage';

function renderSettings() {
  const onDeleteAccount = vi.fn();
  render(
    <WalletProvider client={createMockClient()} isConnected>
      <SettingsPage
        onBack={vi.fn()}
        config={null}
        onOpenFiatCurrencies={vi.fn()}
        onOpenBuyProviders={vi.fn()}
        onOpenPasskeySettings={vi.fn()}
        onOpenSecurity={vi.fn()}
        onOpenBackup={vi.fn()}
        onDeleteAccount={onDeleteAccount}
      />
    </WalletProvider>
  );
  return { onDeleteAccount };
}

describe('SettingsPage account deletion', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('fires onDeleteAccount only after the confirm dialog is accepted', () => {
    const { onDeleteAccount } = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(onDeleteAccount).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
  });
});
