import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The deployed policy lives in two places: the response header in vercel.json
// and the <meta http-equiv> fallback in index.html. A meta tag cannot express
// frame-ancestors or upgrade-insecure-requests, so the header has to be the
// enforced one and has to stay a superset of the meta tag.
function parsePolicy(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...value] = directive.split(/\s+/);
        return [name, value.join(' ')];
      })
  );
}

const vercelHeaders = JSON.parse(readFileSync('vercel.json', 'utf8')).headers[0].headers as {
  key: string;
  value: string;
}[];
const metaPolicy = readFileSync('index.html', 'utf8').match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
)?.[1];

describe('content security policy', () => {
  it('is enforced, not report-only', () => {
    expect(vercelHeaders.some((h) => h.key.toLowerCase() === 'content-security-policy')).toBe(true);
    expect(vercelHeaders.some((h) => /report-only/i.test(h.key))).toBe(false);
  });

  it('keeps the header a superset of the meta fallback', () => {
    const header = parsePolicy(
      vercelHeaders.find((h) => h.key.toLowerCase() === 'content-security-policy')!.value
    );
    expect(metaPolicy).toBeDefined();
    const meta = parsePolicy(metaPolicy!);
    for (const [name, value] of Object.entries(meta)) {
      expect(header[name], `header is missing or loosens ${name}`).toBe(value);
    }
  });

  it('carries the directives the meta tag cannot express', () => {
    const header = parsePolicy(
      vercelHeaders.find((h) => h.key.toLowerCase() === 'content-security-policy')!.value
    );
    expect(header['frame-ancestors']).toBe("'none'");
    expect(header).toHaveProperty('upgrade-insecure-requests');
  });
});
