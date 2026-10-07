// THROWAWAY: dialog shots for ?recovermock.
// The shot registry exports a record of components; fast refresh does not matter here.
/* eslint-disable react-refresh/only-export-components */
import type React from 'react';
import { ArchivedExitDialog } from '@/features/unilateral-exit/ArchivedExitDialog';
import type { ArchivedExit } from '@/features/unilateral-exit/archive';
import type { ChainClient } from '@/services/chain';
import { ARCHIVED, DESTINATION, EXIT_FEE_ADDRESS, FEE_RATES, NETWORK } from './fixtures';
import { seedArchive, type WalletScene } from './wallet';

const noop = () => {};

const SWEEP_TXID = '7c1e4b9a2f06d853e1a4c07b95d23f6e8a0b41c79d2e5f3a86b0c14d7e92a5f1';

/** The stranded ₿120 000 recovery, landed a minute ago. */
const archivedRecovery: ArchivedExit = {
  id: SWEEP_TXID,
  destination: DESTINATION,
  deliveredSat: ARCHIVED.receivedSat,
  completedAt: Date.now() - 60_000,
  network: NETWORK,
  exitedSat: ARCHIVED.recoveredSat,
  exitFeePaidSat: ARCHIVED.exitFeePaidSat,
  exitFeeAddress: EXIT_FEE_ADDRESS,
  mode: 'recover',
};

/** The exit fee address still holds what the watchtower's refund left unspent. */
const feeAddressChain: ChainClient = {
  feeRates: async () => FEE_RATES,
  addressUtxos: async () => [
    { txid: SWEEP_TXID, vout: 1, value: ARCHIVED.unspentExitFeeSat, confirmed: true, blockHeight: 915_402 },
  ],
  tipHeight: async () => 915_408,
  broadcast: async () => {},
  broadcastPackage: async () => {},
};

const ArchivedRecoveryShot: React.FC = () => (
  <ArchivedExitDialog
    exit={archivedRecovery}
    onClose={noop}
    subtitle="Recovery"
    exitedLabel="Funds Recovered"
    chain={feeAddressChain}
  />
);

export const dialogShots: Record<string, React.FC> = {
  '11-archived-dialog': ArchivedRecoveryShot,
};

/** The wallet page behind each dialog, where it differs from shot 01's. */
export const dialogScenes: Record<string, WalletScene> = {
  // The stranded-only recovery has landed: nothing left to recover, its row archived.
  '11-archived-dialog': { recoverableFundsSats: 0, seed: seedArchive([archivedRecovery]) },
};
