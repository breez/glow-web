import { logger, LogCategory } from './logger';
import { getAllSessions, isStorageAvailable } from './logStorage';
import JSZip from 'jszip';

const getAllLogs = (): string => {
  return logger.getLogsAsString();
};

export const getAllLogsAsZip = async (): Promise<Blob> => {
  const zip = new JSZip();
  const now = new Date();
  const nowTimestamp = Math.floor(now.getTime() / 1000);

  const currentSessionHeader = [
    `Glow Wallet Log Export`,
    `Session: Current`,
    `Generated: ${now.toISOString()}`,
    '='.repeat(60),
    '',
  ].join('\n');
  zip.file(`${nowTimestamp}_glow_current.txt`, currentSessionHeader + '\n' + getAllLogs());

  if (isStorageAvailable()) {
    try {
      const sessions = await getAllSessions();
      for (const session of sessions) {
        const sessionTimestamp = Math.floor(new Date(session.startedAt).getTime() / 1000);
        const filename = `${sessionTimestamp}_glow_session.txt`;
        const sessionHeader = [
          `Glow Wallet Log Export`,
          `Session ID: ${session.id}`,
          `Started: ${session.startedAt}`,
          session.endedAt ? `Ended: ${session.endedAt}` : 'Status: Active',
          '='.repeat(60),
          '',
        ].join('\n');
        zip.file(filename, sessionHeader + '\n' + (session.logs || '(no logs)'));
      }
    } catch (e) {
      logger.warn(LogCategory.SDK, 'Failed to retrieve historical log sessions', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
};

export const canShareFiles = (): boolean => {
  return typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function';
};

export const shareOrDownloadLogs = async (): Promise<void> => {
  const blob = await getAllLogsAsZip();
  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `${timestamp}_glow_logs.zip`;

  if (canShareFiles()) {
    const file = new File([blob], filename, { type: 'application/zip' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Glow Wallet Logs' });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
