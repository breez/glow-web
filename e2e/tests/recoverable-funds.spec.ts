import { test, expect, type Page } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';
import {
  addressBalanceSats,
  holdTransaction,
  isBitcoindReachable,
  mempoolTxids,
  mineBlocks,
  newAddress,
  releaseTransaction,
  sendSats,
  tipHeight,
} from '../utils/bitcoind';
import { txConfirmed, waitFor } from '../utils/esplora';
import { openUnilateralExit, openWallet, storedPlan } from '../utils/exitWizard';
import { freshMnemonic, fundTestWallet, isFundingReachable } from '../utils/fund';
import {
  amountOnItsWay,
  amountUnder,
  closeSheet,
  detailSat,
  detailsSubtitle,
  exitLeaf,
  expectAfterSync,
  fakeFeeRates,
  giveRecoverableFunds,
  hasDocker,
  keptRecoveryTxid,
  mineToFinish,
  openFinishedDetails,
  quoteAtSlowRate,
  quoteRecovery,
  renewedLeaf,
  sat,
  setOperators,
  storedPending,
  storedRecoveries,
  waitForIndexer,
} from '../utils/recoverable';

/**
 * Recover Funds against a local cluster, one case of
 * docs/recoverable-funds-testing.md per test. Each test has the cluster move
 * funds of a fresh wallet out of Spark, so none inherits another's leaves.
 */

const SHORT = 6 * 60_000;
const LONG = 15 * 60_000;

// The regtest Spark address of the docs' test phrase: valid, but not on-chain.
const SPARK_ADDRESS = 'sparkrt1pgss9hl8n9t387qxx0mmy2mhghayx622asq2qazvg093330mftkj5m7lyy9kgz';

const reviewFigure = (page: Page): Promise<number> => amountUnder(page, "You'll receive");

/** The Unilateral Exit wizard to its tracker, paying the exit fee it asks for. */
async function startUnilateralExit(page: Page, destination: string): Promise<void> {
  await openUnilateralExit(page);
  await page.getByTestId('unilateral-exit-start').click();
  await page.getByPlaceholder('bc1q...').fill(destination);
  await page.getByTestId('unilateral-exit-destination-continue').click();
  await quoteAtSlowRate(page);
  await page.getByTestId('unilateral-exit-quote-continue').click({ timeout: TIMEOUTS.BALANCE_SYNC });
  const fee = await amountUnder(page, 'Send from another wallet');
  const pending = await storedPending(page);
  await sendSats(pending!.fundingAddress, fee);
  await mineBlocks(1);
  await page.getByTestId('unilateral-exit-start-exit').click({ timeout: TIMEOUTS.BALANCE_SYNC });
  await expect(page.getByTestId('unilateral-exit-tracker')).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
}

