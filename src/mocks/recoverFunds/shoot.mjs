// THROWAWAY: screenshots every ?recovermock shot (or the ids given) into OUT.
// Usage: node src/mocks/recoverFunds/shoot.mjs [id ...]   (dev server on BASE)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const OUT = process.env.OUT ?? join(tmpdir(), 'glow-recover-mock');
const ALL = [
  '01-wallet-row', '02-destination', '03-fee-cosigned', '04-review-cosigned', '05-sent',
  '06-wallet-after-cosigned', '07-review-stranded', '08-pending-owed', '08b-pending-owed-advanced',
  '09-pending-funded', '10-tracker-stranded', '11-archived-dialog', '12-review-mixed',
  '13-wallet-after-split', '14-review-error', '15-fee-nothing-worth', '17-tracker-bump',
  '18-bump-fee', '19-bump-review', '20a-dev-exit-quote-today', '20b-dev-exit-quote-proposed',
  'ux-01-intro', 'ux-02-destination', 'ux-03-fee', 'ux-04-quote', 'ux-05-pending-owed', 'ux-06-pending-funded',
  'ux-07-tracker', 'ux-08-wallet-exit-running', 'ux-09-wallet-after-exit-recoverable',
  'ux-09a-recover-destination', 'ux-09b-recover-fee', 'ux-09c-recover-review', 'ux-09d-recover-sent',
  'ux-09e-wallet-after-recover', 'ux-10-archived-dialog',
  'ux-11-intro-with-recoverable', 'ux-11-quote-with-recoverable', 'ux-11a-pending-with-recoverable', 'ux-11b-tracker-with-recoverable', 'ux-11d-wallet-running', 'ux-11e-wallet-landed',
  'ux-11c-archived-with-recoverable',
  'ux-13a-tracker-after-update', 'ux-13b-update-needed', 'ux-13b2-wallet-update-needed', 'ux-13c-wallet-landed',
  'ux-13d-archived-details',
];
const ids = process.argv.length > 2 ? process.argv.slice(2) : ALL;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const id of ids) {
  // A context per shot: the exit engine seeds localStorage, which must not leak.
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${BASE}/?recovermock=${id}`);
  try {
    await page.waitForFunction(() => window.__recoverMockReady === true, null, { timeout: 20_000 });
  } catch {
    errors.push('timeout waiting for __recoverMockReady');
  }
  // Sheets animate in; let them settle.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${id}.png` });
  console.log(`${id}: ${errors.length ? errors.join(' | ') : 'ok'}`);
  await context.close();
}
await browser.close();
