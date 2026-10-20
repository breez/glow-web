import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../engine/api', async () => ({
  ...(await vi.importActual('../engine/api')),
  startUnilateralExitEngine: vi.fn(),
  stopUnilateralExitEngine: vi.fn(),
}));

import { startUnilateralExitEngine } from '../engine/api';
import { useUnilateralExitEngineLifecycle } from './useUnilateralExitEngineLifecycle';

describe('useUnilateralExitEngineLifecycle', () => {
  it("hands the engine the page's latest wallet read, without restarting it for a new one", async () => {
    const first = vi.fn(async () => true);
    const latest = vi.fn(async () => false);
    const { rerender } = renderHook(
      ({ refresh }) => useUnilateralExitEngineLifecycle('02abc', 'regtest', null, refresh),
      { initialProps: { refresh: first } },
    );
    rerender({ refresh: latest });

    expect(startUnilateralExitEngine).toHaveBeenCalledTimes(1);
    const reread = vi.mocked(startUnilateralExitEngine).mock.calls[0][3];
    await expect(reread?.()).resolves.toBe(false);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
