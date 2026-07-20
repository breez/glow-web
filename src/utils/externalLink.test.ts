import { describe, expect, it, vi, afterEach } from 'vitest';
import { openExternalUrl } from './externalLink';

const mockStandalone = (matches: boolean) =>
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches } as MediaQueryList);

describe('openExternalUrl on web', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  });

  it('opens same-origin URLs in an in-app overlay when running as an installed PWA', async () => {
    mockStandalone(true);
    await openExternalUrl('/delete-account.html');

    const frame = document.querySelector<HTMLIFrameElement>('[role="dialog"] iframe');
    expect(frame?.src).toContain('/delete-account.html');

    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not overlay in a regular browser tab', async () => {
    mockStandalone(false);
    await openExternalUrl('/delete-account.html');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
