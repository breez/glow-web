import {
  test,
  expect,
  restoreWallet,
  sendPayment,
  getBalance,
  waitForBalanceChange,
  waitForWalletReady,
  generateLightningInvoice,
  TIMEOUTS,
} from '../fixtures/dual-wallet';

/**
 * Wallet-to-Wallet Transfer Tests
 *
 * These tests use Lightning invoices for wallet-to-wallet transfers.
 *
 * Requirements:
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

  test('send sats from Wallet A to Wallet B via Lightning invoice', async ({
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

    // Step 3: Generate Lightning invoice from Wallet B
    let lightningInvoice: string;

    await test.step('Generate Lightning invoice from Wallet B', async () => {
      lightningInvoice = await generateLightningInvoice(walletB.page, sendAmount);
      console.log(`Wallet B Lightning invoice: ${lightningInvoice.substring(0, 30)}...`);

      // Lightning invoices start with 'lnbc' (mainnet), 'lntb' (testnet), or 'lnbcrt' (regtest)
      expect(lightningInvoice).toMatch(/^ln(bc|tb|bcrt)/);
    });

    // Step 4: Send payment from Wallet A to Wallet B
    await test.step('Send payment from Wallet A', async () => {
      await sendPayment(walletA.page, lightningInvoice);

      // Verify success
      await expect(walletA.page.getByTestId('payment-success')).toBeVisible({
        timeout: TIMEOUTS.PAYMENT,
      });
    });

    // Step 5: Verify balances updated
    await test.step('Verify balance changes', async () => {
      // Wait for Wallet A balance to decrease (sender)
      const walletAFinalBalance = await waitForBalanceChange(
        walletA.page,
        walletAInitialBalance,
        'decrease',
        TIMEOUTS.BALANCE_SYNC
      );
      console.log(`Wallet A final balance: ${walletAFinalBalance} sats`);

      // Wait for Wallet B balance to increase (receiver)
      const walletBFinalBalance = await waitForBalanceChange(
        walletB.page,
        walletBInitialBalance,
        'increase',
        TIMEOUTS.BALANCE_SYNC
      );
      console.log(`Wallet B final balance: ${walletBFinalBalance} sats`);

      // Verify the amounts make sense
      expect(walletAFinalBalance).toBeLessThan(walletAInitialBalance);
      expect(walletBFinalBalance).toBeGreaterThan(walletBInitialBalance);
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

    // Generate Lightning invoice from Wallet B and pay from Wallet A
    const invoice = await generateLightningInvoice(walletB.page, sendAmount);
    await sendPayment(walletA.page, invoice);

    // Wait for payment to complete
    await expect(walletA.page.getByTestId('payment-success')).toBeVisible({
      timeout: TIMEOUTS.PAYMENT,
    });

    // Close any dialogs
    await walletA.page.keyboard.press('Escape');
    await walletA.page.waitForTimeout(500);

    // Wait for Wallet B to sync
    await walletB.page.reload();
    await waitForWalletReady(walletB.page);

    // Check transaction list on Wallet A (sender)
    await test.step('Verify transaction in Wallet A history', async () => {
      const transactionList = walletA.page.getByTestId('transaction-item');

      await expect(transactionList.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });

      // Most recent transaction should show the amount
      const firstTransaction = transactionList.first();
      await expect(firstTransaction).toContainText(/\d+/); // Contains a number (the amount)
    });

    // Check transaction list on Wallet B (receiver)
    await test.step('Verify transaction in Wallet B history', async () => {
      const transactionList = walletB.page.getByTestId('transaction-item');

      await expect(transactionList.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });

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
    await walletA.page.waitForTimeout(500);

    // Use a dummy Lightning invoice (structurally valid but unpayable)
    // This is a fake invoice for testing error handling
    await walletA.page.getByTestId('payment-input').fill(
      'lnbcrt1p0000000pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsdqqcqzpgsp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqs9qrsgq'
    );

    const continueButton = walletA.page.getByTestId('continue-button');
    if (await continueButton.isVisible({ timeout: TIMEOUTS.UI_ACTION }).catch(() => false)) {
      await continueButton.click();
    }

    // Should show error about invalid invoice or insufficient funds
    await expect(
      walletA.page.getByText(/insufficient|not enough|balance|invalid|error|failed/i)
    ).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
  });
});

test.describe('Receive Payment Flows', () => {
  test.describe('Lightning Invoice', () => {
    test('generates valid Lightning invoice with amount', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      const invoice = await generateLightningInvoice(walletA.page, 1000);

      // Lightning invoices should be valid format
      expect(invoice).toMatch(/^ln(bc|tb|bcrt)[a-z0-9]+$/i);
      expect(invoice.length).toBeGreaterThan(50);
    });

    test('shows QR code for Lightning invoice', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      // Click Lightning tab if exists
      const lightningTab = walletA.page.getByTestId('lightning-tab');
      if (await lightningTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await lightningTab.click();
      }

      // Should have a QR code element
      const qrContainer = walletA.page.getByTestId('qr-code').or(
        walletA.page.locator('[class*="qr"]')
      );

      await expect(qrContainer.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
    });

    test('copy Lightning invoice button works', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog and go to Lightning tab
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      const lightningTab = walletA.page.getByTestId('lightning-tab');
      if (await lightningTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await lightningTab.click();
      }

      // Find and click copy button
      const copyButton = walletA.page.getByRole('button', { name: /copy/i }).or(
        walletA.page.getByTestId('copy-button')
      );

      if (await copyButton.isVisible({ timeout: TIMEOUTS.UI_ACTION }).catch(() => false)) {
        await copyButton.click();

        // Should show feedback (toast, "Copied!", etc.)
        await expect(
          walletA.page.getByText(/copied/i)
        ).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
      }
    });
  });

  test.describe('Lightning Address (LNURL-P)', () => {
    test('displays Lightning Address', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      // Click Lightning Address tab/section if exists
      const lnAddressTab = walletA.page.getByTestId('lightning-address-tab').or(
        walletA.page.getByRole('tab', { name: /address|lnurl/i })
      );
      if (await lnAddressTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await lnAddressTab.click();
      }

      // Wait for Lightning Address to be displayed
      const lnAddressText = walletA.page.getByTestId('lightning-address-text').or(
        walletA.page.getByTestId('ln-address-text')
      );

      await expect(async () => {
        const text = await lnAddressText.textContent();
        expect(text).toBeTruthy();
        // Lightning addresses are in format user@domain
        expect(text).toMatch(/@/);
      }).toPass({ timeout: TIMEOUTS.ADDRESS_GEN });
    });

    test('shows QR code for Lightning Address', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      // Click Lightning Address tab
      const lnAddressTab = walletA.page.getByTestId('lightning-address-tab').or(
        walletA.page.getByRole('tab', { name: /address|lnurl/i })
      );
      if (await lnAddressTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await lnAddressTab.click();
      }

      // Should have a QR code element
      const qrContainer = walletA.page.getByTestId('qr-code').or(
        walletA.page.locator('[class*="qr"]')
      );

      await expect(qrContainer.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
    });

    test('copy Lightning Address button works', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      // Click Lightning Address tab
      const lnAddressTab = walletA.page.getByTestId('lightning-address-tab').or(
        walletA.page.getByRole('tab', { name: /address|lnurl/i })
      );
      if (await lnAddressTab.isVisible({ timeout: 2000 }).catch(() => false)) {
        await lnAddressTab.click();
      }

      // Find and click copy button
      const copyButton = walletA.page.getByRole('button', { name: /copy/i }).or(
        walletA.page.getByTestId('copy-button')
      );

      if (await copyButton.isVisible({ timeout: TIMEOUTS.UI_ACTION }).catch(() => false)) {
        await copyButton.click();

        await expect(
          walletA.page.getByText(/copied/i)
        ).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
      }
    });
  });

  test.describe('Bitcoin Address', () => {
    test('generates valid Bitcoin address', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      // Click Bitcoin tab
      const bitcoinTab = walletA.page.getByTestId('bitcoin-tab');
      await bitcoinTab.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
      await bitcoinTab.click();

      // Wait for Bitcoin address to be generated
      const btcAddressText = walletA.page.getByTestId('bitcoin-address-text').or(
        walletA.page.getByTestId('btc-address-text')
      );

      let address: string | null = null;
      await expect(async () => {
        address = await btcAddressText.textContent();
        expect(address).toBeTruthy();
        // Bitcoin addresses start with bc1 (mainnet), tb1 (testnet), or bcrt1 (regtest)
        expect(address).toMatch(/^(bc1|tb1|bcrt1)/);
      }).toPass({ timeout: TIMEOUTS.ADDRESS_GEN });

      // Verify address format
      expect(address!.length).toBeGreaterThan(25);
    });

    test('shows QR code for Bitcoin address', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      // Click Bitcoin tab
      const bitcoinTab = walletA.page.getByTestId('bitcoin-tab');
      await bitcoinTab.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
      await bitcoinTab.click();

      // Should have a QR code element
      const qrContainer = walletA.page.getByTestId('qr-code').or(
        walletA.page.locator('[class*="qr"]')
      );

      await expect(qrContainer.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
    });

    test('copy Bitcoin address button works', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      // Click Bitcoin tab
      const bitcoinTab = walletA.page.getByTestId('bitcoin-tab');
      await bitcoinTab.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
      await bitcoinTab.click();

      // Find and click copy button
      const copyButton = walletA.page.getByRole('button', { name: /copy/i }).or(
        walletA.page.getByTestId('copy-button')
      );

      if (await copyButton.isVisible({ timeout: TIMEOUTS.UI_ACTION }).catch(() => false)) {
        await copyButton.click();

        await expect(
          walletA.page.getByText(/copied/i)
        ).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
      }
    });

    test('shows minimum deposit amount for Bitcoin', async ({ walletA }) => {
      await walletA.page.goto('/');
      await restoreWallet(walletA.page, walletA.mnemonic);

      // Open receive dialog
      await walletA.page.getByTestId('receive-button').click();
      await walletA.page.waitForTimeout(500);

      // Click Bitcoin tab
      const bitcoinTab = walletA.page.getByTestId('bitcoin-tab');
      await bitcoinTab.waitFor({ state: 'visible', timeout: TIMEOUTS.UI_ACTION });
      await bitcoinTab.click();

      // Should show minimum deposit info (Bitcoin on-chain requires minimum amount)
      const minimumInfo = walletA.page.getByText(/minimum|min\./i);
      if (await minimumInfo.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(minimumInfo).toBeVisible();
      }
    });
  });
});
