import { expect, type Page } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';
import { mineBlocks, sendToAddress } from './bitcoind';
import { deriveFundingKey } from '../../src/features/unilateral-exit/funding';
import type { ArchivedExit } from '../../src/features/unilateral-exit/archive';
import { nextAction, type UnilateralExitPlan } from '../../src/features/unilateral-exit/driver';

export const openWallet = async (page: Page, mnemonic: string): Promise<void> => {
  await page.addInitScript(m => {
    localStorage.setItem('walletMnemonic', m);
    localStorage.setItem('spark-dev-mode', 'true');
  }, mnemonic);
  await page.goto('/?network=regtest&dev=true');
  // The wallet screen, whether or not it has payments on it: a reopened wallet
  // has a payment list, so waiting for the empty state hangs.
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible({
    timeout: TIMEOUTS.WALLET_LOAD,
  });
};

export const openUnilateralExit = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation').getByText('Settings').click();
  // Asserted on the way past: the last-resort framing sits with the decision
  // to start, which is here rather than on the flow's first screen.
  await expect(page.getByText('This is a last-resort action.')).toBeVisible();
  await page.getByTestId('settings-unilateral-exit').click();
};

/** The plan the engine persists, which is what a resumed pass reads back. */
export const storedPlan = async (page: Page): Promise<UnilateralExitPlan | null> =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('recovery-plan:'));
    return key ? (JSON.parse(localStorage.getItem(key) as string) as UnilateralExitPlan) : null;
  });

/**
 * The finished exits the engine recorded. The plan slot is handed back when an
 * exit lands, so what it delivered is read from here afterwards.
 */
export const storedArchive = async (page: Page): Promise<ArchivedExit[]> =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('unilateral-exit-archive:'));
    return key ? (JSON.parse(localStorage.getItem(key) as string) as ArchivedExit[]) : [];
  });

/** Every node transaction is on-chain, which is what starts the refund clocks. */
export const nodesConfirmed = async (page: Page): Promise<boolean> => {
  const plan = await storedPlan(page);
  const nodes = (plan?.exit.transactions ?? []).filter(t => t.kind === 'node');
  return nodes.length > 0 && nodes.every(t => t.status.type === 'confirmed');
};

/**
 * Blocks until the next step can go out, from the plan the engine persisted.
 * The tracker's Mine buttons are fixed presets, so they cannot answer this.
 */
export const blocksToNextStep = async (page: Page, tip: number): Promise<number> => {
  const plan = await storedPlan(page);
  const blocks = nextAction(plan?.exit.transactions ?? [], tip)?.blocks ?? null;
  expect(blocks).not.toBeNull();
  return blocks as number;
};

/** The figure the quote puts in front of the user as what will arrive. */
const quotedWillReceiveSat = async (page: Page): Promise<number> => {
  const hero = page.getByText("You'll receive").locator('..');
  return Number((await hero.innerText()).replace(/\D/g, ''));
};

/**
 * Drives the wizard from the intro to a live tracker and returns the amount the
 * quote promised. Null when the wallet has no leaves left to exit, so the
 * caller can skip.
 */
export const driveWizardToTracker = async (
  page: Page,
  destination: string,
  mnemonic: string,
): Promise<number | null> => {
  await page.getByTestId('unilateral-exit-start').click();

  await page.getByPlaceholder('bc1q...').fill(destination);
  await page.getByTestId('unilateral-exit-destination-continue').click();

  await expect(page.getByText('Fee rate')).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
  await page.getByText('Slow', { exact: true }).click();
  await page.getByTestId('unilateral-exit-get-quote').click();

  const quoteContinue = page.getByTestId('unilateral-exit-quote-continue');
  const nothingToDo = page.getByText('Nothing is worth exiting right now');
  await expect(quoteContinue.or(nothingToDo).first()).toBeVisible({
    timeout: TIMEOUTS.BALANCE_SYNC,
  });
  if (await nothingToDo.isVisible()) return null;
  const promised = await quotedWillReceiveSat(page);
  await quoteContinue.click();

  const funding = deriveFundingKey(mnemonic, 'regtest', 0).address;
  await expect(page.getByTestId('unilateral-exit-funding-address')).toBeVisible({
    timeout: TIMEOUTS.UI_ACTION,
  });

  // The exit is saved once its fee address shows, so it outlives the app and
  // its row in the wallet list reopens where to pay.
  await page.reload();
  const row = page.getByTestId('unilateral-exit-entry');
  await expect(row).toContainText('Waiting for exit fee', { timeout: TIMEOUTS.WALLET_LOAD });
  await row.click();
  await expect(page.getByTestId('unilateral-exit-funding-address')).toBeVisible({
    timeout: TIMEOUTS.UI_ACTION,
  });

  await sendToAddress(funding, 0.0002);
  await mineBlocks(1);

  // Paying does not start the exit: the user does, once the fee has confirmed.
  const start = page.getByTestId('unilateral-exit-start-exit');
  await expect(start).toBeVisible({ timeout: TIMEOUTS.BALANCE_SYNC });
  await start.click();
  await expect(page.getByTestId('unilateral-exit-tracker')).toBeVisible({
    timeout: TIMEOUTS.PAYMENT,
  });
  return promised;
};
