// THROWAWAY: ux-13 for ?recovermock, a unilateral exit the user started whose
// leaf the watchtower moved. The exit takes it back itself: no Recoverable Funds
// row, no kept recovery, one row throughout. The real exit page wherever seeding
// the engine reaches the state.
// The shot registries export records of components; fast refresh does not matter here.
/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import type { RecoverFundsLeaf, RecoveryTransaction } from '@breeztech/breez-sdk-spark';
import UnilateralExitPage from '@/pages/UnilateralExitPage';
import { ArchivedExitDialog } from '@/features/unilateral-exit/ArchivedExitDialog';
import type { ArchivedExit } from '@/features/unilateral-exit/archive';
import { quotedSweepFeeSat, willReceiveSat } from '@/features/unilateral-exit/quote';
import { blocked, confirmed, locked, plan, prepared, ready, sdk as exitSdk, tx } from '@/features/unilateral-exit/testFixtures';
import { BALANCE_SATS, DESTINATION, DEV_EXIT, EXIT_FEE_ADDRESS, FEE_RATES, MOVED, NETWORK } from './fixtures';
import { COOPERATIVE, historyPayments, mockChain, seedArchive, seedPlan, type WalletScene } from './wallet';

const noop = () => {};

const TIP_HEIGHT = 915_000;
const DAY_SEC = 86_400;
// Leaf-3's refund has the shortest timelock, so its watchtower copy (the e2e
// spec's DIRECT_REFUND_OFFSET behind it) is the only one to mature, at TIP_HEIGHT.
const REFUND_CSV_BLOCKS = 700;
const MOVED_REFUND_CSV_BLOCKS = 100;
const DIRECT_REFUND_OFFSET = 50;
const OWN_NODES_AT = TIP_HEIGHT - MOVED_REFUND_CSV_BLOCKS - DIRECT_REFUND_OFFSET;
/** ux-13a: the update went out after the move, and its co-signed transaction has confirmed since. */
const UPDATED_TIP = TIP_HEIGHT + 30;
const MOVED_CONFIRMED_AT = TIP_HEIGHT + 10;
const OWN_SWEEP_TXID = '6e1b9d4a2f07c83e5b6a1d92f0c47e8b3a5d16f29c0e7b4a8d3f15c62e9a0b71';
const UPDATED_SWEEP_TXID = 'f2c84a1e6d93b057c2e8a4f1d6b39c0e7a52d18f4b6c9e03a7d15f82c4e6b9a3';
const MOVED_TXID = `c5${'3f'.repeat(31)}`;

/** The balance's node transactions confirmed, the refunds waiting out their timelock, the sweep behind them. */
const balanceTransactions = (
  sweepTxid: string,
  cosigned: Record<string, RecoveryTransaction> = {},
): RecoveryTransaction[] => {
  const nodes = DEV_EXIT.leaves.map((_, i) =>
    tx({ txid: `node-${i + 1}`, kind: 'node', nodeId: `node-${i + 1}`, status: confirmed(OWN_NODES_AT) }),
  );
  const exits = DEV_EXIT.leaves.map((leaf, i) => {
    const csvBlocks = leaf.leafId === MOVED.leafId ? MOVED_REFUND_CSV_BLOCKS : REFUND_CSV_BLOCKS;
    return (
      cosigned[leaf.leafId] ??
      tx({
        txid: `refund-${i + 1}`,
        kind: 'refund',
        nodeId: leaf.leafId,
        dependsOn: [`node-${i + 1}`],
        csvTimelockBlocks: csvBlocks,
        status: locked(OWN_NODES_AT + csvBlocks),
      })
    );
  });
  const refunds = exits.filter(t => t.kind === 'refund');
  const sweep = tx({ txid: sweepTxid, kind: 'sweep', dependsOn: refunds.map(r => r.txid), status: blocked });
  return [...nodes, ...exits, sweep];
};

const ownMeta = {
  network: NETWORK,
  destination: DESTINATION,
  feeRateSatPerVbyte: FEE_RATES.medium,
  quotedExitFeeSat: DEV_EXIT.exitFeeSat,
};

