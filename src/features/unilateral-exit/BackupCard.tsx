import React, { useRef, useState } from 'react';
import { DownloadIcon, UploadIcon } from '@/components/Icons';
import { useWallet } from '@/contexts/WalletContext';
import { logger, LogCategory } from '@/services/logger';
import { exportUnilateralExitBackup, importUnilateralExitBackup } from './backup';

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const ExitActionRow: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}> = ({ label, icon, onClick, disabled = false, testId }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    // The settings page's Export Database control: these are actions, and as
    // divided rows they read as a list of settings instead.
    className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-medium border border-spark-border rounded-xl text-spark-text-secondary hover:text-spark-text-primary hover:bg-white/5 transition-colors disabled:opacity-50"
    data-testid={testId}
  >
    {icon}
    <span>{label}</span>
  </button>
);

/**
 * Saving and restoring the data an exit needs. Offered wherever an exit can be
 * started, not only once one is running: the file exists for the case where the
 * operators have stopped answering and nothing else can supply it.
 *
 * Rendered bare so it can sit inside the Advanced section, which is where
 * both entry points keep it.
 *
 * `frozen` is an in-flight exit's own copy, saved in preference to a fresh
 * export. `started` is set once the exit has started, so a restore has
 * nothing left to start.
 */
export const BackupActions: React.FC<{ frozen?: string; noun?: string; started?: boolean; children?: React.ReactNode }> = ({
  frozen,
  noun = 'exit',
  started = false,
  children,
}) => {
  const wallet = useWallet();
  const [busy, setBusy] = useState<'saving' | 'restoring' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const save = async () => {
    setBusy('saving');
    setError(null);
    setResult(null);
    try {
      await exportUnilateralExitBackup(wallet, frozen);
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to save the unilateral exit backup', { error: message(e) });
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    setBusy('restoring');
    setError(null);
    setResult(null);
    try {
      const restored = await importUnilateralExitBackup(wallet, file);
      setResult(
        restored.importedLeaves > 0
          ? `Restored ${restored.importedLeaves} ${restored.importedLeaves === 1 ? 'leaf' : 'leaves'}.${started ? '' : ` You can start the ${noun}.`}`
          : restored.skippedForeignLeaves > 0
            ? 'That backup belongs to a different wallet.'
            : 'Nothing new in that backup: this wallet already holds it.',
      );
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to restore the unilateral exit backup', { error: message(e) });
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-2">
        <ExitActionRow
          label="Save exit data"
          icon={<DownloadIcon size="md" />}
          onClick={() => void save()}
          disabled={busy !== null}
          testId="unilateral-exit-backup-save"
        />
        <ExitActionRow
          label="Restore exit data"
          icon={<UploadIcon size="md" />}
          onClick={() => picker.current?.click()}
          disabled={busy !== null}
          testId="unilateral-exit-backup-restore"
        />
        {children}
      </div>

      {busy && <p className="text-sm text-spark-text-muted mt-2">{busy === 'saving' ? 'Preparing...' : 'Restoring...'}</p>}
      {result && <p className="text-sm text-spark-text-primary mt-2" data-testid="unilateral-exit-backup-result">{result}</p>}
      {error && <p className="text-sm text-spark-error mt-2" data-testid="unilateral-exit-backup-error">{error}</p>}

      <input
        ref={picker}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        data-testid="unilateral-exit-backup-file"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void restore(file);
        }}
      />
    </div>
  );
};
