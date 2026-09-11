import { expect } from 'vitest';
import { waitFor } from '@testing-library/react';

/**
 * react-modal-sheet keeps the sheet hidden, and out of role queries, until an
 * uncancelled 50ms poll finds its container. A test that removes the sheet
 * before that leaves the poll running past happy-dom teardown, where it
 * throws on the missing document. Await this while the sheet is still open.
 */
export function waitForSheetOpen() {
  return waitFor(() =>
    expect(document.querySelector('.react-modal-sheet-root')).toBeVisible(),
  );
}
