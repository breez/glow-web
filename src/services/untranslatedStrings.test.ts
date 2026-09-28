import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Fails when a user-facing string is written in place rather than put behind a
 * translation key. The allowlist below is the whole escape hatch: adding to it
 * is a line in the diff a reviewer sees, rather than a silent regression.
 */

const SRC = join(__dirname, '..');

/** Documented in locales/README.md as deliberately untranslated. */
const SKIPPED_PATHS = [
  'features/unilateral-exit/',
  'pages/UnilateralExitPage.tsx',
  'pages/PasskeySettingsPage.tsx',
  'pages/PasskeyManagementPage.tsx',
  'pages/PasskeyLocalStatePage.tsx',
  'pages/LabelsPage.tsx',
  'test/',
  'components/Icons.tsx',   // svg path data
  'services/logger.ts',     // log lines stay English
];

/**
 * Strings that read like copy but are not. Product and protocol names, address
 * format hints, and the developer-only corners of otherwise translated pages.
 * Before adding a line here, check the string really is one of those.
 */
const ALLOWED = new Set([
  'Glow',            // product name, used as alt text on the logo
  'LNURL',
  'LNURL-Pay',
  'Deposit',         // share-sheet label beside an address, not a sentence
  'satoshi',         // unit, shown as an example username
  'bc1q...',         // address format hint
  'example.com',     // developer-only network field placeholder
  'Unknown screen',  // router fallback that only a developer can reach
  // Settings' entry to unilateral exit, behind the five-tap gesture.
  'Unilateral Exit',
  'Start Unilateral Exit',
  // Product, company and network names.
  'Cash App',
  'BNB Smart Chain',
  'Download on the App Store',  // alt text of an English store badge
  'Get it on Google Play',
  // Errors thrown for developers. Each is mapped to a translated message at
  // the call site that shows it. See locales/README.md.
  'Failed to retrieve seed.',
  'Failed to clear stored seed.',
  'Failed to persist seed.',
  'Stored seed blob is not valid JSON.',
  'Stored seed blob has an unexpected shape.',
  'Secure seed storage is only available on native platforms.',
  'Device authentication failed',
  'Biometric authentication failed',
  'Unexpected entropy seed from passkey path',
  'Passkey plugin not available',
  'No primary new SDK to switch to',
  'Database does not exist',             // written into an exported log file
  'Failed to silently reconnect from device-only storage',
  'Unknown error',                       // fallback before an error is matched
  // Font families and biometric product names.
  'Plus Jakarta Sans',
  'JetBrains Mono',
  'Face ID',
  'Touch ID',
]);

const ATTRS =
  'placeholder|title|aria-label|alt|label|confirmText|cancelText|shareLabel|heading';
/** Calls whose string argument is put on screen as-is. */
const CALLS =
  'setError|setInfo|showToast|showToastRef\\.current|setDestinationError|setInstantError|toast';
const SEVERITIES = new Set(['success', 'error', 'info', 'warning']);
/** Quoted strings, one regex per quote style so a match cannot run past its
 *  own closing quote and swallow the rest of the line. */
const SINGLE_QUOTED = /'([^'\n]{4,200})'/g;
const DOUBLE_QUOTED = /"([^"\n]{4,200})"/g;
/** Two or more capitalised words with sentence punctuation and nothing else.
 *  Class names, CSS, paths and identifiers all fail it, so what is left reads
 *  as copy wherever it sits, including inside a {ternary}. */
const READS_AS_PROSE = /^[A-Z][A-Za-z0-9]*(?:[ ][A-Za-z0-9'’(),:!?-]+){1,25}[.!?]?$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(entry) || /\.(test|spec)\./.test(entry)) return [];
    return [full];
  });
}

function findLiterals(source: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  let inBlockComment = false;
  source.split('\n').forEach((raw, index) => {
    const trimmed = raw.trim();
    if (inBlockComment) {
      if (raw.includes('*/')) inBlockComment = false;
      return;
    }
    if (/^(\{?\/\*)/.test(trimmed) && !raw.includes('*/')) { inBlockComment = true; return; }
    if (/^(\/\/|\*|\{?\/\*)/.test(trimmed)) return;
    // Logs stay English: they are read by whoever is debugging, not the reporter.
    if (raw.includes('logger.') || raw.includes('console.')) return;
    // Matching an SDK message is not copy, and translating it breaks the match.
    if (raw.includes('.includes(') || raw.includes('.startsWith(')) return;
    if (/^import /.test(trimmed) || /from '/.test(raw)) return;

    const push = (text: string) => found.push({ line: index + 1, text: text.trim() });

    for (const m of raw.matchAll(new RegExp(`\\b(?:${ATTRS})=(?:"([^"]{2,})"|'([^']{2,})')`, 'g'))) {
      const value = (m[1] ?? m[2]).trim();
      if (/[A-Za-z]{2}/.test(value) && !/^(https?:|data:|\/)/.test(value)) push(value);
    }
    // A JSX text node ends at a closing tag. Requiring one keeps generics
    // such as Promise<void> from reading as copy.
    for (const m of raw.matchAll(/>\s*([A-Z][A-Za-z0-9 ,.'’!?()-]{2,120}?)\s*<\//g)) push(m[1]);
    for (const m of raw.matchAll(
      new RegExp(`\\b(?:${CALLS})\\(\\s*(?:['"][a-z]+['"]\\s*,\\s*)?['"]([^'"]{4,})['"]`, 'g'),
    )) {
      if (!SEVERITIES.has(m[1].trim())) push(m[1]);
    }
    for (const re of [SINGLE_QUOTED, DOUBLE_QUOTED]) {
      for (const m of raw.matchAll(re)) {
        const value = m[1].trim();
        if (!READS_AS_PROSE.test(value)) continue;
        if (/^[Mm]\s?[-\d]/.test(value)) continue;   // svg path data
        push(value);
      }
    }
  });
  return found;
}

describe('user-facing strings go through i18n', () => {
  it('finds no copy written in place', () => {
    const offenders = walk(SRC)
      .filter((file) => {
        const rel = relative(SRC, file);
        return !SKIPPED_PATHS.some((skip) => rel.startsWith(skip));
      })
      .flatMap((file) =>
        findLiterals(readFileSync(file, 'utf-8'))
          .filter(({ text }) => !ALLOWED.has(text))
          .map(({ line, text }) => `${relative(SRC, file)}:${line}  ${JSON.stringify(text)}`),
      );

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Put these behind a translation key, or add them to ALLOWED in this file ` +
          `if they are product names or format hints rather than copy. ` +
          `See src/locales/README.md.\n\n${offenders.join('\n')}\n`,
    ).toEqual([]);
  });
});
