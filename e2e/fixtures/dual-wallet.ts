import { test as base, BrowserContext, Page, expect } from '@playwright/test';
import {
  fundWallet,
  isFaucetConfigured,
  MIN_TEST_BALANCE_SATS,
  MAX_INITIAL_FUNDING,
  DEFAULT_MIN_AMOUNT,
  DEFAULT_MAX_AMOUNT,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
} from '../utils/faucet';
import { loggedStep } from '../utils/logger';

/**
 * Dual Wallet Test Fixture
 *
 * Creates two isolated browser contexts, each with their own:
 * - localStorage (separate wallet mnemonics)
 * - WASM SDK instance
 * - Cookies and IndexedDB
 *
 * This enables testing wallet-to-wallet transfers.
 */

export interface WalletFixture {
  context: BrowserContext;
  page: Page;
  mnemonic: string;
  name: string;
}

// Track if we've already attempted to fund wallets in this test run
let fundingAttempted = false;

interface DualWalletFixtures {
  walletA: WalletFixture;
  walletB: WalletFixture;
}

/**
 * Generate a test mnemonic from environment or use placeholder.
 * In CI, these should be set as secrets with pre-funded regtest wallets.
 */
function getTestMnemonic(walletName: 'A' | 'B'): string {
  const envKey = `TEST_WALLET_${walletName}_MNEMONIC`;
  const mnemonic = process.env[envKey];

  if (!mnemonic) {
    const testEnvVars = Object.keys(process.env).filter(k => k.startsWith('TEST_'));
    console.warn(
      `Warning: ${envKey} not set. ` +
      `Available TEST_* vars: ${testEnvVars.length > 0 ? testEnvVars.join(', ') : 'none'}. ` +
      'Using placeholder mnemonic - E2E tests requiring funded wallets will fail.'
    );
    return 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  }

  console.log(`${envKey} loaded (${mnemonic.split(' ').length} words)`);
  return mnemonic;
}

/**
 * Extended Playwright test with dual wallet fixtures.
 */
export const test = base.extend<DualWalletFixtures>({
  walletA: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const mnemonic = getTestMnemonic('A');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await use({ context, page, mnemonic, name: 'Wallet A' });
    await context.close();
  },

  walletB: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const mnemonic = getTestMnemonic('B');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await use({ context, page, mnemonic, name: 'Wallet B' });
    await context.close();
  },
});

import { TIMEOUTS } from '../constants/timeouts';
import { TEST_URLS } from '../constants/urls';

/**
 * Helper: Wait for wallet UI to load and for at least one sync to complete.
 * Note: After initial connection, the SDK syncs periodically — the wallet
 * is usable between syncs, it just may not reflect the latest state yet.
 */
export async function waitForWalletReady(walletOrPage: WalletFixture | Page): Promise<void> {
  const page = 'page' in walletOrPage ? walletOrPage.page : walletOrPage;
  const name = 'name' in walletOrPage ? walletOrPage.name : 'Wallet';

  await loggedStep(`[${name}] Wait for wallet to load and sync`, async () => {
    await page.getByTestId('wallet-balance').waitFor({
      state: 'visible',
      timeout: TIMEOUTS.WALLET_LOAD,
    });

    // Give UI a moment to show the restoration overlay
    await page.waitForTimeout(1000);

    // If loading indicator is visible, wait for the current sync to finish
    const loadingIndicator = page.getByTestId('loading-indicator');
    if (await loadingIndicator.isVisible().catch(() => false)) {
      console.log(`  [${name}] Waiting for current sync to finish...`);
      await loadingIndicator.waitFor({ state: 'hidden', timeout: TIMEOUTS.SDK_INIT });
    }

    // Wait for at least one sync to complete
    await expect(async () => {
      const synced = await page.locator('body').getAttribute('data-wallet-synced');
      expect(synced).toBe('true');
    }).toPass({ timeout: TIMEOUTS.BALANCE_SYNC });

    // Ensure balance has a numeric value
    await expect(async () => {
      const el = page.getByTestId('wallet-balance');
      const text = await el.textContent();
      expect(text).toMatch(/\d/);
    }).toPass({ timeout: TIMEOUTS.BALANCE_SYNC });

    const balance = await getBalance(page);
    console.log(`  [${name}] Balance: ${balance} sats`);
  }, TIMEOUTS.WALLET_LOAD);
}

/**
 * Helper: Ensure wallet has minimum balance, request faucet funds if needed.
 */
