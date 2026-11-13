import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import roster from '../locales/languages.json';
import { LOCALES, isRtl, pickLanguage } from './i18n';

const SRC = join(__dirname, '..');

/**
 * Physical direction, where the logical equivalent is what the layout wants.
 * Each pair is left to right in English and right to left in Arabic, so a
 * physical one pins a control to the wrong edge for half the roster.
 */
const PHYSICAL: { pattern: RegExp; use: string }[] = [
  { pattern: /(?<![\w-])text-left(?![\w-])/, use: 'text-start' },
  { pattern: /(?<![\w-])text-right(?![\w-])/, use: 'text-end' },
  { pattern: /(?<![\w-])-?ml-[0-9.]/, use: 'ms-' },
  { pattern: /(?<![\w-])-?mr-[0-9.]/, use: 'me-' },
  { pattern: /(?<![\w-])-?pl-[0-9.]/, use: 'ps-' },
  { pattern: /(?<![\w-])-?pr-[0-9.]/, use: 'pe-' },
];

/**
 * Where a physical direction is the point. The QR frame's four corners are a
 * symmetric set, a centring idiom reads as `left-1/2 -translate-x-1/2`
 * whichever way the text runs, and a decorative blur is placed by eye.
 */
const PHYSICAL_IS_DELIBERATE = [
  'components/ui/QRCodeContainer.tsx',
  'components/QrScannerDialog.tsx',
  'components/InstallPrompt.tsx',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\./.test(entry) ? [full] : [];
  });
}

describe('right-to-left layout', () => {
  it('marks the right-to-left languages and nothing else', () => {
    const marked = roster.languages.filter((l) => l.rtl === true).map((l) => l.tag);
    expect(marked).toEqual(['ar', 'he']);
    expect(marked.every(isRtl)).toBe(true);
    expect(isRtl('en')).toBe(false);
    // An unknown tag must not read as right to left, or a stale stored choice
    // would mirror the whole app.
    expect(isRtl('xx')).toBe(false);
  });

  it('gives every rostered language a home in LOCALES', () => {
    for (const { tag, endonym } of roster.languages) {
      expect(LOCALES[tag], `${tag} missing from LOCALES`).toBeDefined();
      expect(LOCALES[tag]!.name).toBe(endonym);
    }
  });

  it('prefers an exact regional tag over the base subtag', () => {
    const shipping = ['en', 'pt', 'pt-BR', 'zh-Hans'];
    expect(pickLanguage(null, 'pt-BR', shipping)).toBe('pt-BR');
    expect(pickLanguage(null, 'pt-PT', shipping)).toBe('pt');
    expect(pickLanguage(null, 'pt', shipping)).toBe('pt');
    // A platform may report the script subtag in lower case.
    expect(pickLanguage(null, 'zh-hans', shipping)).toBe('zh-Hans');
    // 'zh' alone is in no roster, so there is no base to fall back to.
    expect(pickLanguage(null, 'zh-Hant', shipping)).toBe('en');
  });

  it('keeps an explicit stored regional choice', () => {
    expect(pickLanguage('pt-BR', 'en-US', ['en', 'pt', 'pt-BR'])).toBe('pt-BR');
  });

  it('uses logical direction utilities, so the layout follows the language', () => {
    const offenders = walk(SRC)
      .filter((file) => {
        const rel = relative(SRC, file);
        return !PHYSICAL_IS_DELIBERATE.some((skip) => rel.startsWith(skip));
      })
      .flatMap((file) => {
        const lines = readFileSync(file, 'utf-8').split('\n');
        return lines.flatMap((line, index) =>
          PHYSICAL.filter(({ pattern }) => pattern.test(line)).map(
            ({ use }) => `${relative(SRC, file)}:${index + 1}  use ${use}`,
          ),
        );
      });

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `These pin to a physical edge, so Arabic and Hebrew get them on the ` +
          `wrong side. Use the logical utility instead.\n\n${offenders.join('\n')}\n`,
    ).toEqual([]);
  });
});
