import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { BottomSheetContainer, BottomSheetCard } from './BottomSheet';

// Minimal stand-in for window.visualViewport: just enough surface for
// the sheet's resize/scroll subscription and rect reads.
class FakeVisualViewport extends EventTarget {
  height = 900;
  pageTop = 0;
}

let vv: FakeVisualViewport;

beforeEach(() => {
  vv = new FakeVisualViewport();
  Object.defineProperty(window, 'visualViewport', {
    value: vv,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', {
    value: undefined,
    configurable: true,
  });
});

const renderSheet = () =>
  render(
    <BottomSheetContainer isOpen onClose={() => {}}>
      <BottomSheetCard>
        <input aria-label="amount" />
      </BottomSheetCard>
    </BottomSheetContainer>,
  );

describe('BottomSheetContainer visual viewport tracking', () => {
  it('sizes and anchors the wrapper to the visual viewport rect', () => {
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.top).toBe('0px');
    expect(wrapper.style.height).toBe('900px');
  });

  it('follows the visual viewport pan when the keyboard opens (#219)', () => {
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    // Keyboard opens: the viewport shrinks and the browser pans down
    // to reveal a focused input near the bottom of the screen.
    act(() => {
      vv.height = 600;
      vv.pageTop = 300;
      vv.dispatchEvent(new Event('resize'));
    });

    expect(wrapper.style.top).toBe('300px');
    expect(wrapper.style.height).toBe('600px');
  });

  it('re-anchors on visual viewport scroll without a resize', () => {
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    act(() => {
      vv.pageTop = 120;
      vv.dispatchEvent(new Event('scroll'));
    });

    expect(wrapper.style.top).toBe('120px');
  });
});
