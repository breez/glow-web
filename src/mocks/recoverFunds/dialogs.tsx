// THROWAWAY: dialog shots for ?recovermock.
// The shot registry exports a record of components; fast refresh does not matter here.
/* eslint-disable react-refresh/only-export-components */
import type React from 'react';
import { ArchivedExitDialog } from '@/features/unilateral-exit/ArchivedExitDialog';
import { quoteFigures } from '@/features/unilateral-exit/quote';
import type { ArchivedExit } from '@/features/unilateral-exit/storage/archive';
import { DESTINATION, EXIT_FEE_ADDRESS, NETWORK, STRANDED_QUOTE } from './fixtures';
import { seedArchive, type WalletScene } from './wallet';

const noop = () => {};

const SWEEP_TXID = '7c1e4b9a2f06d853e1a4c07b95d23f6e8a0b41c79d2e5f3a86b0c14d7e92a5f1';

const stranded = quoteFigures(STRANDED_QUOTE);

/**
 * The stranded recovery landed a minute ago, its sweep paying what the quote
 * said. Its funding was spent to the last sat, so the network fees are the
 * quote's whole fee, as archiveExit records them.
 */
const archivedRecovery: ArchivedExit = {
  id: SWEEP_TXID,
  destination: DESTINATION,
  deliveredSat: stranded.willReceiveSat,
  completedAt: Date.now() - 60_000,
  network: NETWORK,
  exitedSat: stranded.fundsSat,
  exitFeePaidSat: stranded.exitFeeSat,
  networkFeeSat: stranded.fundsSat + stranded.exitFeeSat - stranded.willReceiveSat,
  unspentExitFeeSat: 0,
  exitFeeAddress: EXIT_FEE_ADDRESS,
  mode: 'recover',
  txids: [SWEEP_TXID],
};

const ArchivedRecoveryShot: React.FC = () => (
  <ArchivedExitDialog exit={archivedRecovery} onClose={noop} subtitle="Recovery" exitedLabel="Funds Recovered" />
);

export const dialogShots: Record<string, React.FC> = {
  '11-archived-dialog': ArchivedRecoveryShot,
};

/** The wallet page behind each dialog, where it differs from shot 01's. */
export const dialogScenes: Record<string, WalletScene> = {
  // The stranded-only recovery has landed: nothing left to recover, its row archived.
  '11-archived-dialog': { recoverableFundsSats: 0, seed: seedArchive([archivedRecovery]) },
};
