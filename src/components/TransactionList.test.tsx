import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { UnilateralExitEntry } from '../features/unilateral-exit/listEntries';

// Only the exit rows render here, which read none of these.
vi.mock('../contexts/StableBalanceContext', () => ({ useStableBalance: () => ({}) }));
vi.mock('../contexts/FiatDataContext', () => ({ useFiatData: () => ({ fiatCurrencies: [] }) }));
vi.mock('../contexts/ContactsContext', () => ({ useContactsContext: () => ({ findContactByAddress: () => undefined }) }));

import TransactionList from './TransactionList';

const recoverable = (over: Partial<UnilateralExitEntry>): UnilateralExitEntry => ({
  id: 'recoverable',
  title: 'Recoverable Funds',
  subtitle: null,
  amountSat: 30_000,
  kind: 'recoverable',
  ...over,
});

const renderRow = (entry: UnilateralExitEntry, onExitSelected = vi.fn()) => {
  render(<TransactionList transactions={[]} onPaymentSelected={vi.fn()} exitEntries={[entry]} onExitSelected={onExitSelected} />);
  return { row: screen.getByTestId('recoverable-funds-entry'), onExitSelected };
};

describe('the Recoverable Funds row', () => {
  it('takes no tap beside an exit under way', () => {
    const { row, onExitSelected } = renderRow(recoverable({ inert: true }));
    fireEvent.click(row);
    expect(onExitSelected).not.toHaveBeenCalled();
    expect(row).not.toHaveClass('cursor-pointer');
  });

  it('opens on a tap while no exit runs', () => {
    const entry = recoverable({ subtitle: 'Tap to recover', isAction: true, inert: false });
    const { row, onExitSelected } = renderRow(entry);
    fireEvent.click(row);
    expect(onExitSelected).toHaveBeenCalledWith(entry);
    expect(row).toHaveClass('cursor-pointer');
  });
});
