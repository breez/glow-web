// THROWAWAY: use case (1) for ?recovermock, a unilateral exit the user started.
// The real exit page wherever seeding the engine reaches the state, the exit
// sheet's frame around today's steps elsewhere, all on DEV_EXIT's figures.
// Funds found after the exit landed take use case (2)'s Recover Funds flow.
// Funds the exit itself strands (ux-13) stay inside it.
// The shot registries export records of components; fast refresh does not matter here.
/* eslint-disable react-refresh/only-export-components */
import React, { useState } from 'react';
import type {
  PrepareUnilateralExitResponse,
  UnilateralExitResponse,
  UnilateralExitTransaction,
} from '@breeztech/breez-sdk-spark';
import UnilateralExitPage from '@/pages/UnilateralExitPage';
import { ArchivedExitDialog } from '@/features/unilateral-exit/ArchivedExitDialog';
import type { ArchivedExit } from '@/features/unilateral-exit/archive';
import {
  cooperativeValueSat,
  quotedSweepFeeSat,
  willReceiveSat,
  type PendingExit,
} from '@/features/unilateral-exit/driver';
import { quoteFiguresOf, type FeeChoice } from '@/features/unilateral-exit/hooks/useUnilateralExitFlow';
import { FeeStep } from '@/features/unilateral-exit/steps/FeeStep';
import { QuoteStep } from '@/features/unilateral-exit/steps/QuoteStep';
import { blocked, coin, confirmed, locked, plan, prepared, ready, sdk as exitSdk, tx } from '@/features/unilateral-exit/testFixtures';
import { BALANCE_SATS, COSIGNED, COSIGNED_TXIDS, DESTINATION, DEV_EXIT, EXIT_FEE_ADDRESS, FEE_RATES, MOVED, NETWORK } from './fixtures';
import { Destination, MockSheet, WithShare, devQuote, sheetShots } from './sheet';
import {
  COOPERATIVE,
  FOUND,
  afterCosigned,
  cosignedLeaves,
  historyPayments,
  keepCosigned,
  mockChain,
  seedArchive,
  seedPending,
  seedPlan,
  type WalletScene,
} from './wallet';

const noop = () => {};

const TIP_HEIGHT = 915_000;
/** A refund's CSV delay; the node transactions confirmed 3 blocks ago, so ~5 days are left. */
const REFUND_CSV_BLOCKS = 700;
const NODES_CONFIRMED_AT = TIP_HEIGHT - 3;
const DAY_SEC = 86_400;
const USER_SWEEP_TXID = '3b9f0c2e7d41a8f65c0e92b7d14a3f8e6b25c90d7a1e4f3b8c62d09e5a7f1c34';
const ALL_SWEEP_TXID = '9d2a6c1f84e07b35a9c2d61e0f4b87a3c5e19d06b2f7a48c13e5d90b6a2f7c48';
// What the recover-funds API adds to today's types beside the leaf method and
// transaction kind: the co-signed recoveries' own fee, the watchtower part included.
type Leaves = PrepareUnilateralExitResponse['leaves'];
const balanceLeaves = DEV_EXIT.leaves.map(leaf => ({ ...leaf, method: 'unilateral' }));
const withCooperativeFee = <T extends PrepareUnilateralExitResponse | UnilateralExitResponse>(base: T): T =>
  ({ ...base, cooperativeFeeSats: COSIGNED.networkFeeSat }) as T;

/** Saved at the fee screen of ux-04's quote, owing its whole exit fee. No mode: the user started it. */
const userPending: PendingExit = {
  network: NETWORK,
  destination: DESTINATION,
  feeRateSatPerVbyte: FEE_RATES.medium,
  fundingAddressIndex: 0,
  fundingAddress: EXIT_FEE_ADDRESS,
  required: { sat: DEV_EXIT.exitFeeSat, inputs: 1 },
  willReceiveSat: willReceiveSat(devQuote),
};

interface BalanceOptions {
  nodesAt?: number;
  /** A refund's CSV delay by leaf id, REFUND_CSV_BLOCKS when absent. */
  csv?: Record<string, number>;
  /** A leaf here leaves by that co-signed transaction instead of a refund. */
  cosigned?: Record<string, UnilateralExitTransaction>;
}

