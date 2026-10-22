import { execFileSync } from 'node:child_process';
import { expect, type Locator, type Page } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';
import { formatWithSpaces } from '../../src/utils/formatNumber';
import type { PendingExit, UnilateralExitPlan } from '../../src/features/unilateral-exit/model/plan';
import { mineBlocks, tipHeight } from './bitcoind';
import { indexerTip, txConfirmed, waitFor } from './esplora';
import { blocksToNextStep, nodesConfirmed, openWallet, storedPlan } from './exitWizard';

/**
 * The cluster's scenario endpoints and the Recover Funds screens, for the
 * cases in docs/recoverable-funds-testing.md. Served by `regtest:up`, like
 * `/fund`.
 */
const CLUSTER_URL = process.env.TEST_FUND_URL || 'http://127.0.0.1:8997';

interface LeafReport {
  leaf: string;
  status: string | null;
}

async function ask<T>(path: string, query: Record<string, string>): Promise<T> {
  const response = await fetch(`${CLUSTER_URL}${path}?${new URLSearchParams(query)}`, {
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const body = (await response.json()) as T & { error?: string };
  if (body.error) throw new Error(`${path}: ${body.error}`);
  return body;
}

/**
 * How `regtest:recoverable` makes each kind. Two renewals end WATCHTOWER_EXITED,
 * which the operators co-sign out. One renewal and an exited parent leave a
 * recovery that needs an exit fee. One renewal and the watchtower leave the
 * leaf's own transaction on-chain, which nobody can recover.
 */
const KINDS = {
  cosigned: { renewals: 2, sats: 200_000, exit: 'watchtower-exit' },
  'exit-fee': { renewals: 1, sats: 150_000, exit: 'parent-exit' },
  unrecoverable: { renewals: 1, sats: 150_000, exit: 'watchtower-exit' },
} as const;

export type RecoverableKind = keyof typeof KINDS;

/** Has the cluster renew a leaf of `sats` and send it to the wallet `mnemonic` owns. Returns its id. */
export const renewedLeaf = async (mnemonic: string, sats: number, renewals: number): Promise<string> =>
  (await ask<{ leaf: string }>('/renewed-leaf', { sats: String(sats), renewals: String(renewals), mnemonic })).leaf;

/**
 * Exits the leaf's parent, or has the watchtower cut it off. The cluster exits
 * only a leaf the app has claimed, so this waits while the wallet is open.
 */
export async function exitLeaf(kind: 'parent-exit' | 'watchtower-exit', leaf: string): Promise<LeafReport> {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    try {
      return await ask<LeafReport>(`/${kind}`, { leaf });
    } catch (e) {
      // While a claim settles, the operators disagree on the leaf for a moment.
      if (!/has not claimed|between statuses/.test(String(e)) || Date.now() > deadline) throw e;
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
  }
}

/** An amount as `SatAmount` renders it. */
export const sat = (sats: number): string => `₿${formatWithSpaces(sats)}`;

/** Runs the app's foreground resync, as coming back to the tab does, rather than waiting out the sdk's sync timer. */
export const resync = (page: Page): Promise<void> =>
  page.evaluate(() => void document.dispatchEvent(new Event('visibilitychange')));

/** Waits until `locator` shows `text`, resyncing so the app reads getInfo again. */
export async function expectAfterSync(page: Page, locator: Locator, text: string): Promise<void> {
  await expect(async () => {
    await resync(page);
    await expect(locator).toContainText(text, { timeout: 10_000 });
  }).toPass({ timeout: 3 * 60_000 });
}

/**
 * A fresh wallet, open in the app, holding one leaf of each kind outside its
 * balance. Exits run in the order given: a co-signed leaf's watchtower exit
 * mines 50 blocks, which would hand an exit-fee leaf exited before it to the
 * watchtower.
 */
export async function giveRecoverableFunds(page: Page, mnemonic: string, kinds: RecoverableKind[]): Promise<string[]> {
  const leaves: string[] = [];
  for (const kind of kinds) leaves.push(await renewedLeaf(mnemonic, KINDS[kind].sats, KINDS[kind].renewals));
  await openWallet(page, mnemonic, { devMode: false });
  for (const [i, kind] of kinds.entries()) await exitLeaf(KINDS[kind].exit, leaves[i]);
  const total = kinds.reduce((sum, kind) => sum + KINDS[kind].sats, 0);
  await expectAfterSync(page, page.getByTestId('recoverable-funds-entry'), sat(total));
  return leaves;
}

/** Fakes the network's rates: regtest's are flat at 1 sat/vB. */
export const fakeFeeRates = async (page: Page, rate: number): Promise<void> => {
  await page.route('**/v1/fees/recommended', async route => {
    // The real response's headers, so the cross-origin read still passes CORS.
    await route.fulfill({
      response: await route.fetch(),
      json: { fastestFee: rate, halfHourFee: rate, hourFee: rate, economyFee: rate, minimumFee: 1 },
    });
  });
};

/** Picks the slow rate on the fee step and asks for a quote. */
export async function quoteAtSlowRate(page: Page): Promise<void> {
  await page.getByText('Slow', { exact: true }).click();
  await page.getByTestId('unilateral-exit-get-quote').click();
}

/** Opens Recover Funds from its row and quotes `destination` at the slow rate. */
export async function quoteRecovery(page: Page, destination: string): Promise<void> {
  await page.getByTestId('recoverable-funds-entry').click();
  await page.getByPlaceholder('bc1q...').fill(destination);
  await page.getByTestId('unilateral-exit-destination-continue').click();
  await quoteAtSlowRate(page);
}

export const closeSheet = (page: Page): Promise<void> => page.getByRole('button', { name: 'Close', exact: true }).click();

const digits = (text: string): number => Number(text.replace(/\D/g, ''));

/** The amount shown under `label`, such as "You'll receive" or "Send from another wallet". */
export async function amountUnder(page: Page, label: string): Promise<number> {
  const box = page.getByText(label, { exact: true }).locator('..');
  await expect(box).toBeVisible({ timeout: TIMEOUTS.BALANCE_SYNC });
  return digits((await box.innerText()).replace(label, ''));
}

/** The amount in a "₿X on its way" line. */
export const amountOnItsWay = async (page: Page): Promise<number> =>
  digits(await page.getByText('on its way').innerText());

const stored = <T>(page: Page, prefix: string): Promise<T | null> =>
  page.evaluate(p => {
    const key = Object.keys(localStorage).find(k => k.startsWith(p));
    return key ? (JSON.parse(localStorage.getItem(key) as string) as T) : null;
  }, prefix);

/** The co-signed recoveries Glow keeps beside the plan slot until they confirm. */
export const storedRecoveries = async (page: Page): Promise<UnilateralExitPlan[]> =>
  (await stored<UnilateralExitPlan[]>(page, 'recovery-cosigned:')) ?? [];

export const storedPending = (page: Page): Promise<PendingExit | null> =>
  stored<PendingExit>(page, 'unilateral-exit-pending:');

/** The txid of the one co-signed recovery Glow keeps, once there is one. */
export async function keptRecoveryTxid(page: Page): Promise<string> {
  const [kept] = await waitFor(() => storedRecoveries(page), list => list.length === 1, {
    what: 'the kept co-signed recovery',
  });
  const tx = kept.exit.transactions.find(t => t.kind === 'cooperative');
  if (!tx) throw new Error('the kept recovery has no co-signed transaction');
  return tx.txid;
}

/** Waits until the indexer the app reads has seen `height`. */
export const waitForIndexer = (height: number): Promise<number> =>
  waitFor(indexerTip, tip => tip >= height, { timeoutMs: 30_000, everyMs: 500, what: `the indexer to reach ${height}` });

/**
 * Mines a recovery or exit to its end so that Glow's own refunds land: a block
 * at a time until its leaf transactions confirm, straight to the refunds'
 * timelock, then a block at a time again. The operators' copy of a refund
 * matures 50 blocks after Glow's, and the last two phases mine fewer than 40.
 */
export async function mineToFinish(page: Page): Promise<void> {
  await waitFor(
    async () => {
      await mineBlocks(1);
      return nodesConfirmed(page);
    },
    done => done,
    { timeoutMs: 120_000, everyMs: 4_000, what: 'the leaf transactions to confirm' },
  );
  await mineBlocks(await blocksToNextStep(page, await tipHeight()));
  const refunds = ((await storedPlan(page))?.exit.transactions ?? []).filter(t => t.kind === 'refund').map(t => t.txid);
  await waitFor(
    async () => {
      await mineBlocks(1);
      return (await Promise.all(refunds.map(txConfirmed))).some(Boolean);
    },
    landed => landed,
    { timeoutMs: 60_000, everyMs: 4_000, what: "one of Glow's refunds to confirm" },
  );
  const finished = page.getByTestId('unilateral-exit-complete');
  await waitFor(
    async () => {
      if (await finished.isVisible()) return true;
      await mineBlocks(1);
      return false;
    },
    done => done,
    { timeoutMs: 150_000, everyMs: 6_000, what: 'the sweep to land' },
  );
}

/** Opens the finished row's details. */
export async function openFinishedDetails(page: Page): Promise<Locator> {
  await page.getByTestId('unilateral-exit-complete').first().click();
  const details = page.getByTestId('unilateral-exit-details');
  await expect(details).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
  return details;
}

/** The line under the details' title, which names the flow. A paragraph, unlike the list heading of the same words. */
export const detailsSubtitle = (page: Page, text: string): Locator =>
  page.locator('p').filter({ hasText: new RegExp(`^${text}$`) });

/** The amount on a details row, by its label. */
export async function detailSat(details: Locator, label: string): Promise<number> {
  const row = details.getByText(label, { exact: true }).locator('xpath=../..');
  return digits((await row.innerText()).replace(label, ''));
}

/** Stops or starts the browser's gRPC-web proxy, as `regtest:operators` does. The cluster's own calls go around it. */
export async function setOperators(state: 'down' | 'up'): Promise<void> {
  execFileSync('node', ['local-regtest/outage.mjs', 'operators', state], { stdio: 'ignore' });
  if (state === 'down') return;
  const { signingOperators } = JSON.parse(process.env.VITE_SPARK_LOCAL_CONFIG ?? '{}') as {
    signingOperators?: { address: string }[];
  };
  // Docker publishes the ports before envoy inside answers on them.
  await waitFor(
    async () => {
      const replies = await Promise.all(
        (signingOperators ?? []).map(({ address }) =>
          fetch(address, { signal: AbortSignal.timeout(2_000) }).then(
            () => true,
            () => false,
          ),
        ),
      );
      return replies.every(Boolean);
    },
    up => up,
    { timeoutMs: 30_000, everyMs: 500, what: 'the gRPC-web proxy to answer' },
  );
}

export const hasDocker = (): boolean => {
  try {
    execFileSync('docker', ['inspect', 'spark-grpcweb'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
