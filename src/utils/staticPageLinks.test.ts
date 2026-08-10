import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// App Store 5.1.1(i) (privacy policy reachable in-app) and 2.1 ("fully
// functional URLs") both fail on a link to a page we don't ship. Every
// glow-app.co/*.html the app links to must exist in public/.
describe('static page links', () => {
  const sources = readdirSync('src', { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'));

  const linked = new Set(
    sources.flatMap((f) =>
      [...readFileSync(`src/${f}`, 'utf8').matchAll(/https:\/\/glow-app\.co(\/[\w.-]+\.html)/g)]
        .map((m) => m[1]),
    ),
  );

  it('links at least the privacy policy and the support page', () => {
    expect([...linked]).toEqual(expect.arrayContaining(['/privacy.html', '/support.html']));
  });

  it.each([...linked])('ships public%s', (path) => {
    expect(existsSync(`public${path}`)).toBe(true);
  });
});
