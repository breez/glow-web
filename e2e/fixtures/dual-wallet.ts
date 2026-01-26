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

export { expect };

/**
 * Helper: Restore a wallet from mnemonic
 */
export async function restoreWallet(page: Page, mnemonic: string): Promise<void> {
  // Navigate to app if not already there
  if (!page.url().includes('localhost')) {
    await page.goto('/');
  }

  // Click restore button on home page
  await page.getByTestId('restore-wallet-button').click();

  // Enter mnemonic
  await page.getByTestId('mnemonic-input').fill(mnemonic);

  // Confirm restore
  await page.getByTestId('restore-confirm-button').click();

  // Wait for wallet to load (balance should appear)
  await page.getByTestId('wallet-balance').waitFor({
    state: 'visible',
    timeout: 60000, // SDK initialization can take time
  });
}

/**
 * Helper: Create a new wallet
 */
export async function createWallet(page: Page): Promise<string> {
  // Navigate to app if not already there
  if (!page.url().includes('localhost')) {
    await page.goto('/');
  }

  // Click create button on home page
  await page.getByTestId('create-wallet-button').click();

  // Wait for mnemonic display (the generate page)
  // Note: This assumes there's a mnemonic display - adjust based on actual UI
  await page.waitForURL(/.*generate.*/, { timeout: 10000 });

  // Get the mnemonic text - this selector may need adjustment
  const mnemonicElement = await page.locator('[data-testid="mnemonic-display"]');
  const mnemonic = await mnemonicElement.textContent();

  if (!mnemonic) {
    throw new Error('Could not retrieve generated mnemonic');
  }

  // Continue/confirm the wallet creation
  const continueButton = page.getByTestId('continue-button');
  if (await continueButton.isVisible()) {
    await continueButton.click();
  }

  // Wait for wallet page
  await page.getByTestId('wallet-balance').waitFor({
    state: 'visible',
    timeout: 60000,
  });

  return mnemonic.trim();
}

/**
 * Helper: Get Spark address from receive dialog
 */
export async function getSparkAddress(page: Page): Promise<string> {
  // Open receive dialog
  await page.getByTestId('receive-button').click();

  // The dialog defaults to Lightning tab, but we need Spark
  // Check if there's a spark tab (might be combined with Bitcoin)
  const sparkTab = page.getByTestId('spark-tab');
  if (await sparkTab.isVisible()) {
    await sparkTab.click();
  }

  // Wait for Spark address to be generated and displayed
  const addressElement = await page.getByTestId('spark-address-text').waitFor({
    state: 'visible',
    timeout: 30000,
  });

  // Get the address text
  const addressText = await page.getByTestId('spark-address-text').textContent();

  if (!addressText) {
    throw new Error('Could not retrieve Spark address');
  }

  // Close the dialog by clicking outside or pressing Escape
  await page.keyboard.press('Escape');

  return addressText.trim();
}

/**
 * Helper: Get Bitcoin address from receive dialog
 */
export async function getBitcoinAddress(page: Page): Promise<string> {
  // Open receive dialog
  await page.getByTestId('receive-button').click();

  // Click Bitcoin tab
  await page.getByTestId('bitcoin-tab').click();

  // Wait for Bitcoin address to be generated
  const addressElement = await page.locator('[data-testid="bitcoin-address-text"]').waitFor({
    state: 'visible',
    timeout: 30000,
  });

  const addressText = await page.locator('[data-testid="bitcoin-address-text"]').textContent();

  if (!addressText) {
    throw new Error('Could not retrieve Bitcoin address');
  }

  // Close dialog
  await page.keyboard.press('Escape');

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
  // Open send dialog
  await page.getByTestId('send-button').click();

  // Enter destination
  await page.getByTestId('payment-input').fill(destination);

  // Click continue
  await page.getByTestId('continue-button').click();

  // If amount is needed (address without amount), enter it
  if (amountSats) {
    const amountInput = page.getByTestId('amount-input');
    if (await amountInput.isVisible({ timeout: 5000 })) {
      await amountInput.fill(amountSats.toString());
      await page.getByTestId('continue-button').click();
    }
  }

  // Wait for confirmation screen and confirm send
  // The send confirm button might be in a workflow step
  const sendConfirmButton = page.getByRole('button', { name: /send|confirm|pay/i });
  await sendConfirmButton.waitFor({ state: 'visible', timeout: 10000 });
  await sendConfirmButton.click();

  // Wait for result - success or failure
  const successElement = page.getByTestId('payment-success');
  const failureElement = page.getByTestId('payment-failure');

  await Promise.race([
    successElement.waitFor({ state: 'visible', timeout: 60000 }),
    failureElement.waitFor({ state: 'visible', timeout: 60000 }),
  ]);
}

/**
 * Helper: Get current balance from wallet page
 */
export async function getBalance(page: Page): Promise<number> {
  const balanceElement = page.getByTestId('wallet-balance');
  await balanceElement.waitFor({ state: 'visible' });

  const balanceText = await balanceElement.textContent();
  if (!balanceText) {
    return 0;
  }

  // Extract number from text like "1,234 sats" or "1 234 sats"
  const cleanedText = balanceText.replace(/[^0-9]/g, '');
  return parseInt(cleanedText, 10) || 0;
}