export async function ensureWalletFunded(
  walletOrPage: WalletFixture | Page,
  minBalance: number = MIN_TEST_BALANCE_SATS,
): Promise<void> {
  const page = 'page' in walletOrPage ? walletOrPage.page : walletOrPage;
  const name = 'name' in walletOrPage ? walletOrPage.name : 'Wallet';

  const currentBalance = await getBalance(page);
  console.log(`[${name}] Balance: ${currentBalance} sats, minimum: ${minBalance} sats`);

  if (currentBalance >= minBalance) return;

  if (!isFaucetConfigured()) {
    console.warn(`[${name}] Balance low but faucet not configured. Set FAUCET_USERNAME and FAUCET_PASSWORD.`);
    return;
  }

  if (fundingAttempted) {
    console.log(`[${name}] Funding already attempted this run, skipping`);
    return;
  }
  fundingAttempted = true;

  await loggedStep(`[${name}] Fund wallet via faucet`, async () => {
    const btcAddress = await getBitcoinAddress(page);
    console.log(`  [${name}] Funding address: ${btcAddress}`);

    const txHash = await fundWallet(btcAddress, MAX_INITIAL_FUNDING);
    console.log(`  [${name}] Faucet tx: ${txHash}`);

    await expect(async () => {
      await page.reload();
      await waitForWalletReady(walletOrPage);
      const newBalance = await getBalance(page);
      console.log(`  [${name}] Balance after reload: ${newBalance} sats`);
      expect(newBalance).toBeGreaterThanOrEqual(minBalance);
    }).toPass({ timeout: TIMEOUTS.FAUCET_WAIT });
  }, TIMEOUTS.FAUCET_WAIT);
}

/**
 * Helper: Restore a wallet from mnemonic
 */
export async function restoreWallet(walletOrPage: WalletFixture | Page, mnemonic: string): Promise<void> {
  const page = 'page' in walletOrPage ? walletOrPage.page : walletOrPage;
  const name = 'name' in walletOrPage ? walletOrPage.name : 'Wallet';

  await loggedStep(`[${name}] Restore wallet`, async () => {
    await page.goto(TEST_URLS.HOME);

    await page.getByTestId('restore-wallet-button').waitFor({
      state: 'visible',
      timeout: TIMEOUTS.UI_ACTION,
    });
    await page.getByTestId('restore-wallet-button').click();

    await page.getByTestId('mnemonic-input').waitFor({
      state: 'visible',
      timeout: TIMEOUTS.UI_ACTION,
    });
    await page.getByTestId('mnemonic-input').fill(mnemonic);
    await page.getByTestId('restore-confirm-button').click();

    await waitForWalletReady(walletOrPage);
  }, TIMEOUTS.WALLET_LOAD);
}

/**
 * Helper: Create a new wallet
 */
export async function createWallet(page: Page): Promise<string> {
  return loggedStep('Create wallet', async () => {
    await page.goto(TEST_URLS.HOME);

    await page.getByTestId('create-wallet-button').waitFor({
      state: 'visible',
      timeout: TIMEOUTS.UI_ACTION,
    });
    await page.getByTestId('create-wallet-button').click();

    await page.waitForURL(/.*generate.*/, { timeout: TIMEOUTS.UI_ACTION });

    const mnemonicElement = page.locator('[data-testid="mnemonic-display"]');
    await mnemonicElement.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
    const mnemonic = await mnemonicElement.textContent();

    if (!mnemonic) {
      throw new Error('Could not retrieve generated mnemonic');
    }

    const continueButton = page.getByTestId('continue-button');
    if (await continueButton.isVisible({ timeout: TIMEOUTS.UI_ACTION })) {
      await continueButton.click();
    }

    await waitForWalletReady(page);
    return mnemonic.trim();
  }, TIMEOUTS.WALLET_LOAD);
}

/**
 * Helper: Generate Lightning invoice from receive dialog
 */
