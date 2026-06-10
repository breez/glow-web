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
const setViewport = (height: number, pageTop: number, event: 'resize' | 'scroll' = 'resize') => {
  act(() => {
    vv.height = height;
    vv.pageTop = pageTop;
    vv.dispatchEvent(new Event(event));
  });
};

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
    setViewport(600, 300);

    expect(wrapper.style.top).toBe('300px');
    expect(wrapper.style.height).toBe('600px');
  });

  it('re-anchors on visual viewport scroll without a resize', () => {
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    setViewport(900, 120, 'scroll');

    expect(wrapper.style.top).toBe('120px');
  });

  it('drops a transient grow when the keyboard re-claims space (focus switch)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    // Keyboard opens on the first field.
    setViewport(600, 300);

    // Focus moves to the next field: the browser reports a transient
    // keyboard hide. The grow must not apply yet.
    setViewport(900, 0);
    expect(wrapper.style.height).toBe('600px');
    expect(wrapper.style.top).toBe('300px');

    // Keyboard re-shows (slightly different layout) before the hold
    // expires: tracked immediately, held grow cancelled.
    setViewport(580, 320);
    expect(wrapper.style.height).toBe('580px');
    expect(wrapper.style.top).toBe('320px');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(wrapper.style.height).toBe('580px');
    expect(wrapper.style.top).toBe('320px');
  });

  it('applies a real keyboard hide once the grow hold expires', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = renderSheet();
    const wrapper = container.firstElementChild as HTMLElement;

    setViewport(600, 300);
    setViewport(900, 0);
    expect(wrapper.style.height).toBe('600px');

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(wrapper.style.height).toBe('900px');
    expect(wrapper.style.top).toBe('0px');
  });
});
