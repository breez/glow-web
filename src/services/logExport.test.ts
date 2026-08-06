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
