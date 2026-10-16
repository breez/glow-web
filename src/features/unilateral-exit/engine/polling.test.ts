import { pollIntervalMs } from './polling';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('pollIntervalMs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('polls fast on regtest, where blocks come from a keyboard', () => {
    expect(pollIntervalMs('regtest')).toBe(5_000);
  });

  it('leaves a live chain on the slow default', () => {
    expect(pollIntervalMs('mainnet')).toBe(30_000);
  });

  it('lets the environment override any network', () => {
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', '2');
    expect(pollIntervalMs('mainnet')).toBe(2_000);
  });

  it('ignores an override that is not a positive number', () => {
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', 'soon');
    expect(pollIntervalMs('regtest')).toBe(5_000);
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', '0');
    expect(pollIntervalMs('regtest')).toBe(5_000);
  });
});