/** The balance's node transactions confirmed, the refunds waiting out their timelock, the sweep behind them. */
const balanceTransactions = (
  sweepTxid: string,
  { nodesAt = NODES_CONFIRMED_AT, csv = {}, cosigned = {} }: BalanceOptions = {},
): UnilateralExitTransaction[] => {
  const nodes = DEV_EXIT.leaves.map((_, i) =>
    tx({ txid: `node-${i + 1}`, kind: 'node', nodeId: `node-${i + 1}`, status: confirmed(nodesAt) }),
  );
  const exits = DEV_EXIT.leaves.map((leaf, i) => {
    const csvBlocks = csv[leaf.leafId] ?? REFUND_CSV_BLOCKS;
    return (
      cosigned[leaf.leafId] ??
      tx({
        txid: `refund-${i + 1}`,
        kind: 'refund',
        nodeId: leaf.leafId,
        dependsOn: [`node-${i + 1}`],
        csvTimelockBlocks: csvBlocks,
        status: locked(nodesAt + csvBlocks),
      })
    );
  });
  const refunds = exits.filter(t => t.kind === 'refund');
  const sweep = tx({ txid: sweepTxid, kind: 'sweep', dependsOn: refunds.map(r => r.txid), status: blocked });
  return [...nodes, ...exits, sweep];
};

/** The exit under way. */
const userPlan = plan(balanceTransactions(USER_SWEEP_TXID), {
  network: NETWORK,
  destination: DESTINATION,
  feeRateSatPerVbyte: FEE_RATES.medium,
  quotedSweepFeeSat: DEV_EXIT.sweepFeeSat,
  quotedExitFeeSat: DEV_EXIT.exitFeeSat,
  exit: { leaves: DEV_EXIT.leaves, recoverableValueSat: DEV_EXIT.balanceSat },
});

/** The same exit landed a day ago: the sweep paid out what the quote said. */
const userExit: ArchivedExit = {
  id: USER_SWEEP_TXID,
  destination: DESTINATION,
  deliveredSat: willReceiveSat(devQuote),
  completedAt: Date.now() - DAY_SEC * 1000,
  network: NETWORK,
  exitedSat: DEV_EXIT.balanceSat,
  exitFeePaidSat: DEV_EXIT.exitFeeSat,
  exitFeeAddress: EXIT_FEE_ADDRESS,
};

/**
 * Selection `all` with the co-signed funds found: the balance and those funds
 * in one quote, the co-signed recoveries' fee reported apart from the sweep's.
 * They join only while the operators answer. When the operators are down,
 * recoverFunds hands them back in `failed` and the exit moves the balance alone.
 */
const allQuote = withCooperativeFee(
  prepared({
    leaves: [...balanceLeaves, ...cosignedLeaves] as Leaves,
    recoverableValueSat: DEV_EXIT.proposed.fundsSat,
    sweepFeeSat: DEV_EXIT.sweepFeeSat,
    singleUtxoFundingSat: DEV_EXIT.exitFeeSat,
    totalFeeSat: DEV_EXIT.proposed.networkFeeSat + DEV_EXIT.exitFeeSat,
    feeRateSatPerVbyte: FEE_RATES.medium,
    destination: DESTINATION,
  }),
);

/** ux-11's quote saved at the fee screen: the same exit fee, the co-signed funds in what arrives. */
const allPending: PendingExit = { ...userPending, willReceiveSat: willReceiveSat(allQuote) };

/**
 * ux-11's exit under way, at ux-07's moment. The co-signed recoveries went out
 * with the node transactions and have confirmed; the refunds wait on their timelock.
 */
const allPlan = plan(
  [
    ...COSIGNED_TXIDS.map((txid, i) =>
      tx({ txid, kind: COOPERATIVE, nodeId: `cosigned-${i + 1}`, status: confirmed(NODES_CONFIRMED_AT) }),
    ),
    ...balanceTransactions(ALL_SWEEP_TXID),
  ],
  {
    network: NETWORK,
    destination: DESTINATION,
    feeRateSatPerVbyte: FEE_RATES.medium,
    quotedSweepFeeSat: quotedSweepFeeSat(allQuote, null),
    quotedExitFeeSat: DEV_EXIT.exitFeeSat,
    exit: {
      leaves: allQuote.leaves,
      recoverableValueSat: DEV_EXIT.proposed.fundsSat,
      cooperativeFeeSats: COSIGNED.networkFeeSat,
    } as Partial<UnilateralExitResponse>,
  },
);

/** ux-11's exit landed a day ago, as archiveExit records it. */
const allExit: ArchivedExit = {
  id: ALL_SWEEP_TXID,
  destination: DESTINATION,
  deliveredSat: willReceiveSat(allQuote),
  completedAt: Date.now() - DAY_SEC * 1000,
  network: NETWORK,
  exitedSat: DEV_EXIT.proposed.fundsSat,
  recoverableFundsSat: cooperativeValueSat(allQuote),
  exitFeePaidSat: DEV_EXIT.exitFeeSat,
  exitFeeAddress: EXIT_FEE_ADDRESS,
};

