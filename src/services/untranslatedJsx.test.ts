import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * The line-based scan in untranslatedStrings.test.ts misses a word that sits
 * alone on its line ("Continue"), text before an {expression} ("fee {x}"), and
 * attribute values. This one reads the syntax tree, so any JSX text with
 * letters in it, and the attributes a reader sees, must go through t().
 */
const SRC = join(__dirname, '..');

const SKIPPED = [
  'pages/PasskeySettingsPage', 'pages/PasskeyManagementPage', 'pages/PasskeyLocalStatePage', 'pages/LabelsPage',
  'features/unilateral-exit', 'pages/UnilateralExitPage', 'test/', 'components/Icons', 'locales/',
];
const ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'description', 'subtitle', 'helperText']);

/** Product names, tickers and the developer-only corner of Settings. */
const ALLOWED = new Set([
  'Glow', 'MoonPay', 'LNURL', 'BTC', 'USD', 'satoshi', 'example.com',
  'Unknown screen', '(dev)', 'more taps to', 'dev mode',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) return walk(f);
    return /\.tsx$/.test(f) && !/\.(test|spec)\./.test(f) ? [f] : [];
  });
}

describe('JSX text and attributes go through i18n', () => {
  it('finds no copy written in place', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (SKIPPED.some((s) => rel.startsWith(s))) continue;
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const visit = (n: ts.Node) => {
        if (ts.isJsxText(n)) {
          const text = n.getText().replace(/\s+/g, ' ').trim();
          if (/[A-Za-z]{2}/.test(text) && !ALLOWED.has(text) && !/^&\w+;$/.test(text)) offenders.push(`${rel}:${at(n)}  ${JSON.stringify(text)}`);
        } else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ATTRS.has(n.name.getText())) {
          const text = n.initializer.text;
          if (/[A-Za-z]{3}/.test(text) && !ALLOWED.has(text) && !/^(https?:|\/)/.test(text)) offenders.push(`${rel}:${at(n)}  ${n.name.getText()}=${JSON.stringify(text)}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(offenders, `Put these behind a translation key, or add product names to ALLOWED.\n${offenders.join('\n')}\n`).toEqual([]);
  });
});
