import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BottomSheetContainer, BottomSheetCard } from './BottomSheet';
import { useBackButton } from '../../../hooks/useBackButton';

// The real stack only listens on native; this one records push order.
const stack = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock('../../../utils/backButton', () => ({
  pushBackButtonHandler: (handler: () => unknown) => {
    stack.push(handler);
    return () => {
      const index = stack.lastIndexOf(handler);
      if (index >= 0) stack.splice(index, 1);
    };
  },
}));

describe('BottomSheetContainer back button', () => {
  it('stays under a handler registered after it when the sheet re-renders', () => {
    const stepBack = vi.fn();
    const onClose = vi.fn();
    const Page = ({ text }: { text: string }) => {
      useBackButton(stepBack, true);
      return (
        <BottomSheetContainer isOpen onClose={() => onClose()}>
          <BottomSheetCard>
            <span>{text}</span>
          </BottomSheetCard>
        </BottomSheetContainer>
      );
    };

    const { rerender } = render(<Page text="first" />);
    rerender(<Page text="second" />);
    void stack[stack.length - 1]();

    expect(stepBack).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
