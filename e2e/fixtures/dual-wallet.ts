import { test as base, BrowserContext, Page, expect } from '@playwright/test';

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
}

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
    console.warn(
      `Warning: ${envKey} not set. Using placeholder mnemonic. ` +
        'E2E tests requiring funded wallets will fail.'
    );
    // Return a valid BIP39 mnemonic structure (not funded)
    return 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  }

  return mnemonic;
}

/**
 * Extended Playwright test with dual wallet fixtures.
 */
export const test = base.extend<DualWalletFixtures>({
  walletA: async ({ browser }, use) => {
    // Create isolated browser context for Wallet A
    const context = await browser.newContext({
      storageState: undefined, // Fresh state, no persistence
    });

    const page = await context.newPage();
    const mnemonic = getTestMnemonic('A');

    await use({ context, page, mnemonic });

    await context.close();
  },

  walletB: async ({ browser }, use) => {
    // Create isolated browser context for Wallet B
    const context = await browser.newContext({
      storageState: undefined, // Fresh state, no persistence
    });

    const page = await context.newPage();
    const mnemonic = getTestMnemonic('B');

    await use({ context, page, mnemonic });

    await context.close();
  },
});

// Timeout constants for wallet operations
export const TIMEOUTS = {
  SDK_INIT: 120000,      // 2 minutes - WASM SDK initialization
  WALLET_LOAD: 90000,    // 1.5 minutes - wallet restore/create
  PAYMENT: 60000,        // 1 minute - payment processing
  ADDRESS_GEN: 30000,    // 30 seconds - address generation
  UI_ACTION: 10000,      // 10 seconds - UI interactions
  BALANCE_SYNC: 45000,   // 45 seconds - balance synchronization
};

/**
 * Helper: Wait for wallet to be fully loaded and synced
 */
export async function waitForWalletReady(page: Page): Promise<void> {
  // Wait for balance element to appear
  await page.getByTestId('wallet-balance').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.WALLET_LOAD,
  });

  // Wait for any loading indicators to disappear
  const loadingIndicator = page.getByTestId('loading-indicator').or(
    page.locator('[class*="loading"]').or(
      page.locator('[class*="spinner"]')
    )
  );

  // Give UI a moment to stabilize after balance appears
  await page.waitForTimeout(1000);

  // If there's a loading indicator, wait for it to disappear
  if (await loadingIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
    await loadingIndicator.waitFor({ state: 'hidden', timeout: TIMEOUTS.SDK_INIT });
  }

  // Ensure balance has a numeric value (not just placeholder)
  await expect(async () => {
    const balanceText = await page.getByTestId('wallet-balance').textContent();
    expect(balanceText).toMatch(/\d/); // Contains at least one digit
  }).toPass({ timeout: TIMEOUTS.BALANCE_SYNC });
}

/**
 * Helper: Restore a wallet from mnemonic
 */
export async function restoreWallet(page: Page, mnemonic: string): Promise<void> {
  // Navigate to app if not already there
  if (!page.url().includes('localhost')) {
    await page.goto('/');
  }

  // Wait for home page to be fully loaded
  await page.getByTestId('restore-wallet-button').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_ACTION,
  });

  // Click restore button on home page
  await page.getByTestId('restore-wallet-button').click();

  // Wait for mnemonic input to be ready
  await page.getByTestId('mnemonic-input').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_ACTION,
  });

  // Enter mnemonic
  await page.getByTestId('mnemonic-input').fill(mnemonic);

  // Confirm restore
  await page.getByTestId('restore-confirm-button').click();

  // Wait for wallet to be fully loaded and synced
  await waitForWalletReady(page);
}

/**
 * Helper: Create a new wallet
 */
export async function createWallet(page: Page): Promise<string> {
  // Navigate to app if not already there
  if (!page.url().includes('localhost')) {
    await page.goto('/');
  }

  // Wait for home page to be ready
  await page.getByTestId('create-wallet-button').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_ACTION,
  });

  // Click create button on home page
  await page.getByTestId('create-wallet-button').click();

  // Wait for mnemonic display (the generate page)
  // Note: This assumes there's a mnemonic display - adjust based on actual UI
  await page.waitForURL(/.*generate.*/, { timeout: TIMEOUTS.UI_ACTION });

  // Get the mnemonic text - this selector may need adjustment
  const mnemonicElement = await page.locator('[data-testid="mnemonic-display"]');
  await mnemonicElement.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
  const mnemonic = await mnemonicElement.textContent();

  if (!mnemonic) {
    throw new Error('Could not retrieve generated mnemonic');
  }

  // Continue/confirm the wallet creation
  const continueButton = page.getByTestId('continue-button');
  if (await continueButton.isVisible({ timeout: TIMEOUTS.UI_ACTION })) {
    await continueButton.click();
  }

  // Wait for wallet to be fully loaded
  await waitForWalletReady(page);

  return mnemonic.trim();
}

/**
 * Helper: Generate Lightning invoice from receive dialog
 */
