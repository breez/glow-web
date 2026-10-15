// THROWAWAY: screenshots every ?recovermock shot (or the ids given) into OUT.
// Usage: node src/mocks/recoverFunds/shoot.mjs [id ...]   (dev server on BASE)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199';
const OUT = process.env.OUT ?? join(tmpdir(), 'glow-recover-mock');
const ALL = [
  '01-wallet-row', '02-destination', '03-fee-cosigned', '04-review-cosigned', '04b-review-left-out', '05-sent',
  '06-wallet-after-cosigned', '07-review-stranded', '07b-review-no-exit-fee', '07c-running-no-exit-fee',
  '08-pending-owed', '09-pending-funded', '10-tracker-stranded', '11-archived-dialog', '12-review-mixed',
  '13-wallet-after-split', '14-review-error', '15-fee-nothing-worth', '17-tracker-bump', '18-bump-fee',
  '19-bump-review', '20-bump-sent', 'ux-13a-tracker-after-update', 'ux-13b-update-needed', 'ux-13b2-wallet-update-needed',
  'ux-13b3-updating', 'ux-13b4-update-error', 'ux-13c-wallet-landed', 'ux-13d-archived-details',
];
const SCROLL_TO_END = new Set();
const SCROLL_CONTENT_TO_END = new Set(['ux-13b4-update-error']);
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
  // A tall sheet hides its buttons below the fold: show the end of it.
  // The error card mounts while the sheet still slides in, so its own scroll stops short.
  if (SCROLL_CONTENT_TO_END.has(id)) {
    await page.evaluate(() => document.querySelectorAll('[data-mock-scroller]').forEach(el => { el.scrollTop = el.scrollHeight; }));
    await page.waitForTimeout(300);
  }
  if (SCROLL_TO_END.has(id)) {
    // Drag the handle up to the full snap, then scroll the content to its end, as a user would.
    await page.mouse.move(201, 485);
    await page.mouse.down();
    await page.mouse.move(201, 120, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    await page.evaluate(() =>
      document.querySelectorAll('.react-modal-sheet-container *').forEach(el => {
        if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
      }),
    );
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${OUT}/${id}.png` });
  console.log(`${id}: ${errors.length ? errors.join(' | ') : 'ok'}`);
  await context.close();
}
await browser.close();