export async function generateLightningInvoice(
  page: Page,
  amountSats: number,
  closeDialog: boolean = true,
): Promise<string> {
  return loggedStep(`Generate Lightning invoice (${amountSats} sats)`, async () => {
    // Open receive dialog
    await page.getByTestId('receive-button').waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
    await page.getByTestId('receive-button').click();
    await page.waitForTimeout(500);

    // Click Lightning tab
    await page.getByTestId('lightning-tab').click();

    // Show amount panel if needed
    const showAmountButton = page.getByTestId('show-amount-panel-button');
    if (await showAmountButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await showAmountButton.click();
    }

    // Enter amount and submit
    const amountInput = page.getByTestId('invoice-amount-input');
    await amountInput.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
    await amountInput.fill(amountSats.toString());

    await page.getByTestId('generate-invoice-button').click();

    // Wait for invoice to appear
    const invoiceWrapper = page.locator('[data-testid="lightning-invoice-text"]').first();
    await invoiceWrapper.waitFor({ state: 'visible', timeout: TIMEOUTS.ADDRESS_GEN });

    const invoiceTextButton = page.locator('[data-testid="copyable-text-content"]').first();
    await expect(async () => {
      const text = await invoiceTextButton.textContent();
      expect(text).toMatch(/^ln(bc|tb|bcrt)/i);
    }).toPass({ timeout: TIMEOUTS.ADDRESS_GEN });

    // Copy via clipboard
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="copy-button"]') as HTMLElement;
      if (btn) btn.click();
    });
    await page.waitForTimeout(100);
    const invoice = await page.evaluate(() => navigator.clipboard.readText());

    if (!invoice?.trim().match(/^ln(bc|tb|bcrt)/i)) {
      throw new Error('Failed to retrieve valid invoice from clipboard');
    }

    if (closeDialog) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    return invoice.trim();
  }, TIMEOUTS.ADDRESS_GEN);
}

/**
 * Helper: Get Bitcoin address from receive dialog
 */
export async function getBitcoinAddress(page: Page): Promise<string> {
  return loggedStep('Get Bitcoin address', async () => {
    await page.getByTestId('receive-button').waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
    await page.getByTestId('receive-button').click();
    await page.waitForTimeout(500);

    await page.getByTestId('bitcoin-tab').click();

    await page.locator('[data-testid="bitcoin-address-text"]').waitFor({
      state: 'visible',
      timeout: TIMEOUTS.ADDRESS_GEN,
    });

    // Wait for the copyable text button to have a valid address
    const addressButton = page.locator('[data-testid="bitcoin-address-text"] [data-testid="copyable-text-content"]');
    await expect(async () => {
      const text = await addressButton.textContent();
      expect(text).toMatch(/^(bc1|bcrt1)/);
    }).toPass({ timeout: TIMEOUTS.ADDRESS_GEN });

    // Copy via clipboard to get the full (non-truncated) address
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="bitcoin-address-text"] [data-testid="copy-button"]') as HTMLElement;
      if (btn) btn.click();
    });
    await page.waitForTimeout(100);
    const address = await page.evaluate(() => navigator.clipboard.readText());

    if (!address?.trim().match(/^(bc1|bcrt1)/)) {
      throw new Error(`Failed to retrieve valid Bitcoin address from clipboard: ${address}`);
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    return address.trim();
  }, TIMEOUTS.ADDRESS_GEN);
}

/**
 * Helper: Send payment to an address
 */
export async function sendPayment(
  page: Page,
  destination: string,
  amountSats?: number,
): Promise<void> {
  await loggedStep('Send payment', async () => {
    await page.getByTestId('send-button').waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
    await page.getByTestId('send-button').click();
    await page.waitForTimeout(500);

    await page.getByTestId('payment-input').waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
    await page.getByTestId('payment-input').fill(destination);
    await page.waitForTimeout(500);

    await page.getByTestId('continue-button').click();
    await page.waitForTimeout(1000);

    // If amount is needed (address without amount), enter it
    if (amountSats) {
      const amountInput = page.getByTestId('amount-input');
      if (await amountInput.isVisible({ timeout: TIMEOUTS.UI_ACTION }).catch(() => false)) {
        await amountInput.fill(amountSats.toString());
        await page.waitForTimeout(300);
        await page.getByTestId('continue-button').click();
      }
    }

    // Confirm send
    const sendConfirmButton = page.getByRole('button', { name: /confirm.*send|send.*confirm/i });
    await sendConfirmButton.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
    await sendConfirmButton.click();

    // Wait for result
    const successElement = page.getByTestId('payment-success');
    const failureElement = page.getByTestId('payment-failure');

    await Promise.race([
      successElement.waitFor({ state: 'visible', timeout: TIMEOUTS.PAYMENT }),
      failureElement.waitFor({ state: 'visible', timeout: TIMEOUTS.PAYMENT }),
    ]);
  }, TIMEOUTS.PAYMENT);
}

/**
 * Helper: Get current balance from wallet page
 */
export async function getBalance(page: Page): Promise<number> {
  const balanceElement = page.getByTestId('wallet-balance');
  await balanceElement.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });

  await expect(async () => {
    const text = await balanceElement.textContent();
    expect(text).toMatch(/\d/);
  }).toPass({ timeout: TIMEOUTS.BALANCE_SYNC });

  const balanceText = await balanceElement.textContent();
  if (!balanceText) return 0;

  const cleanedText = balanceText.replace(/[^0-9]/g, '');
  return parseInt(cleanedText, 10) || 0;
}