export async function generateLightningInvoice(page: Page, amountSats: number): Promise<string> {
  // Ensure wallet is ready before opening receive dialog
  await page.getByTestId('receive-button').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_ACTION,
  });

  // Open receive dialog
  await page.getByTestId('receive-button').click();

  // Wait for dialog to open
  await page.waitForTimeout(500);

  // Click Lightning tab if exists
  const lightningTab = page.getByTestId('lightning-tab');
  if (await lightningTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await lightningTab.click();
  }

  // Enter amount
  const amountInput = page.getByTestId('invoice-amount-input').or(
    page.getByTestId('amount-input')
  );
  await amountInput.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
  await amountInput.fill(amountSats.toString());
  await page.waitForTimeout(300);

  // Generate invoice (might auto-generate or need button click)
  const generateButton = page.getByRole('button', { name: /generate|create|confirm/i });
  if (await generateButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await generateButton.click();
  }

  // Wait for invoice to be generated and displayed
  const invoiceText = page.getByTestId('lightning-invoice-text').or(
    page.getByTestId('invoice-text')
  );
  await invoiceText.waitFor({ state: 'visible', timeout: TIMEOUTS.ADDRESS_GEN });

  // Poll until we get a valid invoice (not empty or loading placeholder)
  let invoice: string | null = null;
  await expect(async () => {
    invoice = await invoiceText.textContent();
    expect(invoice).toBeTruthy();
    expect(invoice).toMatch(/^ln(bc|tb|bcrt)/); // Valid Lightning invoice prefix
  }).toPass({ timeout: TIMEOUTS.ADDRESS_GEN });

  if (!invoice) {
    throw new Error('Could not retrieve Lightning invoice');
  }

  // Close the dialog by clicking outside or pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300); // Allow dialog close animation

  return invoice.trim();
}

/**
 * Helper: Get Bitcoin address from receive dialog
 */
export async function getBitcoinAddress(page: Page): Promise<string> {
  // Ensure wallet is ready
  await page.getByTestId('receive-button').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_ACTION,
  });

  // Open receive dialog
  await page.getByTestId('receive-button').click();
  await page.waitForTimeout(500);

  // Click Bitcoin tab
  await page.getByTestId('bitcoin-tab').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_ACTION,
  });
  await page.getByTestId('bitcoin-tab').click();

  // Wait for Bitcoin address to be generated
  await page.locator('[data-testid="bitcoin-address-text"]').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.ADDRESS_GEN,
  });

  // Poll until we get a valid address
  let addressText: string | null = null;
  await expect(async () => {
    addressText = await page.locator('[data-testid="bitcoin-address-text"]').textContent();
    expect(addressText).toBeTruthy();
    expect(addressText).toMatch(/^(bc1|tb1|bcrt1)/); // Valid Bitcoin address format
  }).toPass({ timeout: TIMEOUTS.ADDRESS_GEN });

  if (!addressText) {
    throw new Error('Could not retrieve Bitcoin address');
  }

  // Close dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  return addressText.trim();
}

/**
 * Helper: Send payment to an address
 */
export async function sendPayment(
  page: Page,
  destination: string,
  amountSats?: number
): Promise<void> {
  // Ensure send button is ready
  await page.getByTestId('send-button').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_ACTION,
  });

  // Open send dialog
  await page.getByTestId('send-button').click();
  await page.waitForTimeout(500);

  // Wait for payment input to be ready
  await page.getByTestId('payment-input').waitFor({
    state: 'visible',
    timeout: TIMEOUTS.UI_ACTION,
  });

  // Enter destination
  await page.getByTestId('payment-input').fill(destination);

  // Wait a moment for input parsing
  await page.waitForTimeout(500);

  // Click continue
  await page.getByTestId('continue-button').click();

  // Wait for next step to load (may involve SDK parsing the input)
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

  // Wait for confirmation screen and confirm send
  // The send confirm button might be in a workflow step
  const sendConfirmButton = page.getByRole('button', { name: /send|confirm|pay/i });
  await sendConfirmButton.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
  await sendConfirmButton.click();

  // Wait for result - success or failure
  // Payment can take time as it involves network communication
  const successElement = page.getByTestId('payment-success');
  const failureElement = page.getByTestId('payment-failure');

  await Promise.race([
    successElement.waitFor({ state: 'visible', timeout: TIMEOUTS.PAYMENT }),
    failureElement.waitFor({ state: 'visible', timeout: TIMEOUTS.PAYMENT }),
  ]);
}

/**
 * Helper: Get current balance from wallet page
 */
export async function getBalance(page: Page): Promise<number> {
  const balanceElement = page.getByTestId('wallet-balance');
  await balanceElement.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });

  // Wait for balance to have actual content (not just placeholder)
  await expect(async () => {
    const text = await balanceElement.textContent();
    expect(text).toMatch(/\d/);
  }).toPass({ timeout: TIMEOUTS.BALANCE_SYNC });

  const balanceText = await balanceElement.textContent();
  if (!balanceText) {
    return 0;
  }

  // Extract number from text like "1,234 sats" or "1 234 sats"
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
  timeoutMs: number = TIMEOUTS.BALANCE_SYNC
): Promise<number> {
  let newBalance = previousBalance;

  await expect(async () => {
    // Refresh to get latest balance
    await page.reload();
    await waitForWalletReady(page);

    newBalance = await getBalance(page);

    if (direction === 'increase') {
      expect(newBalance).toBeGreaterThan(previousBalance);
    } else {
      expect(newBalance).toBeLessThan(previousBalance);
    }
  }).toPass({ timeout: timeoutMs });

  return newBalance;
}

// Re-export expect for convenience
export { expect };
