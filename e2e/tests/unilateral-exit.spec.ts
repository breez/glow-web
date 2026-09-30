import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, Page } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';
import {
  addressBalanceSats,
  isBitcoindReachable,
  decodeRawTx,
  isUnspent,
  minesOnlyOnRequest,
  mineBlocks,
  newAddress,
  tipHeight,
} from '../utils/bitcoind';
import { outspend, txConfirmed, waitFor } from '../utils/esplora';
import { freshMnemonic, fundWallet } from '../utils/fund';
import { willReceiveSat } from '../../src/features/unilateral-exit/driver';
import { deriveFundingKey } from '../../src/features/unilateral-exit/funding';

import {
  blocksToNextStep,
  blocksToProgress,
  driveWizardToTracker,
  nodesConfirmed,
  openUnilateralExit,
  openWallet,
  storedArchive,
  storedPlan,
} from '../utils/exitWizard';

/**
 * Unilateral exit against a local Spark environment, mining only on request:
 * see e2e/README.md. Without the environment the file skips rather than fails.
 *
 * An exit consumes every leaf the wallet has, so each test funds its own before
 * it runs.
 */

// A phrase per test, so an exit never inherits leaves a previous one left.
let MNEMONIC = '';

// The direct refund sits this far behind the cpfp one, and the operators'
// watchtower publishes it as soon as it matures. Mining short of it leaves the
// app's own refund the only one that can go out.
const DIRECT_REFUND_OFFSET = 50;
const EXIT_TIMEOUT = 12 * 60_000;
// The SSP pays a claim out as several leaves, so the exit fans out rather than
// taking the single-branch path.
const DEPOSIT_SATS = 200_000;
const driveToCompletion = async (page: Page): Promise<void> => {
  const complete = page.getByTestId('unilateral-exit-complete');
  // Each pass mines to the nearest timelock, or a block when none is pending,
  // plus a poll interval, so this is minutes of patience: the last step to
  // confirm is the sweep, and the app only calls the exit done once a check has
  // seen it. A wallet's refunds mature apart, since each transfer of a leaf
  // takes 100 blocks off its refund's timelock.
  for (let pass = 0; pass < 60; pass++) {
    if (await complete.isVisible().catch(() => false)) return;
    await mineBlocks(await blocksToProgress(page, await tipHeight()));
    await page.waitForTimeout(6_000);
  }
  if (await complete.isVisible().catch(() => false)) return;
  const plan = await storedPlan(page);
  const refusals = plan?.refusals ?? {};
  const stuck = (plan?.exit.transactions ?? [])
    .map(t => `${t.kind} ${t.txid.slice(0, 12)} ${t.status.type}${refusals[t.txid] ? ` (${refusals[t.txid]})` : ''}`)
    .join('\n  ');
  // Who actually spent each leaf, and is that spend itself spent? This is the
  // state the sdk's scan reads when it decides adopted-versus-swept.
  const nodes = (plan?.exit.transactions ?? []).filter(t => t.kind === 'node');
  const chainState: string[] = [];
  for (const node of nodes) {
    const spend = await outspend(node.txid, 0).catch(e => ({ error: String(e) }));
    const spender = (spend as { txid?: string }).txid;
    const onward = spender
      ? JSON.stringify(await outspend(spender, 0).catch(e => ({ error: String(e) })))
      : 'n/a';
    chainState.push(
      `node ${node.txid.slice(0, 12)} -> ${JSON.stringify(spend)} | spender confirmed=${
        spender ? await txConfirmed(spender) : 'n/a'
      } onward=${onward}`,
    );
  }
  // Decode whatever could not be broadcast and check each of its inputs: the
  // rejection names no outpoint, so this is the only way to see which one.
  const badInputs: string[] = [];
  for (const tx of (plan?.exit.transactions ?? []).filter(t => refusals[t.txid])) {
    for (const [label, hex] of [
      ['parent', tx.txHex],
      ['child', tx.cpfpTxHex],
    ] as const) {
      if (!hex) continue;
      const decoded = await decodeRawTx(hex).catch(() => null);
      for (const vin of decoded?.vin ?? []) {
        badInputs.push(
          `${tx.kind} ${label} spends ${vin.txid.slice(0, 12)}:${vin.vout} unspent=${await isUnspent(
            vin.txid,
            vin.vout,
          ).catch(() => 'error')}`,
        );
      }
    }
  }
  throw new Error(
    `exit never reached the sweep. plan:\n  ${stuck}\nchain:\n  ${chainState.join(
      '\n  ',
    )}\nfailed tx inputs:\n  ${badInputs.join('\n  ')}`,
  );
};

const txidsOfKind = async (page: Page, kind: string): Promise<string[]> => {
  const plan = await storedPlan(page);
  return (plan?.exit.transactions ?? []).filter(t => t.kind === kind).map(t => t.txid);
};

const refundTxids = (page: Page): Promise<string[]> => txidsOfKind(page, 'refund');
const nodeTxids = (page: Page): Promise<string[]> => txidsOfKind(page, 'node');

