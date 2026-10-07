import { describe, expect, it } from 'vitest';
import { exitGroupTitle, unilateralExitEntries } from './listEntries';
import { coin, pendingExit, plan, ready, tx } from './testFixtures';
import type { ArchivedExit } from './archive';
import type { UnilateralExitEngineState } from './engine';

const engine = (over: Partial<UnilateralExitEngineState> = {}): UnilateralExitEngineState => ({
  plan: null,
  pending: pendingExit(),
  pendingCoins: [],
  nothingToExit: false,
  isStarting: false,
  startError: null,
  archive: [],
  recoveries: [],
  tipHeight: null,
  isAdvancing: false,
  ...over,
});

const entries = (over: Partial<UnilateralExitEngineState> = {}, recoverableSat?: number) =>
  unilateralExitEntries(engine(over), recoverableSat);

const row = (over: Partial<UnilateralExitEngineState> = {}, recoverableSat?: number) =>
  entries(over, recoverableSat)[0];

const landed = (over: Partial<ArchivedExit> = {}): ArchivedExit => ({
  id: 'sweep',
  destination: 'bc1qdest',
  deliveredSat: 90_000,
  completedAt: 0,
  ...over,
});

describe('a pending exit in the wallet list', () => {
  it('says what to send before anything arrives, and opens the flow', () => {
    expect(row()).toMatchObject({
      title: 'Waiting for exit fee',
      subtitle: 'Send ₿5 898 to start',
      amountSat: 94_000,
      kind: 'active',
    });
  });

  it('asks for the rest after a partial payment', () => {
    expect(row({ pendingCoins: [coin(3_000, false)] }).subtitle).toBe('Send ₿3 034 more');
  });

  it('waits on a confirmation once the fee is on its way', () => {
    expect(row({ pendingCoins: [coin(5_898, false)] })).toMatchObject({
      title: 'Exit fee sent',
      subtitle: 'Waiting for a confirmation',
    });
  });

  it('asks for a tap once the fee confirms, since only the user starts the exit', () => {
    expect(row({ pendingCoins: [coin(5_898)] })).toMatchObject({
      title: 'Exit fee received',
      subtitle: 'Tap to start',
      isAction: true,
    });
  });
});

describe('recoverable funds in the wallet list', () => {
  it('offers them with their exact total while nothing is saved, and only then', () => {
    expect(row({ pending: null }, 48_200)).toMatchObject({
      title: 'Recoverable Funds',
      subtitle: 'Tap to recover',
      amountSat: 48_200,
      kind: 'recoverable',
    });
    expect(row({}, 48_200).kind).toBe('active');
    expect(row({ pending: null, plan: plan([]) }, 48_200).kind).toBe('active');
  });

  it('sits above a finished exit, in the same group', () => {
    const rows = entries({ pending: null, archive: [landed()] }, 48_200);
    expect(rows.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'recoverable', kind: 'recoverable' },
      { id: 'sweep', kind: 'archived' },
    ]);
  });
});

describe('a kept co-signed recovery in the wallet list', () => {
  // Two leaves, 48 200 in all, 2 900 of fees off what arrives.
  const recovery = plan(
    [
      tx({ txid: 'c1', kind: 'cooperative' as never, nodeId: 'leaf-1', status: ready }),
      tx({ txid: 'c2', kind: 'cooperative' as never, nodeId: 'leaf-2', status: ready }),
    ],
    {
      mode: 'recover',
      quotedSweepFeeSat: 2_900,
      exit: {
        leaves: [
          { leafId: 'leaf-1', value: 30_000 },
          { leafId: 'leaf-2', value: 18_200 },
        ],
        recoverableValueSat: 48_200,
      },
    },
  );

  it('gets its own row while it waits to confirm, beside a pending exit', () => {
    const rows = entries({ recoveries: [recovery] });
    expect(rows[0]).toMatchObject({
      title: 'BTC Transfer',
      subtitle: 'Waiting for a confirmation',
      amountSat: 45_300,
      kind: 'recovery',
    });
    expect(rows[1]).toMatchObject({ id: 'pending', title: 'Waiting for exit fee' });
  });

  it('keeps its leaves out of the Recoverable Funds row, which getInfo still counts them in', () => {
    expect(entries({ pending: null, recoveries: [recovery] }, 48_200).map(r => r.kind)).toEqual(['recovery']);
    expect(row({ pending: null, recoveries: [recovery] }, 60_000)).toMatchObject({ kind: 'recovery' });
    expect(entries({ pending: null, recoveries: [recovery] }, 60_000)[1]).toMatchObject({
      kind: 'recoverable',
      amountSat: 11_800,
    });
  });

  it('stops counting against the total once complete, since its leaves have left getInfo by then', () => {
    expect(entries({ pending: null, recoveries: [{ ...recovery, phase: 'complete' }] }, 11_800)).toEqual([
      expect.objectContaining({ kind: 'recoverable', amountSat: 11_800 }),
    ]);
  });
});

describe('the exit group heading', () => {
  it('reads Recovery for a wallet that never started an exit', () => {
    expect(exitGroupTitle(engine({ pending: null }))).toBe('Recovery');
    expect(
      exitGroupTitle(engine({ pending: pendingExit({ mode: 'recover' }), archive: [landed({ mode: 'recover' })] })),
    ).toBe('Recovery');
    expect(exitGroupTitle(engine({ pending: null, plan: plan([], { mode: 'recover' }) }))).toBe('Recovery');
  });

  it('reads Unilateral Exit once the user has started one, running or finished', () => {
    expect(exitGroupTitle(engine())).toBe('Unilateral Exit');
    expect(exitGroupTitle(engine({ pending: null, plan: plan([]) }))).toBe('Unilateral Exit');
    expect(
      exitGroupTitle(engine({ pending: null, archive: [landed({ mode: 'recover' }), landed({ id: 'exit' })] })),
    ).toBe('Unilateral Exit');
  });
});
