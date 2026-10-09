import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * An unbounded `indexedDB.open` writes no session record, so the launch
 * that hung leaves no log. Both cases below must settle, not sit.
 */

/** An open request that never fires any of its events. */
const silentOpen = () => ({
  onerror: null,
  onsuccess: null,
  onblocked: null,
  onupgradeneeded: null,
});

async function loadFreshModule() {
  vi.resetModules();
  return import('./logStorage');
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('openDatabase', () => {
  it('rejects when the open request never fires an event', async () => {
    vi.stubGlobal('indexedDB', { open: silentOpen });
    vi.useFakeTimers();

    const { startSession } = await loadFreshModule();
    // Attach before advancing, or the rejection surfaces as unhandled.
    const assertion = expect(startSession()).rejects.toThrow(/timed out/);
    // Zero first, so the chain into openDatabase registers the timer.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    await assertion;
  });

  it('rejects when another connection blocks the open', async () => {
    // Fire from the setter: openDatabase wires its handlers a microtask
    // after startSession, so calling onblocked directly would race it.
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = silentOpen();
        Object.defineProperty(request, 'onblocked', {
          get: () => null,
          set: (handler: (() => void) | null) => {
            if (handler) queueMicrotask(handler);
          },
        });
        return request;
      },
    });

    const { startSession } = await loadFreshModule();

    await expect(startSession()).rejects.toThrow(/blocked/);
  });
});