// ux-13: the user's own exit stalled, and the watchtower moved its 58 202 leaf
// on-chain, where only an operator co-sign recovers it. The exit takes it back
// itself: no Recoverable Funds row, no kept recovery, one row throughout.
// Leaf-3's refund has the shortest timelock, so its watchtower copy (the e2e
// spec's DIRECT_REFUND_OFFSET behind it) is the only one to mature, at TIP_HEIGHT.
const MOVED_REFUND_CSV_BLOCKS = 100;
const DIRECT_REFUND_OFFSET = 50;
const OWN_NODES_AT = TIP_HEIGHT - MOVED_REFUND_CSV_BLOCKS - DIRECT_REFUND_OFFSET;
/** ux-13a: the update went out after the move, and its co-signed transaction has confirmed since. */
const UPDATED_TIP = TIP_HEIGHT + 30;
const MOVED_CONFIRMED_AT = TIP_HEIGHT + 10;
const OWN_SWEEP_TXID = '6e1b9d4a2f07c83e5b6a1d92f0c47e8b3a5d16f29c0e7b4a8d3f15c62e9a0b71';
const UPDATED_SWEEP_TXID = 'f2c84a1e6d93b057c2e8a4f1d6b39c0e7a52d18f4b6c9e03a7d15f82c4e6b9a3';
const MOVED_TXID = `c5${'3f'.repeat(31)}`;

const ownMeta = {
  network: NETWORK,
  destination: DESTINATION,
  feeRateSatPerVbyte: FEE_RATES.medium,
  quotedSweepFeeSat: DEV_EXIT.sweepFeeSat,
  quotedExitFeeSat: DEV_EXIT.exitFeeSat,
};
const ownTimeline = { nodesAt: OWN_NODES_AT, csv: { [MOVED.leafId]: MOVED_REFUND_CSV_BLOCKS } };

/** The exit as it stood when the leaf moved. */
const movedBeforePlan = plan(balanceTransactions(OWN_SWEEP_TXID, ownTimeline), {
  ...ownMeta,
  exit: { leaves: DEV_EXIT.leaves, recoverableValueSat: DEV_EXIT.balanceSat },
});

/**
 * The next check sees the leaf move, and reports leaf-3's own refund as matured
 * since the app last ran. A passkey wallet keeps no phrase on the device, so the
 * update cannot run by itself and the pass leaves the exit on redo, as the
 * engine does in the app, with the tip it read.
 */
const maturedAtTip = (t: UnilateralExitTransaction): UnilateralExitTransaction =>
  t.status.type === 'waitingForTimelock' && (t.status.spendableAtHeight ?? Infinity) <= TIP_HEIGHT
    ? { ...t, status: ready }
    : t;
const divergedSdk = exitSdk({
  checkUnilateralExit: async ({ exit }) => ({
    exit: { ...exit, transactions: exit.transactions.map(maturedAtTip) },
    verdict: { type: 'redo', reason: 'onChainStateDiverged' },
  }),
});

/**
 * After the update: rebuildExit names the plan's leaves, Specific quotes the
 * moved one co-signed, and that transaction has confirmed. rebuildExit holds
 * the exit to the rebuilt sweep fee plus the cooperative fee, which tops the
 * first quote's 3 200: what arrives drops by the watchtower's 955.
 */
const movedPlan = plan(
  balanceTransactions(UPDATED_SWEEP_TXID, {
    ...ownTimeline,
    cosigned: {
      [MOVED.leafId]: tx({
        txid: MOVED_TXID,
        kind: COOPERATIVE,
        nodeId: MOVED.leafId,
        status: confirmed(MOVED_CONFIRMED_AT),
      }),
    },
  }),
  {
    ...ownMeta,
    quotedSweepFeeSat: MOVED.sweepFeeSat + MOVED.cooperativeFeeSats,
    exit: {
      leaves: DEV_EXIT.leaves.map(leaf => ({
        ...leaf,
        method: leaf.leafId === MOVED.leafId ? 'cooperative' : 'unilateral',
      })),
      recoverableValueSat: DEV_EXIT.balanceSat,
      sweepFeeSat: MOVED.sweepFeeSat,
      cooperativeFeeSats: MOVED.cooperativeFeeSats,
    } as Partial<UnilateralExitResponse>,
  },
);

