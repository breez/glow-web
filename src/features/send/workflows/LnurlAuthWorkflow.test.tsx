import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { LnurlAuthRequestDetails, LnurlCallbackStatus } from '@breeztech/breez-sdk-spark';
import LnurlAuthWorkflow from './LnurlAuthWorkflow';

const parsed: LnurlAuthRequestDetails = {
  k1: 'e2af6254a8df433264fa23f67eb8188635d15ce883e8fc020989d5f82ae6f11e',
  action: 'login',
  domain: 'stacker.news',
  url: 'https://stacker.news/api/lnauth?tag=login&k1=e2af',
};
const NETWORK_ERROR = 'Network error: Request error: error sending request : JsValue(TypeError: Failed to fetch';

const logIn = async (onAuth: () => Promise<LnurlCallbackStatus>, onClose = vi.fn()) => {
  render(<LnurlAuthWorkflow parsed={parsed} onBack={vi.fn()} onAuth={onAuth} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
};

afterEach(() => vi.unstubAllGlobals());

describe('LnurlAuthWorkflow', () => {
  it('declines by closing the sheet', () => {
    const onClose = vi.fn();
    const onAuth = vi.fn();
    render(<LnurlAuthWorkflow parsed={parsed} onBack={vi.fn()} onAuth={onAuth} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onAuth).not.toHaveBeenCalled();
  });

  it('names the site on success', async () => {
    await logIn(async () => ({ type: 'ok' }));
    expect(await screen.findByText("stacker.news confirmed it's you.")).toBeInTheDocument();
  });

  it("keeps the site's reason and asks for a fresh code when it refuses", async () => {
    await logIn(async () => ({ type: 'errorStatus', errorDetails: { reason: 'k1 expired.' } }));
    expect(await screen.findByText(
      'Could not log in to stacker.news: k1 expired. Refresh the site for a new code and try again.',
    )).toBeInTheDocument();
  });

  it('keeps SDK internals off screen', async () => {
    await logIn(() => Promise.reject(new Error('Lnurl error: error calling lnurl endpoint: Json error: expected value')));
    expect(await screen.findByText(
      'Could not log in to stacker.news. Refresh the site for a new code and try again.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/Json error/)).not.toBeInTheDocument();
  });

  it("doesn't call the login failed when the site answers but hides its reply", async () => {
    const probe = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', probe);
    const onClose = vi.fn();
    const onAuth = vi.fn().mockRejectedValue(new Error(NETWORK_ERROR));
    await logIn(onAuth, onClose);
    expect(await screen.findByText(
      "Could not read the reply from stacker.news. Check the site if you've logged in.",
    )).toBeInTheDocument();
    expect(probe).toHaveBeenCalledWith('https://stacker.news', expect.objectContaining({ mode: 'no-cors' }));

    expect(screen.getByText(/The site is missing a CORS header that Glow needs/)).toHaveTextContent('The site is missing a CORS header that Glow needs (LUD-01).');
    expect(screen.getByRole('link', { name: 'LUD-01' })).toHaveAttribute('href', 'https://github.com/lnurl/luds/blob/luds/01.md');

    // A retry would reuse a code the site may have spent, so the sheet only closes.
    expect(screen.queryByRole('button', { name: 'Log In' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
    expect(onAuth).toHaveBeenCalledTimes(1);
  });

  it('says the site is unreachable when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await logIn(() => Promise.reject(new Error(NETWORK_ERROR)));
    expect(await screen.findByText(
      'Could not reach stacker.news. Check your connection and try again.',
    )).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'LUD-01' })).not.toBeInTheDocument();
  });

  it('skips the probe when isolation would block it, and trusts being online', async () => {
    const probe = vi.fn();
    vi.stubGlobal('fetch', probe);
    vi.stubGlobal('crossOriginIsolated', true);
    await logIn(() => Promise.reject(new Error(NETWORK_ERROR)));
    expect(await screen.findByText(
      "Could not read the reply from stacker.news. Check the site if you've logged in.",
    )).toBeInTheDocument();
    expect(probe).not.toHaveBeenCalled();
  });
});
