import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import {
  exportUnilateralExitBackup,
  importUnilateralExitBackup,
  UnreadableBackupError,
} from './backup';

vi.mock('@/services/logExport', () => ({ shareOrDownloadFile: vi.fn(async () => undefined) }));
const { shareOrDownloadFile } = await import('@/services/logExport');

const STATE = '{"leaves":[{"id":"leaf-1"}]}';

const imported = (over = {}) => ({
  importedLeaves: 0,
  skippedForeignLeaves: 0,
  skippedConflictingLeaves: 0,
  skippedChains: 0,
  ...over,
});

const savedZip = async (): Promise<Blob> => {
  const zip = new JSZip();
  zip.file('exit-state.json', STATE);
  return zip.generateAsync({ type: 'blob' });
};

const asFile = (blob: Blob, name: string): File => new File([blob], name);

describe('exportUnilateralExitBackup', () => {
  it('saves the exit state, which is what the operators cannot serve again', async () => {
    const sdk = { exportUnilateralExitState: vi.fn(async () => ({ exitState: STATE })) };
    await exportUnilateralExitBackup(sdk);

    const calls = vi.mocked(shareOrDownloadFile).mock.calls;
    const [blob, filename] = calls[calls.length - 1];
    expect(filename).toMatch(/glow_unilateral_exit_backup\.zip$/);
    const zip = await JSZip.loadAsync(blob);
    await expect(zip.file('exit-state.json')?.async('string')).resolves.toBe(STATE);
  });

  it('saves the copy a running exit was built against, not a fresh one', async () => {
    // Mid-exit the operators stop reporting the leaves being moved, so a fresh
    // export is missing exactly what the exit needs.
    const sdk = { exportUnilateralExitState: vi.fn(async () => ({ exitState: 'fresher, and worth less' })) };
    await exportUnilateralExitBackup(sdk, STATE);
    expect(sdk.exportUnilateralExitState).not.toHaveBeenCalled();

    const calls = vi.mocked(shareOrDownloadFile).mock.calls;
    const [blob] = calls[calls.length - 1];
    const zip = await JSZip.loadAsync(blob);
    await expect(zip.file('exit-state.json')?.async('string')).resolves.toBe(STATE);
  });
});

describe('importUnilateralExitBackup', () => {
  it('reads the state out of a saved backup', async () => {
    const sdk = { importUnilateralExitState: vi.fn(async () => imported({ importedLeaves: 3 })) };
    const restored = await importUnilateralExitBackup(sdk, asFile(await savedZip(), 'backup.zip'));
    expect(sdk.importUnilateralExitState).toHaveBeenCalledWith({ exitState: STATE });
    expect(restored.importedLeaves).toBe(3);
  });

  it('takes a bare export, saved without the zip around it', async () => {
    const sdk = { importUnilateralExitState: vi.fn(async () => imported({ importedLeaves: 1 })) };
    await importUnilateralExitBackup(sdk, asFile(new Blob([STATE]), 'exit-state.json'));
    expect(sdk.importUnilateralExitState).toHaveBeenCalledWith({ exitState: STATE });
  });

  it('reports a file that is not a backup rather than importing nothing', async () => {
    const sdk = { importUnilateralExitState: vi.fn(async () => imported()) };
    await expect(
      importUnilateralExitBackup(sdk, asFile(new Blob(['not a backup']), 'notes.txt')),
    ).rejects.toThrow(UnreadableBackupError);
    expect(sdk.importUnilateralExitState).not.toHaveBeenCalled();
  });

  it('reports a zip that holds something else', async () => {
    const zip = new JSZip();
    zip.file('transactions.json', '[]');
    const sdk = { importUnilateralExitState: vi.fn(async () => imported()) };
    await expect(
      importUnilateralExitBackup(sdk, asFile(await zip.generateAsync({ type: 'blob' }), 'other.zip')),
    ).rejects.toThrow(UnreadableBackupError);
  });

  it('hands back the counts, so a file from another wallet is not silent success', async () => {
    const sdk = {
      importUnilateralExitState: vi.fn(async () => imported({ skippedForeignLeaves: 4 })),
    };
    const restored = await importUnilateralExitBackup(sdk, asFile(await savedZip(), 'backup.zip'));
    expect(restored).toMatchObject({ importedLeaves: 0, skippedForeignLeaves: 4 });
  });
});
