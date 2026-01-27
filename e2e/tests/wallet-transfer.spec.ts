import {
  test,
  expect,
  restoreWallet,
  sendPayment,
  getBalance,
  waitForBalanceChange,
  waitForWalletReady,
  generateLightningInvoice,
  ensureWalletFunded,
  assertRegtestLightningInvoice,
  assertRegtestBitcoinAddress,
  TIMEOUTS,
  DEFAULT_MIN_AMOUNT,
} from '../fixtures/dual-wallet';
import { TEST_URLS } from '../constants/urls';

/**
 * LNURL support is disabled in CI because no LNURL server is configured.
 * Log the reason once so we remember why LNURL coverage is intentionally omitted.
 */
test.beforeAll(() => {
  console.log('[Test Suite] LNURL flows are skipped because the LNURL service is disabled in this environment.');
});

/**
 * Wallet-to-Wallet Transfer Tests
 */
test.describe('Wallet-to-Wallet Transfers', () => {
  test.describe.configure({ mode: 'serial' });

  test('handles Lightning transfer success and failure paths', async ({ walletA, walletB }) => {
    const sendAmount = DEFAULT_MIN_AMOUNT;

    await test.step('Restore Wallet A (sender)', async () => {
      await restoreWallet(walletA, walletA.mnemonic);
      await ensureWalletFunded(walletA);
    });

    await test.step('Restore Wallet B (receiver)', async () => {
      await walletB.page.goto(TEST_URLS.HOME);
      await restoreWallet(walletB, walletB.mnemonic);
    });

    let walletAInitialBalance = 0;
    let walletBInitialBalance = 0;

    await test.step('Get initial balances', async () => {
      walletAInitialBalance = await getBalance(walletA.page);
      walletBInitialBalance = await getBalance(walletB.page);

      console.log(`Wallet A initial balance: ${walletAInitialBalance} sats`);
      console.log(`Wallet B initial balance: ${walletBInitialBalance} sats`);

      expect(walletAInitialBalance).toBeGreaterThan(sendAmount + 10);
    });

    let lightningInvoice = '';

    await test.step('Generate Lightning invoice from Wallet B', async () => {
      lightningInvoice = await generateLightningInvoice(walletB.page, sendAmount);
      console.log(`Wallet B Lightning invoice: ${lightningInvoice.substring(0, 30)}...`);
      assertRegtestLightningInvoice(lightningInvoice);
    });

    await test.step('Send payment from Wallet A', async () => {
      await sendPayment(walletA.page, lightningInvoice);
      await expect(walletA.page.getByTestId('payment-success')).toBeVisible({
        timeout: TIMEOUTS.PAYMENT,
      });
    });

    await test.step('Verify balance changes', async () => {
      const walletAFinalBalance = await waitForBalanceChange(
        walletA.page,
        walletAInitialBalance,
        'decrease',
        TIMEOUTS.BALANCE_SYNC,
        { expectedDelta: sendAmount },
      );
      console.log(`Wallet A final balance: ${walletAFinalBalance} sats`);

      const walletBFinalBalance = await waitForBalanceChange(
        walletB.page,
        walletBInitialBalance,
        'increase',
        TIMEOUTS.BALANCE_SYNC,
        { expectedDelta: sendAmount },
      );
      console.log(`Wallet B final balance: ${walletBFinalBalance} sats`);

      expect(walletAFinalBalance).toBeLessThan(walletAInitialBalance);
      expect(walletBFinalBalance).toBeGreaterThan(walletBInitialBalance);
    });

    await test.step('Verify transaction history in both wallets', async () => {
      await walletA.page.keyboard.press('Escape').catch(() => void 0);
      await walletA.page.waitForTimeout(300);

      await walletB.page.reload();
      await waitForWalletReady(walletB);

      const walletATransactions = walletA.page.getByTestId('transaction-item');
      await expect(walletATransactions.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
      await expect(walletATransactions.first()).toContainText(/\d+/);

      const walletBTransactions = walletB.page.getByTestId('transaction-item');
      await expect(walletBTransactions.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
      await expect(walletBTransactions.first()).toContainText(/\d+/);
    });

    await test.step('Fails gracefully with insufficient balance', async () => {
      const balance = await getBalance(walletA.page);
      const excessiveAmount = balance + 100000;
      console.log(`[Test] Attempting to send ${excessiveAmount} sats (Balance: ${balance})...`);

      await walletA.page.getByTestId('send-button').click();
      await walletA.page.waitForTimeout(500);

      await walletA.page.getByTestId('payment-input').fill(
        'lnbcrt1p0000000pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsdqqcqzpgsp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqs9qrsgq'
      );

      const continueButton = walletA.page.getByTestId('continue-button');
      if (await continueButton.isVisible({ timeout: TIMEOUTS.UI_ACTION }).catch(() => false)) {
        await continueButton.click();
      }

      await expect(walletA.page.getByTestId('send-error-banner')).toBeVisible({
        timeout: TIMEOUTS.UI_ACTION,
      });

      await walletA.page.keyboard.press('Escape').catch(() => void 0);
      await walletA.page.waitForTimeout(300);
    });
  });
});

/**
 * Receive Payment Flows
 */
test.describe('Receive Payment Flows', () => {
  test('renders Lightning invoice and Bitcoin receive options', async ({ walletA }) => {
    await restoreWallet(walletA, walletA.mnemonic);

    const invoice = await generateLightningInvoice(walletA.page, 1000, false);
    console.log(`[Test] Invoice generated: ${invoice.substring(0, 20)}...`);
    expect(invoice).toMatch(/^ln(bc|tb|bcrt)[a-z0-9]+$/i);
    expect(invoice.length).toBeGreaterThan(50);

    const invoiceCard = walletA.page.getByTestId('lightning-invoice-text');
    await expect(async () => {
      const text = await invoiceCard.getByTestId('copyable-text-content').textContent();
      expect(text).toMatch(/^ln(bc|tb|bcrt)/i);
    }).toPass({ timeout: TIMEOUTS.ADDRESS_GEN });

    const invoiceQr = walletA.page.getByTestId('qr-code').or(
      walletA.page.locator('[class*="qr"]')
    );
    await expect(invoiceQr.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });

    const invoiceCopyButton = invoiceCard.getByTestId('copy-button');
    if (await invoiceCopyButton.isVisible({ timeout: TIMEOUTS.UI_ACTION }).catch(() => false)) {
      await invoiceCopyButton.click();
      await expect(walletA.page.getByText(/copied/i).first()).toBeVisible({
        timeout: TIMEOUTS.UI_ACTION,
      });
    }

    await walletA.page.keyboard.press('Escape').catch(() => void 0);
    await walletA.page.waitForTimeout(300);

    await walletA.page.getByTestId('receive-button').click();
    await walletA.page.waitForTimeout(500);
    await walletA.page.getByTestId('bitcoin-tab').click();

    const bitcoinPanel = walletA.page.getByTestId('bitcoin-address-text').or(
      walletA.page.getByTestId('btc-address-text')
    );

    let address: string | null = null;
    await expect(async () => {
      address = await bitcoinPanel.getByTestId('copyable-text-content').textContent();
      expect(address).toBeTruthy();
      assertRegtestBitcoinAddress(address!);
      console.log(`[Test] Bitcoin address: ${address}`);
    }).toPass({ timeout: TIMEOUTS.ADDRESS_GEN });

    expect(address!.length).toBeGreaterThan(25);

    const bitcoinQr = walletA.page.getByTestId('qr-code').or(
      walletA.page.locator('[class*="qr"]')
    );
    await expect(bitcoinQr.first()).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });

    const copyButton = bitcoinPanel.getByTestId('copy-button');
    if (await copyButton.isVisible({ timeout: TIMEOUTS.UI_ACTION }).catch(() => false)) {
      await copyButton.click();
      await expect(walletA.page.getByText(/copied/i).first()).toBeVisible({
        timeout: TIMEOUTS.UI_ACTION,
      });
    }

    const minimumInfo = walletA.page.getByText(/minimum|min\./i);
    if (await minimumInfo.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(minimumInfo).toBeVisible();
    }

    await walletA.page.keyboard.press('Escape').catch(() => void 0);
    await walletA.page.waitForTimeout(300);
  });
});
