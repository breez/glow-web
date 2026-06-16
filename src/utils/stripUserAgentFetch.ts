const USER_AGENT = 'user-agent';

/**
 * Strip the SDK's custom User-Agent from outgoing fetch requests.
 *
 * The Breez Spark SDK's shared reqwest client sets a
 * "breez-sdk-spark/<version>" User-Agent. User-Agent is a forbidden fetch
 * header the browser owns: Chromium drops the author value, but Firefox
 * forwards it (failing CORS preflights on strict hosts such as Flashnet)
 * and WebKit/iOS forwards it (blockstream's onchain-claim preflight 404s).
 * Removing it before the request leaves the WebView keeps every
 * cross-origin request CORS-simple on all engines, so the SDK's chain and
 * operator calls work over plain fetch with no native HTTP routing
 * (CapacitorHttp) needed.
 *
 * Call once, before the SDK issues any request.
 */
export function installUserAgentStrippingFetch(): void {
  const originalFetch = window.fetch.bind(window);

  // Standalone Headers carry the unguarded "none" header guard, so they
  // can both read a forwarded user-agent and be rebuilt without one. A
  // request-guarded Headers would hide or keep it depending on the engine.
  const withoutUserAgent = (
    base: Headers | undefined,
    overrides: HeadersInit | undefined,
  ): Headers | null => {
    const merged = new Headers(base ?? undefined);
    if (overrides) {
      new Headers(overrides).forEach((value, key) => merged.set(key, value));
    }
    if (!merged.has(USER_AGENT)) return null;
    const clean = new Headers();
    merged.forEach((value, key) => {
      if (key.toLowerCase() !== USER_AGENT) clean.set(key, value);
    });
    return clean;
  };

  window.fetch = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const base = input instanceof Request ? input.headers : undefined;
    const clean = withoutUserAgent(base, init?.headers);
    if (!clean) return originalFetch(input, init);
    // Reconstruct with cleaned headers. For a bare Request (the reqwest
    // path) this preserves method / url / body and only swaps headers.
    if (input instanceof Request && !init) {
      return originalFetch(new Request(input, { headers: clean }));
    }
    return originalFetch(input, { ...init, headers: clean });
  };
}
