import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomSheetContainer, BottomSheetCard } from './BottomSheet';

// Behavior tests for gestures/keyboard live upstream in
// react-modal-sheet; these cover the adapter wiring only.
describe('BottomSheetContainer (react-modal-sheet adapter)', () => {
  it('renders sheet content when open', async () => {
    render(
      <BottomSheetContainer isOpen onClose={() => {}}>
        <BottomSheetCard>
          <span>sheet body</span>
        </BottomSheetCard>
      </BottomSheetContainer>,
    );
    expect(await screen.findByText('sheet body')).toBeInTheDocument();
  });

  it('renders no content while closed', () => {
    render(
      <BottomSheetContainer isOpen={false} onClose={() => {}}>
        <BottomSheetCard>
          <span>hidden body</span>
        </BottomSheetCard>
      </BottomSheetContainer>,
    );
    expect(screen.queryByText('hidden body')).toBeNull();
  });
});
