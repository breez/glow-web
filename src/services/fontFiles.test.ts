import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// An unresolved font url builds with only a warning, then 404s on the device and the text falls back to a system font.
describe('index.css font files', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
  const files = [...css.matchAll(/url\('(@fontsource[^']+)'\)/g)].map((m) => m[1]!);

  it('references at least one font', () => expect(files.length).toBeGreaterThan(0));

  it.each(files)('ships %s', (file) => {
    expect(existsSync(resolve(__dirname, '../../node_modules', file))).toBe(true);
  });
});