/** The exit as it stood when the leaf moved. */
const movedBeforePlan = plan(balanceTransactions(OWN_SWEEP_TXID), {
  ...ownMeta,
  quotedSweepFeeSat: DEV_EXIT.sweepFeeSats,
  exit: { leaves: DEV_EXIT.leaves, recoverableValueSats: BALANCE_SATS },
});

/**
 * The next check sees the leaf move, and reports leaf-3's own refund as matured
 * since the app last ran. A passkey wallet keeps no phrase on the device, so the
 * update cannot run by itself and the pass leaves the exit on redo, as the
 * engine does in the app, with the tip it read.
 */
const maturedAtTip = (t: RecoveryTransaction): RecoveryTransaction =>
  t.status.type === 'waitingForTimelock' && (t.status.spendableAtHeight ?? Infinity) <= TIP_HEIGHT
    ? { ...t, status: ready }
    : t;

/** What rebuildExit's `specific` re-quote returns: the moved leaf co-signed, the sweep one input lighter. */
const movedLeaves: RecoverFundsLeaf[] = DEV_EXIT.leaves.map(leaf => ({
  ...leaf,
  method: leaf.leafId === MOVED.leafId ? 'cooperative' : 'unilateral',
}));
// Refunds are left, so the update has an exit fee to sign for: on a passkey
// wallet the pass can only wait for the tap.
const movedQuote = prepared({
  leaves: movedLeaves,
  recoverableValueSats: BALANCE_SATS,
  sweepFeeSats: MOVED.sweepFeeSats,
  cooperativeFeeSats: MOVED.cooperativeFeeSats,
});
const divergedSdk = exitSdk({
  checkRecoverFunds: async ({ recovery }) => ({
    recovery: { ...recovery, transactions: recovery.transactions.map(maturedAtTip) },
    verdict: { type: 'redo', reason: 'onChainStateDiverged' },
  }),
  prepareRecoverFunds: async () => movedQuote,
});

/**
 * After the update: the moved leaf's co-signed transaction has confirmed.
 * rebuildExit holds the exit to the rebuilt sweep fee plus the cooperative fee,
 * which tops the first quote's: what arrives drops by the watchtower's 955.
 */
const movedPlan = plan(
  balanceTransactions(UPDATED_SWEEP_TXID, {
    [MOVED.leafId]: tx({ txid: MOVED_TXID, kind: COOPERATIVE, nodeId: MOVED.leafId, status: confirmed(MOVED_CONFIRMED_AT) }),
  }),
  {
    ...ownMeta,
    quotedSweepFeeSat: quotedSweepFeeSat(movedQuote, movedBeforePlan),
    exit: {
      leaves: movedLeaves,
      recoverableValueSats: BALANCE_SATS,
      sweepFeeSats: MOVED.sweepFeeSats,
      cooperativeFeeSats: MOVED.cooperativeFeeSats,
    },
  },
);

/**
 * That exit landed a day ago, one entry for all of it, paying what the plan
 * said would arrive. No `recoverableFundsSat`: the moved leaf was part of the
 * balance it exited.
 */
const movedExit: ArchivedExit = {
  id: UPDATED_SWEEP_TXID,
  destination: DESTINATION,
  deliveredSat: willReceiveSat(movedPlan),
  completedAt: Date.now() - DAY_SEC * 1000,
  network: NETWORK,
  exitedSat: BALANCE_SATS,
  exitFeePaidSat: DEV_EXIT.exitFeeSat,
  exitFeeAddress: EXIT_FEE_ADDRESS,
};

const ExitPage: React.FC = () => <UnilateralExitPage network={NETWORK} onBack={noop} onFinished={noop} />;

export const exitShots: Record<string, React.FC> = {
  'ux-13a-tracker-after-update': ExitPage,
  'ux-13b-update-needed': ExitPage,
  'ux-13d-archived-details': () => <ArchivedExitDialog exit={movedExit} onClose={noop} chain={mockChain()} />,
};

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
  'ux-13a-tracker-after-update': movedRunning,
  'ux-13b-update-needed': movedRedo,
  // The redo card makes 13b's sheet tall enough to cover the row, so the row gets its own shot.
  'ux-13b2-wallet-update-needed': movedRedo,
  'ux-13c-wallet-landed': movedLanded,
  'ux-13d-archived-details': movedLanded,
};
