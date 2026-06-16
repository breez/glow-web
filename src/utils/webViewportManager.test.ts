import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pollWebViewport } from './webViewportManager';

class FakeVisualViewport extends EventTarget {
  height = 0;
  pageTop = 0;
}

let vv: FakeVisualViewport;
let root: HTMLDivElement;
let layoutHeight: number;

/** Polls past the keyboard-off hysteresis (~18 frames). */
const pollUntilSettled = () => {
  for (let i = 0; i < 25; i++) pollWebViewport();
};

beforeEach(() => {
  layoutHeight = document.documentElement.clientHeight;
  vv = new FakeVisualViewport();
  vv.height = layoutHeight;
  Object.defineProperty(window, 'visualViewport', {
    value: vv,
    configurable: true,
  });
  root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
});

afterEach(() => {
  // Drain module state back to baseline so tests stay independent.
  vv.height = layoutHeight;
  vv.pageTop = 0;
  pollUntilSettled();
  root.remove();
  Object.defineProperty(window, 'visualViewport', {
    value: undefined,
    configurable: true,
  });
});

describe('pollWebViewport', () => {
  it('counter-translates #root by the visual viewport pan', () => {
    vv.pageTop = 280;
    pollWebViewport();
    expect(root.style.transform).toBe('translateY(280px)');

    vv.pageTop = 0;
    pollWebViewport();
    expect(root.style.transform).toBe('');
  });

  it('mirrors the native keyboard signals on <html>', () => {
    const html = document.documentElement;

    vv.height = layoutHeight - 320;
    pollWebViewport();
    expect(html.classList.contains('keyboard-visible')).toBe(true);
    expect(html.style.getPropertyValue('--keyboard-height')).toBe('320px');

    vv.height = layoutHeight;
    pollUntilSettled();
    expect(html.classList.contains('keyboard-visible')).toBe(false);
    expect(html.style.getPropertyValue('--keyboard-height')).toBe('0px');
  });

  it('holds the keyboard-visible class through a transient hide', () => {
    const html = document.documentElement;

    vv.height = layoutHeight - 320;
    pollWebViewport();
    expect(html.classList.contains('keyboard-visible')).toBe(true);

    // Focus switch: the browser reports a momentary full-height
    // viewport. A few frames must not drop the class.
    vv.height = layoutHeight;
    pollWebViewport();
    pollWebViewport();
    expect(html.classList.contains('keyboard-visible')).toBe(true);

    // Keyboard re-shows with a different layout: class stays on and
    // the published height updates.
    vv.height = layoutHeight - 280;
    pollWebViewport();
    expect(html.classList.contains('keyboard-visible')).toBe(true);
    expect(html.style.getPropertyValue('--keyboard-height')).toBe('280px');
  });

  it('reports activity while an editable element is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(pollWebViewport()).toBe(true);

    input.blur();
    expect(pollWebViewport()).toBe(false);
    input.remove();
  });
});
