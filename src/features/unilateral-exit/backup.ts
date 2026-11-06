import JSZip from 'jszip';
import { shareOrDownloadFile } from '@/services/logExport';
import type { ExitStateExporter, ExitStateImporter } from './exitState';

const STATE_FILE = 'exit-state.json';

const README = [
  'Glow unilateral exit backup',
  '',
  'This file holds the data needed to move your Spark balance on-chain without',
  'the operators. It is the one thing they cannot serve you again once they',
  'stop responding.',
  '',
  'To use it: restore your wallet from your recovery phrase, open Settings,',
  'Unilateral Exit, and choose to restore from a backup.',
  '',
  'It is not a substitute for your recovery phrase, and it is useless without',
  'it. Keep both.',
  '',
  'Keep it private. It reveals your balance, how it is split, and its history.',
  '',
].join('\n');

/**
 * Writes the exit state to a file the user keeps. Everything else an exit needs
 * is either derived from the recovery phrase or read back off the chain, so
 * this plus the phrase is a complete rescue.
 *
 * `frozen` is the copy an exit under way was built against, which is preferred:
 * once an exit starts, the operators stop reporting the leaves it is moving, so
 * a fresh export would be missing them.
 */
export async function exportUnilateralExitBackup(
  sdk: ExitStateExporter,
  frozen?: string,
): Promise<void> {
  const exitState = frozen ?? (await sdk.exportUnilateralExitState()).exitState;
  const zip = new JSZip();
  zip.file('README.txt', README);
  zip.file(STATE_FILE, exitState);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const timestamp = Math.floor(Date.now() / 1000);
  await shareOrDownloadFile(blob, `${timestamp}_glow_unilateral_exit_backup.zip`, 'Glow Unilateral Exit Backup');
}

/** What a restored file turned out to hold, once the sdk has read it. */
export interface RestoredExitState {
  importedLeaves: number;
  /** Leaves belonging to another wallet, so this file was not this wallet's. */
  skippedForeignLeaves: number;
  skippedConflictingLeaves: number;
  skippedChains: number;
}

export class UnreadableBackupError extends Error {
  constructor() {
    super('That file is not a Glow unilateral exit backup');
    this.name = 'UnreadableBackupError';
  }
}

const exitStateFrom = async (file: File): Promise<string> => {
  const text = await file.text();
  // A plain export, saved without the zip around it.
  if (text.trimStart().startsWith('{')) return text;
  try {
    const entry = (await JSZip.loadAsync(file)).file(STATE_FILE);
    if (entry) return await entry.async('string');
  } catch {
    throw new UnreadableBackupError();
  }
  throw new UnreadableBackupError();
};

/**
 * Reads a backup back into the wallet. Importing only ever adds leaf data the
 * wallet lacks, so a file holding nothing new is harmless rather than an error;
 * the counts say what happened, since a file from another wallet imports
 * nothing and would otherwise look like success.
 */
export async function importUnilateralExitBackup(
  sdk: ExitStateImporter,
  file: File,
): Promise<RestoredExitState> {
  return sdk.importUnilateralExitState({ exitState: await exitStateFrom(file) });
}