test.describe('Recoverable funds', () => {
  test.beforeAll(async () => {
    test.skip(!(await isBitcoindReachable()), 'needs a local regtest cluster');
    test.skip(!(await isFundingReachable()), 'needs regtest:up serving the scenario endpoints');
  });

  test('2a: the row offers funds outside the balance, and hides beside a pending recovery', async ({ page }) => {
    test.setTimeout(SHORT);
    await giveRecoverableFunds(page, freshMnemonic(), ['exit-fee']);
    const row = page.getByTestId('recoverable-funds-entry');
    await expect(row).toContainText('Recoverable Funds');
    await expect(row).toContainText(sat(150_000));
    await expect(row).toContainText('Tap to recover');
    await expect(page.getByRole('heading', { name: /^recovery$/i })).toBeVisible();

    await test.step('a pending recovery takes its place', async () => {
      await quoteRecovery(page, await newAddress('e2e-recover-2a'));
      await page.getByTestId('unilateral-exit-quote-continue').click({ timeout: TIMEOUTS.BALANCE_SYNC });
      await expect(page.getByText('Send from another wallet')).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
      await closeSheet(page);
      await expect(page.getByTestId('unilateral-exit-entry')).toContainText('Waiting for exit fee');
      await expect(row).toHaveCount(0);
    });

    await test.step('cancelling it offers the funds again', async () => {
      await page.getByTestId('unilateral-exit-entry').click();
      await page.getByRole('button', { name: 'Advanced' }).click();
      await page.getByText('Cancel recovery', { exact: true }).click();
      await expect(row).toContainText('Tap to recover', { timeout: TIMEOUTS.UI_ACTION });
      await expect(page.getByTestId('unilateral-exit-entry')).toHaveCount(0);
    });
  });

  test('2b: a co-signed recovery goes out at once and lands', async ({ page }) => {
    test.setTimeout(SHORT);
    await giveRecoverableFunds(page, freshMnemonic(), ['cosigned']);
    const destination = await newAddress('e2e-recover-2b');

    await test.step('the address field takes only an on-chain address', async () => {
      await page.getByTestId('recoverable-funds-entry').click();
      await expect(page.getByRole('heading', { name: 'Recover Funds' })).toBeVisible();
      const next = page.getByTestId('unilateral-exit-destination-continue');
      await expect(next).toBeDisabled();
      await page.getByPlaceholder('bc1q...').fill(SPARK_ADDRESS);
      await next.click();
      await expect(page.getByText('That is not an on-chain Bitcoin address')).toBeVisible();
      await page.getByPlaceholder('bc1q...').fill(destination);
      await next.click();
    });

    await quoteAtSlowRate(page);
    const promised = await reviewFigure(page);
    await test.step('the review', async () => {
      for (const label of ['To address', 'Funds', 'Network fee']) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(page.getByTestId('unilateral-exit-quote-continue')).toHaveText('Recover Funds');
    });

    await test.step('Recover Funds sends it', async () => {
      await page.getByTestId('unilateral-exit-quote-continue').click();
      await expect(page.getByRole('heading', { name: 'Funds sent' })).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
      expect(await amountOnItsWay(page)).toBe(promised);
      await page.getByTestId('unilateral-exit-sent-done').click();
      const sent = page.getByTestId('recovery-entry');
      await expect(sent).toContainText('BTC Transfer');
      await expect(sent).toContainText('Waiting for a confirmation');
      await expect(page.getByTestId('recoverable-funds-entry')).toHaveCount(0);
    });

    await test.step('one block lands it', async () => {
      await mineBlocks(1);
      await expect(page.getByTestId('unilateral-exit-complete')).toContainText('BTC Transfer', {
        timeout: TIMEOUTS.BALANCE_SYNC,
      });
      await expect(page.getByTestId('recovery-entry')).toHaveCount(0);
      const details = await openFinishedDetails(page);
      await expect(detailsSubtitle(page, 'Recovery')).toBeVisible();
      expect(await detailSat(details, 'Funds Recovered')).toBe(200_000);
      expect(await detailSat(details, 'Received')).toBe(promised);
      expect(await addressBalanceSats(destination)).toBe(promised);
    });
  });

  test('2c: a recovery that needs an exit fee waits for it, then runs to the end', async ({ page }) => {
    test.setTimeout(LONG);
    await giveRecoverableFunds(page, freshMnemonic(), ['exit-fee']);
    const destination = await newAddress('e2e-recover-2c');

    await quoteRecovery(page, destination);
    const promised = await reviewFigure(page);
    await test.step('the review asks for the exit fee', async () => {
      await expect(page.getByText('Exit fee', { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          'To start the recovery you need to pay the exit fee from another wallet. These are the mining fees that move your funds on-chain, which takes several days.',
        ),
      ).toBeVisible();
      await expect(page.getByTestId('unilateral-exit-quote-continue')).toHaveText('Continue');
    });

    await page.getByTestId('unilateral-exit-quote-continue').click();
    const fee = await amountUnder(page, 'Send from another wallet');
    const feeAddress = (await storedPending(page))!.fundingAddress;
    const row = page.getByTestId('unilateral-exit-entry');
    await test.step('the pending screen asks for it', async () => {
      expect(fee).toBeGreaterThan(0);
      await expect(page.locator('.qr-container svg')).toBeVisible();
      await expect(page.getByTestId('unilateral-exit-funding-address').getByTestId('copy-button')).toBeVisible();
      await expect(page.getByTestId('unilateral-exit-pending-status')).toHaveText('Waiting for your payment');
      await page.getByRole('button', { name: 'Advanced' }).click();
      for (const label of ['Save exit data', 'Restore exit data', 'Cancel recovery']) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(row).toContainText('Waiting for exit fee');
      await expect(row).toContainText(`Send ${sat(fee)} to start`);
      await expect(page.getByTestId('recoverable-funds-entry')).toHaveCount(0);
    });

    await test.step('an unconfirmed payment shows as sent', async () => {
      await sendSats(feeAddress, fee);
      await expect(page.getByRole('heading', { name: 'Exit fee sent' })).toBeVisible({ timeout: TIMEOUTS.BALANCE_SYNC });
      await expect(page.getByTestId('unilateral-exit-pending-status')).toHaveText('Waiting for a confirmation');
      await expect(
        page.getByText('You can close this. Come back to start the recovery once the fee confirms.'),
      ).toBeVisible();
      await expect(row).toContainText('Exit fee sent');
      await expect(row).toContainText('Waiting for a confirmation');
    });

    await test.step('once it confirms, the user starts the recovery', async () => {
      await mineBlocks(1);
      await expect(row).toContainText('Exit fee received', { timeout: TIMEOUTS.BALANCE_SYNC });
      await expect(row).toContainText('Tap to start');
      const start = page.getByTestId('unilateral-exit-start-exit');
      await expect(start).toHaveText('Recover Funds');
      await start.click();
      await expect(page.getByTestId('unilateral-exit-tracker')).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
      await expect(page.getByText('You can close this. Open Glow regularly until the recovery finishes.')).toBeVisible();
    });

    await test.step("mined so Glow's refund lands, the review figure arrives", async () => {
      await mineToFinish(page);
      const details = await openFinishedDetails(page);
      await expect(detailsSubtitle(page, 'Recovery')).toBeVisible();
      await expect(details.getByText('Funds Recovered', { exact: true })).toBeVisible();
      expect(await detailSat(details, 'Exit Fee Paid')).toBe(fee);
      const received = await detailSat(details, 'Received');
      expect(received).toBe(await addressBalanceSats(destination));
      // The review counts the exit fee as spent, and what the fee-paying
      // children left of it reaches the destination too. So never less than promised.
      expect(received).toBeGreaterThanOrEqual(promised);
      expect(received).toBeLessThanOrEqual(promised + fee);
      expect(await addressBalanceSats(feeAddress)).toBe(0);
      await expect(details.getByText('Unspent Exit Fee', { exact: true })).toHaveCount(0);
    });
  });

  test('2e: the co-signed part goes out first, and the rest waits for the exit fee', async ({ page }) => {
    test.setTimeout(SHORT);
    await giveRecoverableFunds(page, freshMnemonic(), ['cosigned', 'exit-fee']);
    const destination = await newAddress('e2e-recover-2e');

    await quoteRecovery(page, destination);
    await reviewFigure(page);
    const split = page.getByText(/goes to this address now/);
    await test.step('the review splits what goes now from what waits', async () => {
      await expect(page.getByTestId('recoverable-funds-entry')).toContainText(sat(350_000));
      for (const label of ['Funds', 'Network fee', 'Exit fee']) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(split).toHaveText(
        /^₿[\d ]+ goes to this address now\. The other ₿[\d ]+ needs the exit fee from another wallet, then takes several days\.$/,
      );
      await expect(page.getByTestId('unilateral-exit-quote-continue')).toHaveText('Recover Funds');
    });
    const now = Number((await split.innerText()).split('goes to')[0].replace(/\D/g, ''));

    await test.step('Recover Funds sends the co-signed part and asks for the rest', async () => {
      await page.getByTestId('unilateral-exit-quote-continue').click();
      await expect(page.getByText('Send from another wallet')).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
      const sent = page.getByTestId('recovery-entry');
      await expect(sent).toContainText('BTC Transfer');
      await expect(sent).toContainText('Waiting for a confirmation');
      const pending = page.getByTestId('unilateral-exit-entry');
      await expect(pending).toContainText('Waiting for exit fee');
      await expect(pending).toContainText(sat(150_000));
    });

    await test.step('the co-signed part lands on its own', async () => {
      await mineBlocks(1);
      await expect(page.getByTestId('unilateral-exit-complete')).toContainText('BTC Transfer', {
        timeout: TIMEOUTS.BALANCE_SYNC,
      });
      await expect(page.getByTestId('unilateral-exit-entry')).toContainText('Waiting for exit fee');
      expect(await addressBalanceSats(destination)).toBe(now);
    });
  });

  test('2f: funds the fee would eat are not offered', async ({ page }) => {
    test.setTimeout(SHORT);
    await giveRecoverableFunds(page, freshMnemonic(), ['cosigned']);
    await fakeFeeRates(page, 50_000);
    await quoteRecovery(page, await newAddress('e2e-recover-2f-fees'));
    await expect(page.getByText('Nothing is worth recovering right now')).toBeVisible({ timeout: TIMEOUTS.BALANCE_SYNC });
    await expect(
      page.getByText(
        'At this fee rate these funds would cost more to move on-chain than they are worth. Try a lower fee rate, or wait for the network to get cheaper.',
      ),
    ).toBeVisible();
    await expect(page.getByTestId('unilateral-exit-quote-continue')).toHaveCount(0);
  });

  test("2f: funds the watchtower took from a leaf renewed once can't be recovered", async ({ page }) => {
    test.setTimeout(SHORT);
    await giveRecoverableFunds(page, freshMnemonic(), ['unrecoverable']);
    const destination = await newAddress('e2e-recover-2f-stopped');

    await test.step('Glow gives the operators six blocks to relabel them', async () => {
      await quoteRecovery(page, destination);
      await expect(page.getByText('Nothing can be recovered right now')).toBeVisible({ timeout: TIMEOUTS.BALANCE_SYNC });
      await expect(page.getByText('Try again later.')).toBeVisible();
      await closeSheet(page);
    });

    await test.step('then lets them go', async () => {
      const tip = await tipHeight();
      await mineBlocks(6);
      await waitForIndexer(tip + 6);
      // The indexer lets the browser cache its tip for 10 seconds, and the
      // quote dates the stop by the tip it reads.
      await page.waitForTimeout(11_000);
      await quoteRecovery(page, destination);
      await expect(page.getByText('Nothing left to recover')).toBeVisible({ timeout: TIMEOUTS.BALANCE_SYNC });
      await expect(page.getByText("These funds can't be recovered.")).toBeVisible();
      await closeSheet(page);
      await expect(page.getByTestId('recoverable-funds-entry')).toHaveCount(0);
    });
  });

  test('2g: a co-signed recovery held out of blocks is rebuilt at a higher fee', async ({ page }) => {
    test.setTimeout(SHORT);
    await giveRecoverableFunds(page, freshMnemonic(), ['cosigned']);
    const destination = await newAddress('e2e-recover-2g');
    await quoteRecovery(page, destination);
    await reviewFigure(page);
    await page.getByTestId('unilateral-exit-quote-continue').click();
    await expect(page.getByRole('heading', { name: 'Funds sent' })).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
    await page.getByTestId('unilateral-exit-sent-done').click();

    const held = await keptRecoveryTxid(page);
    const ownRate = (await storedRecoveries(page))[0].feeRateSatPerVbyte;
    await waitFor(mempoolTxids, txids => txids.includes(held), { what: 'the recovery to reach the mempool' });
    await holdTransaction(held);
    try {
      await test.step('held, it stays unconfirmed', async () => {
        await mineBlocks(2);
        expect(await mempoolTxids()).toContain(held);
        await expect(page.getByTestId('recovery-entry')).toContainText('Waiting for a confirmation');
      });

      let raised = 0;
      await test.step('Rebuild at a higher fee replaces it', async () => {
        await page.getByTestId('recovery-entry').click();
        await page.getByRole('button', { name: 'Advanced' }).click();
        await page.getByText('Rebuild at a higher fee', { exact: true }).click();
        // The rates start above the recovery's own, or the network refuses the replacement.
        const slow = page.getByRole('button', { name: /^Slow/ });
        await expect(slow).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
        expect(Number((await slow.innerText()).replace(/\D/g, ''))).toBeGreaterThan(ownRate);
        await quoteAtSlowRate(page);
        await reviewFigure(page);
        const resend = page.getByTestId('unilateral-exit-quote-continue');
        await expect(resend).toHaveText('Continue Recovery');
        await resend.click();
        await expect(page.getByRole('heading', { name: 'Fee raised' })).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
        raised = await amountOnItsWay(page);
        await page.getByTestId('unilateral-exit-sent-done').click();
      });

      await test.step('the replacement lands', async () => {
        const replacement = await waitFor(
          () => keptRecoveryTxid(page),
          txid => txid !== held,
          { what: 'the replacement to be kept' },
        );
        await waitFor(mempoolTxids, txids => txids.includes(replacement), {
          what: 'the replacement to reach the mempool',
        });
        await mineBlocks(1);
        await expect(page.getByTestId('unilateral-exit-complete')).toContainText('BTC Transfer', {
          timeout: TIMEOUTS.BALANCE_SYNC,
        });
        expect(await txConfirmed(replacement)).toBe(true);
        expect(await addressBalanceSats(destination)).toBe(raised);
      });
    } finally {
      await releaseTransaction(held);
    }
  });

  test('Case 1: a leaf the watchtower takes mid-exit comes back inside the exit', async ({ page, context }) => {
    test.setTimeout(LONG);
    const mnemonic = freshMnemonic();
    const destination = await newAddress('e2e-recover-case1');

    await fundTestWallet(mnemonic, 200_000, 2);
    const leaf = await renewedLeaf(mnemonic, 200_000, 2);
    await openWallet(page, mnemonic);
    // The exit has to start with the renewed leaf in it, so the app claims all three first.
    await expectAfterSync(page, page.getByTestId('wallet-balance'), '600 000');
    await exitLeaf('parent-exit', leaf);
    await startUnilateralExit(page, destination);
    await expect(page.getByText('You can close this. Open Glow regularly until the exit finishes.')).toBeVisible();
    const built = await storedPlan(page);
    expect(built?.exit.leaves.map(l => l.leafId)).toContain(leaf);
    const feeAddress = built!.exitFeeAddress!;

    await test.step('the watchtower takes the leaf while Glow is closed', async () => {
      // Every leaf transaction waits on the fan-out, so with Glow closed once
      // it is out, nothing beats the watchtower to the leaf.
      const fanOut = built!.exit.transactions.find(t => t.kind === 'fanOut');
      expect(fanOut).toBeDefined();
      await waitFor(mempoolTxids, txids => txids.includes(fanOut!.txid), {
        timeoutMs: 60_000,
        what: 'the fan-out to go out',
      });
      await page.close();
      expect((await exitLeaf('watchtower-exit', leaf)).status).toBe('WATCHTOWER_EXITED');
    });

    const resumed = await context.newPage();
    await openWallet(resumed, mnemonic);
    await test.step('Glow rebuilds the exit by itself, with the leaf co-signed', async () => {
      const row = resumed.getByTestId('unilateral-exit-entry');
      await row.click();
      await expect(resumed.getByTestId('unilateral-exit-tracker')).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
      await waitFor(
        () => storedPlan(resumed),
        plan => !!plan?.exit.transactions.some(t => t.kind === 'cooperative'),
        { timeoutMs: 3 * 60_000, everyMs: 3_000, what: 'the rebuild to take the leaf in as co-signed' },
      );
      await expect(resumed.getByText('Some of your funds were moved on-chain to keep them safe.')).toHaveCount(0);
      await expect(resumed.getByTestId('unilateral-exit-rebuild')).toHaveCount(0);
      await expect(row).toContainText('Transactions in progress');
      await expect(row).toContainText(/\d+ of \d+ processed/);
      await expect(resumed.getByTestId('recoverable-funds-entry')).toHaveCount(0);
    });

    await test.step('mined to the end, it lands as one exit', async () => {
      await mineToFinish(resumed);
      await expect(resumed.getByTestId('recoverable-funds-entry')).toHaveCount(0);
      const details = await openFinishedDetails(resumed);
      await expect(detailsSubtitle(resumed, 'Unilateral Exit')).toBeVisible();
      for (const label of ['Received', 'Balance Exited', 'Exit Fee Paid']) {
        await expect(details.getByText(label, { exact: true })).toBeVisible();
      }
      expect(await detailSat(details, 'Received')).toBe(await addressBalanceSats(destination));
      // Whatever was left at the exit fee address went to the destination before the exit was archived.
      expect(await addressBalanceSats(feeAddress)).toBe(0);
      await expect(details.getByText('Unspent Exit Fee', { exact: true })).toHaveCount(0);
    });
  });

  test('operators down after the quote: the recovery fails, and Recover Funds tries again', async ({ page }) => {
    test.skip(!hasDocker(), 'needs docker to stop the gRPC-web proxy');
    test.setTimeout(SHORT);
    await giveRecoverableFunds(page, freshMnemonic(), ['cosigned']);
    await quoteRecovery(page, await newAddress('e2e-recover-outage'));
    await reviewFigure(page);
    const recover = page.getByTestId('unilateral-exit-quote-continue');

    try {
      await setOperators('down');
      await recover.click();
      await expect(page.getByText('Could not recover the funds')).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
      await expect(page.getByText('Please try again.', { exact: true })).toBeVisible();
      // Glow's own words, so nothing folds under Details.
      await expect(page.getByTestId('unilateral-exit-recover-error')).toHaveCount(0);
      await expect(recover).toHaveText('Recover Funds');
    } finally {
      await setOperators('up');
    }

    await recover.click();
    await expect(page.getByRole('heading', { name: 'Funds sent' })).toBeVisible({ timeout: TIMEOUTS.PAYMENT });
  });
});