/**
 * That exit landed a day ago, one entry for all of it. No `recoverableFundsSat`:
 * the moved leaf was part of the balance it exited. archiveExit would record
 * 58 202 there today, and quoteFiguresOf would split a re-quote the same way:
 * both read the co-signed method off the leaf, not where the leaf came from.
 */
const movedExit: ArchivedExit = {
  id: UPDATED_SWEEP_TXID,
  destination: DESTINATION,
  deliveredSat: MOVED.deliveredSat,
  completedAt: Date.now() - DAY_SEC * 1000,
  network: NETWORK,
  exitedSat: DEV_EXIT.balanceSat,
  exitFeePaidSat: DEV_EXIT.exitFeeSat,
  exitFeeAddress: EXIT_FEE_ADDRESS,
};

const ExitPage: React.FC = () => <UnilateralExitPage network={NETWORK} onBack={noop} onFinished={noop} />;

const Fee: React.FC = () => {
  const [feeChoice, setFeeChoice] = useState<FeeChoice>('medium');
  return (
    <FeeStep feeRates={FEE_RATES} feeChoice={feeChoice} effectiveFeeRate={FEE_RATES[feeChoice]} onSelect={setFeeChoice} />
  );
};

/** QuoteStep with the figures the flow hook derives, on shot 01's balance. */
const Quote: React.FC<{ quote: PrepareUnilateralExitResponse }> = ({ quote }) => (
  <QuoteStep quote={quote} {...quoteFiguresOf(quote, null, BALANCE_SATS)} isQuoting={false} error={null} />
);

export const exitShots: Record<string, React.FC> = {
  'ux-01-intro': ExitPage,

  // The page's own steps past the intro hold their place in component state, so these use its frame.
  'ux-02-destination': () => (
    <MockSheet title="Unilateral Exit" back destination cta="Continue">
      <Destination />
    </MockSheet>
  ),

  'ux-03-fee': () => (
    <MockSheet title="Unilateral Exit" back cta="Get Quote">
      <Fee />
    </MockSheet>
  ),

  'ux-04-quote': () => (
    <MockSheet title="Unilateral Exit" back cta="Continue">
      <Quote quote={devQuote} />
    </MockSheet>
  ),

  'ux-05-pending-owed': () => (
    <WithShare>
      <ExitPage />
    </WithShare>
  ),

  'ux-06-pending-funded': ExitPage,

  'ux-07-tracker': ExitPage,

  // The Recoverable Funds row after the exit opens use case (2)'s flow: shots 02 to 05.
  'ux-09a-recover-destination': sheetShots['02-destination'],
  'ux-09b-recover-fee': sheetShots['03-fee-cosigned'],
  'ux-09c-recover-review': sheetShots['04-review-cosigned'],
  'ux-09d-recover-sent': sheetShots['05-sent'],

  'ux-10-archived-dialog': () => <ArchivedExitDialog exit={userExit} onClose={noop} chain={mockChain()} />,

  'ux-11-intro-with-recoverable': ExitPage,

  'ux-11-quote-with-recoverable': () => (
    <MockSheet title="Unilateral Exit" back cta="Continue">
      <Quote quote={allQuote} />
    </MockSheet>
  ),

  'ux-11a-pending-with-recoverable': () => (
    <WithShare>
      <ExitPage />
    </WithShare>
  ),

  'ux-11b-tracker-with-recoverable': ExitPage,

  'ux-11c-archived-with-recoverable': () => <ArchivedExitDialog exit={allExit} onClose={noop} chain={mockChain()} />,

  'ux-13a-tracker-after-update': ExitPage,

  'ux-13b-update-needed': ExitPage,

  'ux-13d-archived-details': () => <ArchivedExitDialog exit={movedExit} onClose={noop} chain={mockChain()} />,
};

/** Nothing saved and nothing recoverable: the wallet as today's exit starts from it. */
const beforeExit: WalletScene = { recoverableFundsSats: 0 };

/**
 * The exit's nodes are on-chain, so its leaves have left the balance and count
 * in getInfo's total until the sweep confirms. The plan hides the row: it takes
 * in nothing new, so funds found meanwhile surface once it lands (ux-09).
 */
const exitRunning: WalletScene = {
  recoverableFundsSats: BALANCE_SATS,
  balanceSats: 0,
  seed: seedPlan(userPlan, TIP_HEIGHT),
};

/**
 * Funds found after the exit landed: the row joins the exit's own group. The
 * total leaves out a finished exit once a check has read it back and a sync
 * has recomputed it.
 */
