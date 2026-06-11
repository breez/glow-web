import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  vi.useRealTimers();
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

/** Dispatch a viewport geometry change like a keyboard show/hide. */
const setViewport = (height: number, event: 'resize' | 'scroll' = 'resize') => {
  act(() => {
    vv.height = height;
    vv.dispatchEvent(new Event(event));
  });
};

describe('BottomSheetContainer visual viewport tracking', () => {
  it('sizes the wrapper to the visual viewport height', () => {
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.height).toBe('900px');
  });

  it('shrinks the wrapper when the keyboard opens (#219)', () => {
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    setViewport(600);

    expect(wrapper.style.height).toBe('600px');
  });

  it('applies height changes that arrive via scroll events', () => {
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    setViewport(620, 'scroll');

    expect(wrapper.style.height).toBe('620px');
  });

  it('drops a transient grow when the keyboard re-claims space (focus switch)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    // Keyboard opens on the first field.
    setViewport(600);

    // Focus moves to the next field: the browser reports a transient
    // keyboard hide. The grow must not apply yet.
    setViewport(900);
    expect(wrapper.style.height).toBe('600px');

    // Keyboard re-shows (slightly different layout) before the hold
    // expires: tracked immediately, held grow cancelled.
    setViewport(580);
    expect(wrapper.style.height).toBe('580px');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(wrapper.style.height).toBe('580px');
  });

  it('applies a real keyboard hide once the grow hold expires', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    setViewport(600);
    setViewport(900);
    expect(wrapper.style.height).toBe('600px');

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(wrapper.style.height).toBe('900px');
  });

  it('applies small grows (keyboard layout swaps) without the hold', () => {
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    // Text keyboard up, then a swap to a slightly shorter layout.
    setViewport(600);
    setViewport(650);

    expect(wrapper.style.height).toBe('650px');
  });

  it('pre-lifts on input focus before the keyboard opens, reverts if none arrives', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container, getByLabelText } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    // Seed the keyboard delta cache with one real keyboard cycle.
    setViewport(600);
    setViewport(900);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(wrapper.style.height).toBe('900px');

    // Focusing a sheet input from a non-input applies the cached
    // shrink before any viewport event arrives, so the browser never
    // needs to pan the page to reveal the caret.
    act(() => {
      getByLabelText('amount').dispatchEvent(
        new FocusEvent('focusin', { bubbles: true }),
      );
    });
    expect(wrapper.style.height).toBe('600px');

    // No keyboard-sized shrink confirmed the pre-lift: revert.
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(wrapper.style.height).toBe('900px');
  });
});
