import {
  test,
  expect,
  restoreWallet,
  ensureWalletFunded,
  getBalance,
  generateLightningInvoice,
  sendPayment,
  waitForBalanceChange,
  TIMEOUTS,
} from '../fixtures/dual-wallet';
import { TEST_URLS } from '../constants/urls';
import {
  generatePayments,
  ScenarioPreset,
  DEFAULT_SCENARIO_CONFIG,
} from '../utils/payment-scenario';

const runFullE2E = String(process.env.RUN_FULL_E2E ?? '').toLowerCase();
const shouldRunReleaseSuite = runFullE2E === '1' || runFullE2E === 'true' || runFullE2E === 'yes';

if (!shouldRunReleaseSuite) {
  console.log('[Payment Scenarios] Skipping suite — set RUN_FULL_E2E=1 to enable release-only checks.');
}

const describeReleaseOnly = shouldRunReleaseSuite ? test.describe : test.describe.skip;

describeReleaseOnly('Payment Scenarios', () => {
  test.describe.configure({ mode: 'serial', timeout: TIMEOUTS.BENCHMARK_RUN });

  test('executes seeded payment flow across wallets', async ({ walletA, walletB }) => {
    const parsedCount = Number(process.env.PAYMENT_SCENARIO_COUNT ?? '5');
    const paymentCount = Number.isFinite(parsedCount) && parsedCount > 0 ? Math.floor(parsedCount) : 5;
    const presetEnv = String(process.env.PAYMENT_SCENARIO_PRESET ?? '').toLowerCase();
    const preset = presetEnv === ScenarioPreset.EdgeCases.toLowerCase()
      ? ScenarioPreset.EdgeCases
      : ScenarioPreset.Random;

    const scenarioConfig = {
      ...DEFAULT_SCENARIO_CONFIG,
      paymentCount,
      minDelayMs: 200,
      maxDelayMs: 800,
    } as const;

    console.log('[Payment Scenarios] Using config:', scenarioConfig, 'preset:', preset);
    const payments = generatePayments(scenarioConfig, preset);

    await test.step('Restore and fund sender wallet', async () => {
      await restoreWallet(walletA, walletA.mnemonic);
      await ensureWalletFunded(walletA);
    });

    await test.step('Restore receiver wallet', async () => {
      await walletB.page.goto(TEST_URLS.HOME);
      await restoreWallet(walletB, walletB.mnemonic);
    });

    let senderBalance = await getBalance(walletA.page);
    let receiverBalance = await getBalance(walletB.page);

    await test.step('Execute payments sequentially', async () => {
      for (let index = 0; index < payments.length; index++) {
        const payment = payments[index];
        const label = `Payment ${index + 1}/${payments.length}`;

        await test.step(label, async () => {
          if (payment.delayMs > 0) {
            console.log(`[${label}] Waiting ${payment.delayMs}ms before creating invoice.`);
            await walletA.page.waitForTimeout(payment.delayMs);
          }

          console.log(`[${label}] Generating Lightning invoice for ${payment.amountSats} sats.`);
          const invoice = await generateLightningInvoice(walletB.page, payment.amountSats);
          console.log(`[${label}] Invoice ready: ${invoice.substring(0, 24)}...`);

          console.log(`[${label}] Sending payment from Wallet A.`);
          await sendPayment(walletA.page, invoice);

          const updatedSenderBalance = await waitForBalanceChange(
            walletA.page,
            senderBalance,
            'decrease',
            TIMEOUTS.BALANCE_SYNC,
            { expectedDelta: payment.amountSats },
          );

          const updatedReceiverBalance = await waitForBalanceChange(
            walletB.page,
            receiverBalance,
            'increase',
            TIMEOUTS.BALANCE_SYNC,
            { expectedDelta: payment.amountSats },
          );

          expect(updatedSenderBalance).toBeLessThan(senderBalance);
          expect(updatedReceiverBalance).toBeGreaterThan(receiverBalance);

          senderBalance = updatedSenderBalance;
          receiverBalance = updatedReceiverBalance;
        });
      }
    });
  });
});
