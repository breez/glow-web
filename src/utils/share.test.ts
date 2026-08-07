import { describe, expect, it, vi, afterEach } from 'vitest';
import { shareText } from './share';

const mockNavigatorShare = (impl: () => Promise<void>) =>
  vi.stubGlobal('navigator', { ...navigator, share: impl });

describe('shareText on web', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves when the user dismisses the sheet', async () => {
    const abort = new Error('dismissed');
    abort.name = 'AbortError';
    mockNavigatorShare(() => Promise.reject(abort));

    await expect(shareText('Transaction ID', 'abc')).resolves.toBeUndefined();
  });

  it('rejects on a real failure', async () => {
    mockNavigatorShare(() => Promise.reject(new Error('not allowed')));

    await expect(shareText('Transaction ID', 'abc')).rejects.toThrow('not allowed');
  });
});
