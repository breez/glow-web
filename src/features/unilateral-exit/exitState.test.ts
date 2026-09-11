import { backUpWhenExitLands, captureExitState, exitStateForExit, restoreExitState } from './exitState';
import { plan } from './testFixtures';
import { describe, expect, it, vi } from 'vitest';

const imported = { importedLeaves: 0, skippedForeignLeaves: 0, skippedConflictingLeaves: 0, skippedChains: 0 };

describe('exitStateForExit', () => {
  it('prefers the snapshot frozen when the exit was built', () => {
    expect(exitStateForExit(plan([], { exitStateSnapshot: 'frozen' }), 'rolling')).toBe('frozen');
  });

  it('falls back to the rolling backup when there is no snapshot', () => {
    expect(exitStateForExit(plan([]), 'rolling')).toBe('rolling');
  });

  it('uses the rolling backup when no exit exists yet', () => {
    expect(exitStateForExit(null, 'rolling')).toBe('rolling');
  });

  it('has nothing to offer when neither exists', () => {
    expect(exitStateForExit(null, null)).toBeNull();
  });

  it('does not restore from a finished exit, whose leaves have since been spent', () => {
    expect(exitStateForExit(plan([], { phase: 'complete', exitStateSnapshot: 'frozen' }), 'rolling')).toBeNull();
  });
});

describe('captureExitState', () => {
  const sdk = (exitState = 'exported') => ({
    exportUnilateralExitState: vi.fn(async () => ({ exitState })),
  });

  it('exports and stores when no exit is under way', async () => {
    const client = sdk();
    const save = vi.fn(async () => undefined);
    await captureExitState(client, null, save);
    expect(save).toHaveBeenCalledWith('exported');
  });

  it('exports again once an exit has finished', async () => {
    const client = sdk();
    const save = vi.fn(async () => undefined);
    await captureExitState(client, plan([], { phase: 'complete' }), save);
    expect(save).toHaveBeenCalledWith('exported');
  });

  it('does not export at all while an exit is under way', async () => {
    const client = sdk();
    const save = vi.fn(async () => undefined);
    await captureExitState(client, plan([], { phase: 'active' }), save);
    expect(client.exportUnilateralExitState).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the previous backup when exporting fails', async () => {
    const client = { exportUnilateralExitState: vi.fn(async () => { throw new Error('down'); }) };
    const save = vi.fn(async () => undefined);
    await expect(captureExitState(client, null, save)).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('restoreExitState', () => {
  it('imports the state an exit should run against', async () => {
    const client = { importUnilateralExitState: vi.fn(async () => imported) };
    await restoreExitState(client, plan([], { exitStateSnapshot: 'frozen' }), 'rolling');
    expect(client.importUnilateralExitState).toHaveBeenCalledWith({ exitState: 'frozen' });
  });

  it('does nothing when there is nothing to import', async () => {
    const client = { importUnilateralExitState: vi.fn(async () => imported) };
    await restoreExitState(client, null, null);
    expect(client.importUnilateralExitState).not.toHaveBeenCalled();
  });

  it('lets an exit proceed even if the import fails', async () => {
    const client = { importUnilateralExitState: vi.fn(async () => { throw new Error('corrupt'); }) };
    await expect(restoreExitState(client, null, 'rolling')).resolves.toBeUndefined();
  });
});

describe('backUpWhenExitLands', () => {
  const setup = () => {
    const save = vi.fn(async () => undefined);
    const sdk = { exportUnilateralExitState: vi.fn(async () => ({ exitState: 'fresh' })) };
    return { save, sdk, listener: backUpWhenExitLands(sdk as never, save) };
  };
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it('takes a fresh backup when an exit lands in the archive', async () => {
    const { save, listener } = setup();
    listener({ plan: plan([]), archive: [] });
    listener({ plan: null, archive: [{ id: 'sweep' }] });
    await flush();
    expect(save).toHaveBeenCalledWith('fresh');
  });

  it('does not count the archive it finds on start as a landing', async () => {
    const { save, listener } = setup();
    listener({ plan: null, archive: [{ id: 'sweep' }] });
    await flush();
    expect(save).not.toHaveBeenCalled();
  });
});
