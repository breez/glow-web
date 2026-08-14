import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOutOfSync } from './useOutOfSync';

const GRACE = 1000;

describe('useOutOfSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('trusts the balance while the first sync is still in flight', () => {
    const { result } = renderHook(() => useOutOfSync(true, false, GRACE));
    expect(result.current).toBe(false);

    act(() => { vi.advanceTimersByTime(GRACE - 1); });
    expect(result.current).toBe(false);
  });

  it('warns once a connected session has gone the whole window unsynced', () => {
    const { result } = renderHook(() => useOutOfSync(true, false, GRACE));

    act(() => { vi.advanceTimersByTime(GRACE); });
    expect(result.current).toBe(true);
  });

  it('clears as soon as a sync lands', () => {
    const { result, rerender } = renderHook(
      ({ synced }) => useOutOfSync(true, synced, GRACE),
      { initialProps: { synced: false } },
    );

    act(() => { vi.advanceTimersByTime(GRACE); });
    expect(result.current).toBe(true);

    rerender({ synced: true });
    expect(result.current).toBe(false);
  });

  it('stays quiet before connecting, and re-arms after connecting', () => {
    const { result, rerender } = renderHook(
      ({ connected }) => useOutOfSync(connected, false, GRACE),
      { initialProps: { connected: false } },
    );

    act(() => { vi.advanceTimersByTime(GRACE * 5); });
    expect(result.current).toBe(false);

    rerender({ connected: true });
    expect(result.current).toBe(false);

    act(() => { vi.advanceTimersByTime(GRACE); });
    expect(result.current).toBe(true);
  });
});