test.describe('Unilateral exit', () => {
  // Funding reads the deposit address off the receive sheet's copy button.
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test.beforeAll(async () => {
    test.skip(!process.env.SPARK_CONFIG_PATH, 'needs SPARK_CONFIG_PATH, to run the app on a local Spark environment');
    test.skip(!(await isBitcoindReachable()), 'needs a local Spark environment');
    test.skip(
      !(await minesOnlyOnRequest()),
      'needs the local Spark environment mining only on request: make local-env-block-interval SECONDS=0',
    );
  });

  // Its own wallet, funded from scratch: leaves survive a failed exit, so a
  // shared one would grow a longer exit with every run.
  test.beforeEach(async () => {
    test.setTimeout(EXIT_TIMEOUT);
    MNEMONIC = process.env.TEST_EXIT_MNEMONIC ?? freshMnemonic();
  });

  test('exits the balance on-chain, driving itself to the sweep', async ({ page }) => {
    test.setTimeout(EXIT_TIMEOUT);

    const destination = await newAddress('e2e-exit-destination');
    // Streamed to disk as well as memory: a run that hangs still leaves evidence.
    const logPath = 'test-results/sdk-console.log';
    mkdirSync('test-results', { recursive: true });
    writeFileSync(logPath, '');
    const sdkLog: string[] = [];
    page.on('console', m => {
      const text = m.text();
      if (
        /check_unilateral_exit|resolve_exit_check|resolve_funding|resolve_exit_chain_state|unilateral_exit:|prepare_unilateral_exit|read the exit back|broadcast recovery/.test(
          text,
        )
      ) {
        const line = text.slice(0, 400);
        sdkLog.push(line);
        appendFileSync(logPath, `${line}\n`);
      }
    });
    await openWallet(page, MNEMONIC);
    await fundWallet(page, DEPOSIT_SATS);
    await openUnilateralExit(page);

    await test.step('intro says what the exit asks of the user', async () => {
      await expect(page.getByRole('heading', { name: 'What you need' })).toBeVisible();
    });

    const quoted = await driveWizardToTracker(page, destination, MNEMONIC);
    test.skip(quoted === null, 'wallet holds no leaves worth exiting');

    // What the app tells the user they will get. It drifted three ways before:
    // the quote's estimate, a figure derived from a rebuilt plan's remaining
    // fee, then what actually landed. The quote and the tracker must agree.
    const built = await storedPlan(page);
    expect(built).not.toBeNull();
    const promised = willReceiveSat(built!);
    expect(promised).toBe(quoted);

    await test.step('repeated passes settle instead of re-sending', async () => {
      // The driver reads the exit back every few seconds. It is the set built
      // once that gets driven, so the transactions must not move under it.
      const before = await refundTxids(page);
      expect(before.length).toBeGreaterThan(0);

      await page.waitForTimeout(20_000);

      expect(await refundTxids(page)).toEqual(before);
      const plan = await storedPlan(page);
      expect(plan?.refusals).toEqual({});
    });

    await test.step('our own refund confirms when only its timelock has passed', async () => {
      // Exactly the cpfp refund's timelock: the watchtower's copy needs another
      // DIRECT_REFUND_OFFSET blocks, so it cannot be the one that lands.
      const ours = await refundTxids(page);

      // The refund clocks only start once their node is on-chain, so the number
      // of blocks left is not knowable until then.
      await waitFor(
        async () => {
          await mineBlocks(1);
          return nodesConfirmed(page);
        },
        done => done,
        { timeoutMs: 90_000, everyMs: 4_000, what: 'the leaf transactions to confirm' },
      );
      await mineBlocks(await blocksToNextStep(page, await tipHeight()));

      // A block per poll: the driver needs one to notice the timelock matured
      // and another to confirm what it then broadcasts. Bounded well short of
      // DIRECT_REFUND_OFFSET so the watchtower's copy never matures here.
      await waitFor(
        async () => {
          await mineBlocks(1);
          return (await Promise.all(ours.map(txConfirmed))).some(Boolean);
        },
        landed => landed,
        { timeoutMs: 60_000, everyMs: 4_000, what: 'one of our own refunds to confirm' },
      );
    });

    await test.step('the figure does not move once the refunds are out', async () => {
      // Broadcasting the refunds used to rebuild the exit and drop the figure,
      // because it was read from a sweep that could still be replaced.
      const now = willReceiveSat((await storedPlan(page))!);
      expect(now).toBe(promised);
    });

    await test.step('tracker drives the rest to the sweep', async () => {
      try {
        await driveToCompletion(page);
      } catch (e) {
        throw new Error(`${(e as Error).message}\n\nlast sdk lines:\n  ${sdkLog.slice(-12).join('\n  ')}`);
      }
    });

    await test.step('the funds are on-chain at the destination', async () => {
      const balance = await addressBalanceSats(destination);
      if (balance === 0) {
        // Where did the refunds go, if not to the destination?
        const fate = await Promise.all(
          (await refundTxids(page)).map(async txid => {
            const spend = await outspend(txid, 0).catch(e => ({ error: String(e) }));
            return `${txid.slice(0, 12)} confirmed=${await txConfirmed(txid)} spend=${JSON.stringify(spend)}`;
          }),
        );
        const plan = await storedPlan(page);
        const rows = (plan?.exit.transactions ?? [])
          .map(t => `${t.kind} ${t.txid.slice(0, 12)} ${t.status.type}`)
          .join('\n  ');
        throw new Error(
          `destination empty. our refunds:\n  ${fate.join('\n  ')}\nfinal plan:\n  ${rows}\nlast sdk:\n  ${sdkLog.slice(-6).join('\n  ')}`,
        );
      }
      expect(balance).toBeGreaterThan(0);
    });

    // The numbers the app puts in front of the user, checked against the chain.
    // Both directions have been wrong before: an estimate that promised more
    // than the balance, and a tracker figure that disagreed with what landed.
    await test.step('what the app promised matches what arrived', async () => {
      const balance = await addressBalanceSats(destination);

      // The figure is the balance less the sweep's fee, funding treated as spent.
      // That makes it a floor: the sweep also collects the change its fee-paying
      // children left, and then more arrives than was promised. Under it, never
      // over.
      const funded = built!.exit.fundingInputs.reduce((sum, input) => sum + input.value, 0);
      expect(balance).toBeGreaterThanOrEqual(promised);
      expect(balance).toBeLessThanOrEqual(promised + funded);

      // The exit is archived with what actually landed, which is the figure the
      // wallet list then shows.
      const [archived] = await storedArchive(page);
      expect(archived?.deliveredSat).toBe(balance);
      expect(archived?.exitFeePaidSat).toBe(built!.quotedExitFeeSat);
      expect(archived?.exitFeeAddress).toBe(deriveFundingKey(MNEMONIC, 'regtest', 0).address);

      // The exit cost something, so it is not silently a no-op. Against balance
      // plus funding, since the funding can arrive too.
      expect(balance).toBeLessThan(built!.exit.recoverableValueSat + funded);
    });
  });

  test('a refund the watchtower publishes counts as progress', async ({ page, context }) => {
    test.setTimeout(EXIT_TIMEOUT);

    const destination = await newAddress('e2e-watchtower-destination');
    await openWallet(page, MNEMONIC);
    await fundWallet(page, DEPOSIT_SATS);
    await openUnilateralExit(page);

    const quoted = await driveWizardToTracker(page, destination, MNEMONIC);
    test.skip(quoted === null, 'wallet holds no leaves worth exiting');

    const ours = await refundTxids(page);
    const nodes = await nodeTxids(page);

    // The leaves have to reach the chain before any refund clock starts, so the
    // app stays open until they do.
    await waitFor(
      async () => {
        await mineBlocks(1);
        return nodesConfirmed(page);
      },
      done => done,
      { timeoutMs: 90_000, everyMs: 4_000, what: 'the leaf transactions to confirm' },
    );
    const blocks = await blocksToNextStep(page, await tipHeight());

    await test.step('the chain moves past both timelocks with the app closed', async () => {
      // Closed, so the app cannot broadcast its own copy first. The watchtower
      // runs on the operators and does not care that nobody is watching.
      await page.close();
      await mineBlocks(blocks + DIRECT_REFUND_OFFSET + 1);
    });

    await test.step('a refund we did not broadcast spends the leaf', async () => {
      // Each leaf's node output is spent by whichever refund lands. A spender
      // that is not in our plan is the watchtower's own copy.
      const foreign = await waitFor(
        async () => {
          for (const node of nodes) {
            const spend = await outspend(node, 0);
            if (spend.spent && spend.txid && !ours.includes(spend.txid)) return spend.txid;
          }
          return null;
        },
        value => value !== null,
        { timeoutMs: 180_000, what: "the watchtower's refund to confirm" },
      );
      expect(ours).not.toContain(foreign);
    });

    const resumed = await context.newPage();
    await test.step('reopening treats it as done, not as a failure', async () => {
      await openWallet(resumed, MNEMONIC);
      await openUnilateralExit(resumed);
      await expect(resumed.getByTestId('unilateral-exit-tracker')).toBeVisible({
        timeout: TIMEOUTS.PAYMENT,
      });
      // The leaf the watchtower took is settled: nothing is left in error over it.
      await expect(resumed.getByText('Nothing is worth exiting right now')).toHaveCount(0);
      await driveToCompletion(resumed);
      expect(await addressBalanceSats(destination)).toBeGreaterThan(0);
    });

    await test.step("the finished exit's details show what the exit fee address still holds", async () => {
      // With the watchtower's refund landing first, part of the exit fee goes
      // unspent and stays at its address rather than reaching the destination.
      const unspent = await addressBalanceSats(deriveFundingKey(MNEMONIC, 'regtest', 0).address);
      await resumed.getByTestId('unilateral-exit-complete').click();
      await expect(resumed.getByTestId('unilateral-exit-details')).toBeVisible();
      const row = resumed.getByText('Unspent Exit Fee');
      if (unspent > 0) await expect(row).toBeVisible({ timeout: TIMEOUTS.UI_ACTION });
      else await expect(row).toHaveCount(0);
    });
  });
});
