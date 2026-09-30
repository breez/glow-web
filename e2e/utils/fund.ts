import { generateMnemonic } from 'bip39';
import { expect, type Page } from '@playwright/test';
import { getBalance, getBitcoinAddress, waitForWalletReady } from '../fixtures/dual-wallet';
import { mineBlocks, sendToAddress } from './bitcoind';

// The claim pays the SSP's fee out of the deposit, up to the app's default
// ceiling.
const MAX_CLAIM_FEE_SATS = 500;

/**
 * Funds the wallet open on `page` with a deposit from the environment's Bitcoin
 * node. The wallet claims it once it confirms, and the environment's SSP pays
 * the claim out of its pool of leaves.
 */
export const fundWallet = async (page: Page, sats: number): Promise<void> => {
  const address = await getBitcoinAddress(page);
  await sendToAddress(address, sats / 100_000_000);
  await mineBlocks(1);

  // Reopening the wallet syncs it, which is when it claims a deposit.
  await expect(async () => {
    await page.reload();
    await waitForWalletReady(page);
    expect(await getBalance(page)).toBeGreaterThanOrEqual(sats - MAX_CLAIM_FEE_SATS);
  }).toPass({ timeout: 5 * 60_000, intervals: [10_000] });
};

/**
 * A wallet nothing has touched. Leaves survive a failed exit, so a test reusing
 * a phrase inherits whatever the last run left behind: each run gets its own.
 */
export const freshMnemonic = (): string => generateMnemonic(128);
