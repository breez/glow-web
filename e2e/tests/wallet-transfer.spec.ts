import { test, expect, restoreWallet, getSparkAddress, sendPayment, getBalance } from '../fixtures/dual-wallet';

/**
 * Wallet-to-Wallet Transfer Tests
 *
 * These tests require:
 * 1. Two pre-funded test wallets (mnemonics in env vars)
 * 2. Connection to Spark Regtest network
 * 3. Faucet credentials (for funding if needed)
 *
 * Environment variables:
 * - TEST_WALLET_A_MNEMONIC: 12/24-word mnemonic for sender wallet
 * - TEST_WALLET_B_MNEMONIC: 12/24-word mnemonic for receiver wallet
 * - FAUCET_USERNAME: (optional) Spark faucet auth
 * - FAUCET_PASSWORD: (optional) Spark faucet auth
 */

test.describe('Wallet-to-Wallet Transfers', () => {
  test.describe.configure({ mode: 'serial' });

  test('send sats from Wallet A to Wallet B via Spark address', async ({
    walletA,
    walletB,
  }) => {
    const sendAmount = 100; // sats

    // Step 1: Restore both wallets
    await test.step('Restore Wallet A (sender)', async () => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);
    });

    await test.step('Restore Wallet B (receiver)', async () => {
      await walletB.page.goto('/');
      await restoreWallet(walletB.page, walletB.mnemonic);
    });

    // Step 2: Get initial balances
    let walletAInitialBalance: number;
    let walletBInitialBalance: number;

    await test.step('Get initial balances', async () => {
      walletAInitialBalance = await getBalance(walletA.page);
      walletBInitialBalance = await getBalance(walletB.page);

      console.log(`Wallet A initial balance: ${walletAInitialBalance} sats`);
      console.log(`Wallet B initial balance: ${walletBInitialBalance} sats`);

      // Verify sender has enough funds
      expect(walletAInitialBalance).toBeGreaterThan(sendAmount + 10); // +10 for fees
    });

    // Step 3: Get Spark address from Wallet B
    let sparkAddress: string;

    await test.step('Get Spark address from Wallet B', async () => {
      sparkAddress = await getSparkAddress(walletB.page);
      console.log(`Wallet B Spark address: ${sparkAddress}`);

      // Spark addresses start with 'sp1'
      expect(sparkAddress).toMatch(/^sp1/);
    });

    // Step 4: Send payment from Wallet A to Wallet B
    await test.step('Send payment from Wallet A', async () => {
      await sendPayment(walletA.page, sparkAddress, sendAmount);

      // Verify success
      await expect(walletA.page.getByTestId('payment-success')).toBeVisible();
    });

    // Step 5: Verify balances updated
    await test.step('Verify balance changes', async () => {
      // Refresh Wallet B to see new balance
      await walletB.page.reload();
      await walletB.page.getByTestId('wallet-balance').waitFor({ state: 'visible' });

      // Get new balances (with retries for network sync)
      let walletAFinalBalance: number;
      let walletBFinalBalance: number;

      // Poll for balance updates (network can have delays)
      await expect(async () => {
        walletAFinalBalance = await getBalance(walletA.page);
        walletBFinalBalance = await getBalance(walletB.page);

        // Wallet A should have decreased (sent + fees)
        expect(walletAFinalBalance).toBeLessThan(walletAInitialBalance);

        // Wallet B should have increased
        expect(walletBFinalBalance).toBeGreaterThan(walletBInitialBalance);
      }).toPass({ timeout: 30000 });

      console.log(`Wallet A final balance: ${walletAFinalBalance!} sats`);
      console.log(`Wallet B final balance: ${walletBFinalBalance!} sats`);
    });
  });

  test('transaction appears in both wallets history', async ({
    walletA,
    walletB,
  }) => {
    const sendAmount = 50;

    // Restore wallets
    await walletA.page.goto('/');
    await restoreWallet(walletA.page, walletA.mnemonic);

    await walletB.page.goto('/');
    await restoreWallet(walletB.page, walletB.mnemonic);

    // Get Spark address and send
    const sparkAddress = await getSparkAddress(walletB.page);
    await sendPayment(walletA.page, sparkAddress, sendAmount);

    // Wait for payment to complete
    await expect(walletA.page.getByTestId('payment-success')).toBeVisible();

    // Close any dialogs
    await walletA.page.keyboard.press('Escape');
    await walletB.page.reload();

    // Check transaction list on Wallet A (sender)
    await test.step('Verify transaction in Wallet A history', async () => {
      const transactionList = walletA.page.getByTestId('transaction-item');

      await expect(transactionList.first()).toBeVisible({ timeout: 10000 });

      // Most recent transaction should show the amount
      const firstTransaction = transactionList.first();
      await expect(firstTransaction).toContainText(/\d+/); // Contains a number (the amount)
    });

    // Check transaction list on Wallet B (receiver)
    await test.step('Verify transaction in Wallet B history', async () => {
      const transactionList = walletB.page.getByTestId('transaction-item');

      await expect(transactionList.first()).toBeVisible({ timeout: 10000 });

      // Most recent transaction should show the amount
      const firstTransaction = transactionList.first();
      await expect(firstTransaction).toContainText(/\d+/);
    });
  });

  test('payment fails gracefully with insufficient balance', async ({
    walletA,
  }) => {
    // Restore wallet A
    await walletA.page.goto('/');
    await restoreWallet(walletA.page, walletA.mnemonic);

    // Get current balance
    const balance = await getBalance(walletA.page);

    // Try to send more than we have
    const excessiveAmount = balance + 100000;

    // Open send dialog
    await walletA.page.getByTestId('send-button').click();

    // Use a dummy Spark address
    await walletA.page.getByTestId('payment-input').fill('sp1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
    await walletA.page.getByTestId('continue-button').click();

    // Enter excessive amount
    const amountInput = walletA.page.getByTestId('amount-input');
    if (await amountInput.isVisible({ timeout: 5000 })) {
      await amountInput.fill(excessiveAmount.toString());
      await walletA.page.getByTestId('continue-button').click();
    }

    // Should show error about insufficient funds
    await expect(
      walletA.page.getByText(/insufficient|not enough|balance/i)
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Receive Payment Flows', () => {
  test('generates valid Spark address', async ({ walletA }) => {
    await walletA.page.goto('/');
    await restoreWallet(walletA.page, walletA.mnemonic);

    const sparkAddress = await getSparkAddress(walletA.page);

    // Spark addresses should be valid format
    expect(sparkAddress).toMatch(/^sp1[a-z0-9]+$/);
    expect(sparkAddress.length).toBeGreaterThan(20);
  });

  test('shows QR code in receive dialog', async ({ walletA }) => {
    await walletA.page.goto('/');
    await restoreWallet(walletA.page, walletA.mnemonic);

    // Open receive dialog
    await walletA.page.getByTestId('receive-button').click();

    // Should have a QR code element
    const qrCode = walletA.page.locator('canvas, svg').filter({
      has: walletA.page.locator('[data-testid="qr-code"], [class*="qr"], svg rect'),
    });

    // Alternatively, check for any canvas or image that represents QR
    const qrContainer = walletA.page.getByTestId('qr-code').or(
      walletA.page.locator('[class*="qr"]')
    );

    await expect(qrContainer.first()).toBeVisible({ timeout: 10000 });
  });

  test('copy address button works', async ({ walletA }) => {
    await walletA.page.goto('/');
    await restoreWallet(walletA.page, walletA.mnemonic);

    // Open receive dialog
    await walletA.page.getByTestId('receive-button').click();

    // Find and click copy button
    const copyButton = walletA.page.getByRole('button', { name: /copy/i }).or(
      walletA.page.getByTestId('copy-button')
    );

    if (await copyButton.isVisible({ timeout: 5000 })) {
      await copyButton.click();

      // Should show feedback (toast, "Copied!", etc.)
      await expect(
        walletA.page.getByText(/copied/i)
      ).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Lightning Invoice Payment', () => {
  test.skip('create and pay Lightning invoice between wallets', async ({
    walletA,
    walletB,
  }) => {
    // This test is skipped by default as it requires more complex setup
    // Enable when Lightning invoice generation is implemented in the app

    const invoiceAmount = 100;

    // Restore wallets
    await walletA.page.goto('/');
    await restoreWallet(walletA.page, walletA.mnemonic);

    await walletB.page.goto('/');
    await restoreWallet(walletB.page, walletB.mnemonic);

    // Generate Lightning invoice from Wallet B
    await walletB.page.getByTestId('receive-button').click();
    await walletB.page.getByTestId('lightning-tab').click();

    // Enter amount
    const invoiceAmountInput = walletB.page.getByTestId('invoice-amount-input');
    if (await invoiceAmountInput.isVisible()) {
      await invoiceAmountInput.fill(invoiceAmount.toString());
    }

    // Generate invoice
    await walletB.page.getByRole('button', { name: /generate|create/i }).click();

    // Get the invoice string
    const invoiceText = await walletB.page.getByTestId('lightning-invoice-text').textContent();
    expect(invoiceText).toMatch(/^lnbcrt/); // Regtest invoice prefix

    // Pay from Wallet A
    await sendPayment(walletA.page, invoiceText!);

    // Verify success
    await expect(walletA.page.getByTestId('payment-success')).toBeVisible();
  });
});