const afterExitRecoverable: WalletScene = {
  recoverableFundsSats: COSIGNED.totalSat,
  balanceSats: 0,
  seed: seedArchive([userExit]),
};

/** Recovered as shot 06 is: Glow keeps the recovery, whose row sits above the exit's in its group. */
const afterExitRecovered: WalletScene = {
  ...afterCosigned,
  balanceSats: 0,
  seed: () => {
    keepCosigned();
    seedArchive([userExit])();
  },
};

/**
 * ux-11's exit counts the co-signed part in its own row and tracker. Those
 * recoveries confirmed and a check read them back, so the total holds only the
 * balance's leaves until the sweep confirms, and the plan hides the row.
 */
const allRunning: WalletScene = {
  recoverableFundsSats: BALANCE_SATS,
  balanceSats: 0,
  seed: seedPlan(allPlan, TIP_HEIGHT),
};
const allLanded: WalletScene = { recoverableFundsSats: 0, balanceSats: 0, seed: seedArchive([allExit]) };

/**
 * ux-13's exit keeps its one row, "Transactions in progress" or "Update needed".
 * The co-signed transaction is the exit's own, so nothing else is listed. The
 * history drops its on-chain deposit, so the exit's is the only BTC Transfer.
 */
const movedWallet: WalletScene = {
  recoverableFundsSats: 0,
  balanceSats: 0,
  history: () => historyPayments().filter(payment => payment.method !== 'deposit'),
};
// Its leaves count in the total until the sweep confirms; the plan hides the row.
const movedRunning: WalletScene = { ...movedWallet, recoverableFundsSats: BALANCE_SATS, seed: seedPlan(movedPlan, UPDATED_TIP) };
const movedRedo: WalletScene = {
  ...movedWallet,
  recoverableFundsSats: BALANCE_SATS,
  seed: () => {
    // passkeyService's key: its presence is what makes this a passkey wallet.
    localStorage.setItem('passkeyLabel', 'Default');
    seedPlan(movedBeforePlan, TIP_HEIGHT, divergedSdk)();
  },
};
const movedLanded: WalletScene = { ...movedWallet, seed: seedArchive([movedExit]) };

/** The wallet page behind each shot. */
export const exitScenes: Record<string, WalletScene> = {
  'ux-01-intro': beforeExit,
  'ux-02-destination': beforeExit,
  'ux-03-fee': beforeExit,
  'ux-04-quote': beforeExit,
  'ux-05-pending-owed': { recoverableFundsSats: 0, seed: seedPending(userPending) },
  'ux-06-pending-funded': {
    recoverableFundsSats: 0,
    seed: seedPending(userPending, [coin(DEV_EXIT.exitFeeSat, true)]),
  },
  'ux-07-tracker': exitRunning,
  'ux-08-wallet-exit-running': exitRunning,
  'ux-09-wallet-after-exit-recoverable': afterExitRecoverable,
  'ux-09a-recover-destination': afterExitRecoverable,
  'ux-09b-recover-fee': afterExitRecoverable,
  'ux-09c-recover-review': afterExitRecoverable,
  'ux-09d-recover-sent': afterExitRecovered,
  'ux-09e-wallet-after-recover': afterExitRecovered,
  'ux-10-archived-dialog': afterExitRecoverable,
  // Nothing is saved yet, so the user has not started an exit: the list behind
  // the sheet still heads the row Recovery (use case 2). The fee screen saves
  // the exit and moves it into the Unilateral Exit group (ux-11a).
  // Found by sync before the unilateral exit starts, so the row is already in the list.
  'ux-11-intro-with-recoverable': FOUND,
  'ux-11-quote-with-recoverable': FOUND,
  // The saved exit hides the row: its start re-quotes every leaf and takes the funds in.
  'ux-11a-pending-with-recoverable': { recoverableFundsSats: COSIGNED.totalSat, seed: seedPending(allPending) },
  'ux-11b-tracker-with-recoverable': allRunning,
  'ux-11c-archived-with-recoverable': allLanded,
  'ux-11d-wallet-running': allRunning,
  'ux-11e-wallet-landed': allLanded,
  'ux-13a-tracker-after-update': movedRunning,
  'ux-13b-update-needed': movedRedo,
  // The redo card makes 13b's sheet tall enough to cover the row, so the row gets its own shot.
  'ux-13b2-wallet-update-needed': movedRedo,
  'ux-13c-wallet-landed': movedLanded,
  'ux-13d-archived-details': movedLanded,
};
