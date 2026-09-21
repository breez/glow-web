import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';

// Two sessions started inside the same second, plus the one this load
// owns. logger.ts pulls its session helpers from here too, so the mock
// has to cover those as well.
vi.mock('./logStorage', () => ({
  isStorageAvailable: () => true,
  peekCurrentSessionId: () => '1785977460000-live',
  getAllSessions: async () => [
    { id: '1785977450100-aaa', startedAt: '2026-08-06T00:50:50.100Z', endedAt: 'x', logs: 'one' },
    { id: '1785977450900-bbb', startedAt: '2026-08-06T00:50:50.900Z', endedAt: 'x', logs: 'two' },
    { id: '1785977460000-live', startedAt: '2026-08-06T00:51:00.000Z', logs: 'live, stale copy' },
  ],
  startSession: async () => 'session',
  saveSessionLogs: async () => {},
  endSession: async () => {},
}));

describe('getAllLogsAsZip', () => {
  it('writes the live session once and keeps same-second sessions apart', async () => {
    const { getAllLogsAsZip } = await import('./logExport');

    const zip = await JSZip.loadAsync(await getAllLogsAsZip());
    const names = Object.keys(zip.files);

    expect(names.filter((n) => n.includes('_glow_current'))).toHaveLength(1);
    // The live session is not repeated as a stale historical file, and the
    // two same-second sessions both survive instead of overwriting.
    expect(names.filter((n) => n.includes('_glow_session')).sort()).toEqual([
      '1785977450_glow_session_aaa.txt',
      '1785977450_glow_session_bbb.txt',
    ]);
  });
});

describe('shareOrDownloadZip on a native platform', () => {
  it('stops when the user dismisses the share sheet', async () => {
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
    vi.doMock('@capacitor/filesystem', () => ({
      Filesystem: { writeFile: async () => ({ uri: 'file:///cache/x.zip' }) },
      Directory: { Cache: 'CACHE' },
    }));
    // What both plugins reject with when the sheet is dismissed: a plain
    // message, no AbortError name.
    vi.doMock('@capacitor/share', () => ({
      Share: { share: async () => { throw new Error('Share canceled'); } },
    }));
    const webShare = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, share: webShare, canShare: () => true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    vi.resetModules();
    const { shareOrDownloadZip } = await import('./logExport');
    await shareOrDownloadZip(new Blob(['z']), 'x.zip', 'Glow');

    expect(webShare).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    click.mockRestore();
    vi.unstubAllGlobals();
    vi.doUnmock('@capacitor/core');
    vi.doUnmock('@capacitor/filesystem');
    vi.doUnmock('@capacitor/share');
  });
});
