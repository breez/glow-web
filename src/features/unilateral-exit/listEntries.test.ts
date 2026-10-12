import { describe, expect, it } from 'vitest';
import { exitGroupTitle, recoveryEntryId, unilateralExitEntries } from './listEntries';
import { coin, confirmed, locked, pendingExit, plan, ready, tx } from './testFixtures';
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
  it('offers them with their exact total while nothing is saved', () => {
    expect(row({ pending: null }, 48_200)).toMatchObject({
      title: 'Recoverable Funds',
      subtitle: 'Tap to recover',
      isAction: true,
      amountSat: 48_200,
      kind: 'recoverable',
    });
  });

  it('waits for a pending exit, whose start takes every leaf in', () => {
    expect(entries({}, 48_200).map(r => r.kind)).toEqual(['active']);
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
      tx({ txid: 'c1', kind: 'cooperative', nodeId: 'leaf-1', status: ready }),
      tx({ txid: 'c2', kind: 'cooperative', nodeId: 'leaf-2', status: ready }),
    ],
    {
      mode: 'recover',
      quotedSweepFeeSat: 2_900,
      exit: {
        leaves: [
          { leafId: 'leaf-1', valueSats: 30_000, method: 'cooperative' },
          { leafId: 'leaf-2', valueSats: 18_200, method: 'cooperative' },
        ],
        recoverableValueSats: 48_200,
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

  it('gives back a leaf the network refused while unverified, for a new recovery to find', () => {
    const refused = {
      ...recovery,
      refusals: { c2: 'bad-txns-inputs-missingorspent' },
      exit: {
        ...recovery.exit,
        transactions: [recovery.exit.transactions[0], { ...recovery.exit.transactions[1], status: { type: 'unverified' as const } }],
      },
    };
    expect(entries({ pending: null, recoveries: [refused] }, 48_200)[1]).toMatchObject({ kind: 'recoverable', amountSat: 18_200 });
  });

  it('is found by the id of its row', () => {
    expect(entries({ pending: null, recoveries: [recovery] })[0].id).toBe(recoveryEntryId(recovery));
    expect(recoveryEntryId(recovery)).toBe('recovery:c1');
  });
});

describe('recoverable funds beside an exit under way', () => {
  // Two balance leaves, each behind its own node; leaf-2's node is on-chain.
  const running = (over: Parameters<typeof plan>[1] = {}) =>
    plan(
      [
        tx({ txid: 'node-1', kind: 'node', status: ready }),
        tx({ txid: 'node-2', kind: 'node', status: confirmed(10) }),
        tx({ txid: 'refund-1', kind: 'refund', nodeId: 'leaf-1', dependsOn: ['node-1'], status: locked() }),
        tx({ txid: 'refund-2', kind: 'refund', nodeId: 'leaf-2', dependsOn: ['node-2'], status: locked(900) }),
      ],
      {
        ...over,
        exit: {
          leaves: [
            { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
            { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
          ],
          ...over.exit,
        },
      },
    );
  const recoverable = (state: Parameters<typeof entries>[0], sat: number) =>
    entries({ pending: null, ...state }, sat).find(r => r.kind === 'recoverable');

  it('takes out a balance leaf only once its branch is on-chain, when getInfo starts counting it', () => {
    expect(recoverable({ plan: running() }, 450_000)).toMatchObject({ amountSat: 30_000 });
  });

  it('asks for no tap, since the tracker it opens cannot recover them', () => {
    expect(recoverable({ plan: running() }, 450_000)).toMatchObject({ subtitle: null, isAction: false });
  });

  it('is hidden once the exit accounts for everything getInfo counts', () => {
    expect(recoverable({ plan: running() }, 420_000)).toBeUndefined();
    expect(recoverable({ plan: running() }, 400_000)).toBeUndefined();
  });

  it('takes out every leaf of a recovery, all of which was outside the balance', () => {
    expect(recoverable({ plan: running({ mode: 'recover' }) }, 600_000)).toBeUndefined();
  });

  it('takes out a co-signed leaf, and a leaf the last rebuild skipped, but not one whose co-signing failed', () => {
    const mixed = running({
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 180_000 },
        { leafId: 'leaf-2', valueSats: 420_000 },
        { leafId: 'moved', valueSats: 30_000 },
        { leafId: 'skipped', valueSats: 5_000 },
        { leafId: 'failed', valueSats: 7_000 },
      ],
      exit: {
        leaves: [
          { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
          { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
          { leafId: 'moved', valueSats: 30_000, method: 'cooperative' },
        ],
        failed: [{ leafId: 'failed', outputTxid: 'o', outputVout: 0, error: { type: 'generic', message: 'refused' } }],
      },
    });
    // 420 000 + 30 000 + 5 000 are on their way; the failed 7 000 is not.
    expect(recoverable({ plan: mixed }, 462_000)).toMatchObject({ amountSat: 7_000 });
  });

  it('counts a leaf both the exit and a kept recovery hold once', () => {
    const kept = plan([tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-2', status: ready })], {
      mode: 'recover',
      exit: { leaves: [{ leafId: 'leaf-2', valueSats: 420_000, method: 'cooperative' }] },
    });
    expect(recoverable({ plan: running(), recoveries: [kept] }, 430_000)).toMatchObject({ amountSat: 10_000 });
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
