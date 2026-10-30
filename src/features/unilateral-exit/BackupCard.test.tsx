import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BackupActions } from './BackupCard';

const importUnilateralExitState = vi.fn();
const exportUnilateralExitState = vi.fn(async () => ({ exitState: '{"leaves":[]}' }));

vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => ({ exportUnilateralExitState, importUnilateralExitState }),
}));
vi.mock('@/services/logExport', () => ({ shareOrDownloadZip: vi.fn(async () => undefined) }));

const imported = (over = {}) => ({
  importedLeaves: 0,
  skippedForeignLeaves: 0,
  skippedConflictingLeaves: 0,
  skippedChains: 0,
  ...over,
});

const backupFile = async (): Promise<File> => {
  const zip = new JSZip();
  zip.file('exit-state.json', '{"leaves":[{"id":"leaf-1"}]}');
  return new File([await zip.generateAsync({ type: 'blob' })], 'backup.zip');
};

const restore = async (file: File, actions: React.ReactElement = <BackupActions />) => {
  render(actions);
  fireEvent.change(screen.getByTestId('unilateral-exit-backup-file'), { target: { files: [file] } });
};

describe('BackupActions', () => {
  it('says what was restored, so an empty import is not silent', async () => {
    importUnilateralExitState.mockResolvedValue(imported({ importedLeaves: 3 }));
    await restore(await backupFile());
    await waitFor(() =>
      expect(screen.getByTestId('unilateral-exit-backup-result')).toHaveTextContent(/^Restored 3 leaves\. You can start the exit\.$/),
    );
  });

  it('says a restore lets a recovery start, in its own words', async () => {
    importUnilateralExitState.mockResolvedValue(imported({ importedLeaves: 3 }));
    await restore(await backupFile(), <BackupActions noun="recovery" />);
    await waitFor(() =>
      expect(screen.getByTestId('unilateral-exit-backup-result')).toHaveTextContent(/^Restored 3 leaves\. You can start the recovery\.$/),
    );
  });

  it('offers no start once the exit has started', async () => {
    importUnilateralExitState.mockResolvedValue(imported({ importedLeaves: 1 }));
    await restore(await backupFile(), <BackupActions noun="recovery" started />);
    await waitFor(() => expect(screen.getByTestId('unilateral-exit-backup-result')).toHaveTextContent(/^Restored 1 leaf\.$/));
  });

  it('names the real reason when the backup is another wallet’s', async () => {
    importUnilateralExitState.mockResolvedValue(imported({ skippedForeignLeaves: 4 }));
    await restore(await backupFile());
    await waitFor(() =>
      expect(screen.getByTestId('unilateral-exit-backup-result')).toHaveTextContent('different wallet'),
    );
  });

  it('distinguishes a backup holding nothing new from one that failed', async () => {
    importUnilateralExitState.mockResolvedValue(imported());
    await restore(await backupFile());
    await waitFor(() =>
      expect(screen.getByTestId('unilateral-exit-backup-result')).toHaveTextContent('already holds it'),
    );
  });

  it('reports a file that is not a backup', async () => {
    await restore(new File(['not a backup'], 'notes.txt'));
    await waitFor(() =>
      expect(screen.getByTestId('unilateral-exit-backup-error')).toHaveTextContent('not a Glow'),
    );
  });

  it('saves a copy', async () => {
    render(<BackupActions />);
    fireEvent.click(screen.getByTestId('unilateral-exit-backup-save'));
    await waitFor(() => expect(exportUnilateralExitState).toHaveBeenCalled());
    // The save keeps running after the export call; let it settle before teardown.
    await waitFor(() => expect(screen.getByTestId('unilateral-exit-backup-save')).toBeEnabled());
  });
});