/**
 * Helper: Wait for balance to update after a transaction
 */
export async function waitForBalanceChange(
  page: Page,
  previousBalance: number,
  direction: 'increase' | 'decrease',
  timeoutMs: number = TIMEOUTS.BALANCE_SYNC,
  options?: {
    expectedDelta?: number;
  },
): Promise<number> {
  let newBalance = previousBalance;
  const expectedDelta = options?.expectedDelta;

  const formatAmount = (value: number): string => {
    return Math.abs(Math.round(value))
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };

  const normalizeAmountText = (raw: string): string =>
    raw.replace(/[\u202F\u00A0]/g, ' ').replace(/\s+/g, ' ').trim();

  await loggedStep(`Wait for balance ${direction}`, async () => {
    await expect(async () => {
      await page.reload();
      await waitForWalletReady(page);
      newBalance = await getBalance(page);

      if (direction === 'increase') {
        if (newBalance > previousBalance) {
          expect(newBalance).toBeGreaterThan(previousBalance);
          return;
        }

        if (expectedDelta != null) {
          const expectedAmountText = `+${formatAmount(expectedDelta)}`;
          const amountTexts = await page.getByTestId('transaction-amount').allTextContents();
          const hasExpectedTransaction = amountTexts
            .map(normalizeAmountText)
            .some(text => text === expectedAmountText);

          if (hasExpectedTransaction) {
            newBalance = Math.max(newBalance, previousBalance + expectedDelta);
            return;
          }
        }

        expect(newBalance).toBeGreaterThan(previousBalance);
      } else {
        if (newBalance < previousBalance) {
          expect(newBalance).toBeLessThan(previousBalance);
          return;
        }

        if (expectedDelta != null) {
          const expectedAmountText = `-${formatAmount(expectedDelta)}`;
          const amountTexts = await page.getByTestId('transaction-amount').allTextContents();
          const hasExpectedTransaction = amountTexts
            .map(normalizeAmountText)
            .some(text => text === expectedAmountText);

          if (hasExpectedTransaction) {
            newBalance = Math.min(newBalance, previousBalance - expectedDelta);
            return;
          }
        }

        expect(newBalance).toBeLessThan(previousBalance);
      }
    }).toPass({ timeout: timeoutMs });
  }, timeoutMs);

  return newBalance;
}

/**
 * Helper: Assert Bitcoin address is regtest format
 */
export function assertRegtestBitcoinAddress(address: string): void {
  // Spark SDK returns bc1p (Taproot) or bcrt1 addresses on regtest
  if (!address.startsWith('bcrt1') && !address.startsWith('bc1p')) {
    throw new Error(
      `Bitcoin address does not have expected prefix ('bcrt1' or 'bc1p'). Got: ${address.substring(0, 10)}... ` +
      'This could indicate tests are running against mainnet!'
    );
  }
}

/**
 * Helper: Assert Lightning invoice is regtest format
 */
export function assertRegtestLightningInvoice(invoice: string): void {
  if (!invoice.toLowerCase().startsWith('lnbcrt')) {
    throw new Error(
      `Lightning invoice does not have regtest prefix 'lnbcrt'. Got: ${invoice.substring(0, 10)}... ` +
      'This could indicate tests are running against mainnet!'
    );
  }
}

/**
 * Helper: Click the Fund Wallet button (only available on regtest).
 */
export async function clickFundWalletButton(
  page: Page,
  waitForFunds: boolean = true,
): Promise<void> {
  await loggedStep('Click Fund Wallet button', async () => {
    const fundButton = page.getByTestId('fund-wallet-button');
    await fundButton.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });

    const initialBalance = await getBalance(page);
    console.log(`  Initial balance: ${initialBalance} sats`);

    await fundButton.click();

    if (waitForFunds) {
      await expect(async () => {
        await page.reload();
        await waitForWalletReady(page);
        const newBalance = await getBalance(page);
        console.log(`  Balance after reload: ${newBalance} sats`);
        expect(newBalance).toBeGreaterThan(initialBalance);
      }).toPass({ timeout: TIMEOUTS.FAUCET_WAIT });
    }
  }, TIMEOUTS.FAUCET_WAIT);
}

// Re-export expect and constants for convenience
export {
  expect,
  TIMEOUTS,
  DEFAULT_MIN_AMOUNT,
  DEFAULT_MAX_AMOUNT,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
};
