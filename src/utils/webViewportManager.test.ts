import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pollWebViewport } from './webViewportManager';

class FakeVisualViewport extends EventTarget {
  height = 0;
  pageTop = 0;
}

let vv: FakeVisualViewport;
let root: HTMLDivElement;
let layoutHeight: number;

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
  pollWebViewport();
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
    pollWebViewport();
    expect(html.classList.contains('keyboard-visible')).toBe(false);
    expect(html.style.getPropertyValue('--keyboard-height')).toBe('0px');
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
