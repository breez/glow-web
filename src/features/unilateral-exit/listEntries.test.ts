import { describe, expect, it } from 'vitest';
import { bumpTxidOf, exitGroupTitle, recoveryEntryId, releasesLeaves, unilateralExitEntries } from './listEntries';
import { coin, confirmed, locked, pendingExit, plan, ready, sweepHex, twoLeaves, tx } from './testFixtures';
import type { ArchivedExit } from './storage/archive';
import type { UnilateralExitEngineState } from './engine/state';

const engine = (over: Partial<UnilateralExitEngineState> = {}): UnilateralExitEngineState => ({
  plan: null,
  pending: pendingExit(),
  pendingCoins: [],
  nothingToExit: null,
  isStarting: false,
  startError: null,
  archive: [],
  recoveries: [],
  accounting: { droppedLeaves: [] },
  tipHeight: null,
  isAdvancing: false,
  endedPlans: 0,
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

  it.each([
    ['an exit', undefined, 'Nothing to exit'],
    ['a recovery', 'recover' as const, 'Nothing to recover'],
  ])('offers to cancel %s whose start found nothing worth moving', (_, mode, title) => {
    expect(row({ pending: pendingExit({ mode }), pendingCoins: [coin(5_898)], nothingToExit: { reason: 'fees' } })).toMatchObject({
      title,
      subtitle: 'Tap to cancel',
      isAction: true,
    });
  });

  it('still offers the start when what it found may yet move', () => {
    expect(row({ pendingCoins: [coin(5_898)], nothingToExit: { reason: 'unavailable' } })).toMatchObject({
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
      inert: false,
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

  it('leaves out what an ended record dropped as unrecoverable, which getInfo goes on counting', () => {
    const accounting = { droppedLeaves: [{ leafId: 'd-1', valueSats: 5_000 }] };
    expect(entries({ pending: null, accounting }, 5_000)).toEqual([]);
    expect(row({ pending: null, accounting }, 8_000)).toMatchObject({ kind: 'recoverable', amountSat: 3_000, subtitle: 'Tap to recover' });
  });
});

describe('a kept co-signed recovery in the wallet list', () => {
  // Two leaves, 48 200 in all, which the row shows before 2 900 of fees come off.
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
      amountSat: 48_200,
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
    expect(entries({ pending: null, recoveries: [{ ...recovery, status: { type: 'done' } }] }, 11_800)).toEqual([
      expect.objectContaining({ kind: 'recoverable', amountSat: 11_800 }),
    ]);
  });

  it('offers the other funds once a leaf it landed has left the total', () => {
    const part = {
      ...recovery,
      landed: [{ leafIds: ['leaf-1'], valueSat: 30_000, outpoint: 'o:0' }],
      exit: { ...recovery.exit, transactions: [{ ...recovery.exit.transactions[0], status: confirmed(9) }, recovery.exit.transactions[1]] },
    };
    // 18 200 still held, and 11 800 that nothing holds.
    expect(entries({ pending: null, recoveries: [part] }, 30_000)[1]).toMatchObject({
      kind: 'recoverable',
      amountSat: 11_800,
      isAction: true,
    });
  });

  it('is found by the id of its row', () => {
    expect(entries({ pending: null, recoveries: [recovery] })[0].id).toBe(recoveryEntryId(recovery));
    expect(recoveryEntryId(recovery)).toBe('recovery:c1');
  });
});

describe('what the Recoverable Funds row stops subtracting', () => {
  const held = plan([tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })], {
    mode: 'recover',
    exit: { leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] },
  });
  const records = (over: Partial<UnilateralExitEngineState>) => engine({ pending: null, ...over });

  it('includes the leaf of a recovery that landed, which getInfo drops as the SDK records it', () => {
    const done = { ...held, status: { type: 'done' as const }, landed: [{ leafIds: ['c-1'], valueSat: 30_000, outpoint: 'o:0' }] };
    expect(releasesLeaves(records({ recoveries: [held] }), records({ recoveries: [done] }))).toBe(true);
  });

  it('leaves out a leaf dropped as unrecoverable, which getInfo goes on counting, and a recovery just kept', () => {
    const dropped = { ...held, status: { type: 'done' as const }, droppedLeaves: [{ leafId: 'c-1', valueSats: 30_000 }] };
    expect(releasesLeaves(records({ recoveries: [held] }), records({ recoveries: [dropped] }))).toBe(false);
    expect(releasesLeaves(records({}), records({ recoveries: [held] }))).toBe(false);
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

  it('is hidden once the exit accounts for everything getInfo counts', () => {
    expect(recoverable({ plan: running() }, 420_000)).toBeUndefined();
    expect(recoverable({ plan: running() }, 400_000)).toBeUndefined();
  });

  it.each([
    ['every leaf of a recovery, all of which was outside the balance', { mode: 'recover' as const }],
    ['the leaves of a recovery the exit took in, which were outside the balance too', { mode: 'exit' as const, recoverableLeafIds: ['leaf-1'] }],
  ])('takes out %s', (_, over) => {
    expect(recoverable({ plan: running(over) }, 600_000)).toBeUndefined();
  });

  it('takes out a co-signed leaf, a leaf the last rebuild skipped, and one whose co-signing failed, which the exit still holds', () => {
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
    // 420 000 + 30 000 + 5 000 are on their way, and the failed 7 000 is built again.
    expect(recoverable({ plan: mixed }, 462_000)).toBeUndefined();
    expect(recoverable({ plan: mixed }, 470_000)).toMatchObject({ amountSat: 8_000 });
  });

  it('takes out only what the exit and the kept recoveries still move, not what they landed, which getInfo no longer counts', () => {
    const kept = plan([tx({ txid: 'c', kind: 'cooperative', nodeId: 'c-9', status: ready })], {
      mode: 'recover',
      landed: [{ leafIds: ['c-5'], valueSat: 2_000, outpoint: 'o:0' }],
      exit: { leaves: [{ leafId: 'c-9', valueSats: 10_000, method: 'cooperative' }] },
    });
    const exit = running({
      landed: [
        { leafIds: ['leaf-2'], valueSat: 420_000, txid: 'early', paidSat: 419_000 },
        { leafIds: ['old-1', 'old-2'], valueSat: 9_000, txid: 'old-sweep', paidSat: 8_500 },
      ],
    });
    // 10 000 kept, and 1 000 that nothing holds.
    expect(recoverable({ plan: exit, recoveries: [kept] }, 11_000)).toMatchObject({ amountSat: 1_000 });
  });

  it('leaves out what the exit, a kept recovery or a finished exit dropped as unrecoverable, counting each leaf once', () => {
    const dropped = (leafId: string, valueSats: number) => ({ leafId, valueSats });
    const kept = plan([tx({ txid: 'c', kind: 'cooperative', nodeId: 'c-9', status: ready })], {
      mode: 'recover',
      droppedLeaves: [dropped('d-1', 5_000), dropped('d-2', 3_000)],
      exit: { leaves: [{ leafId: 'c-9', valueSats: 10_000, method: 'cooperative' }] },
    });
    const state = {
      plan: running({ droppedLeaves: [dropped('d-1', 5_000)] }),
      recoveries: [kept],
      archive: [landed({ droppedLeaves: [dropped('d-3', 2_000)] })],
    };
    // 420 000 on its way, 10 000 kept, and 10 000 dropped.
    expect(recoverable(state, 441_000)).toMatchObject({ amountSat: 1_000 });
  });

  it('offers again, with no tap, what remains once what the exit landed has left the total', () => {
    const exit = running({ landed: [{ leafIds: ['leaf-2'], valueSat: 420_000, txid: 'early', paidSat: 419_000 }] });
    expect(recoverable({ plan: exit }, 30_000)).toMatchObject({
      amountSat: 30_000,
      subtitle: null,
      isAction: false,
      inert: true,
    });
  });

  it('takes out nothing for a co-signed leaf the exit landed and still names', () => {
    const exit = running({
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 180_000 },
        { leafId: 'leaf-2', valueSats: 420_000 },
        { leafId: 'moved', valueSats: 30_000 },
      ],
      landed: [{ leafIds: ['moved'], valueSat: 30_000, outpoint: 'o:0' }],
      exit: {
        leaves: [
          { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
          { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
          { leafId: 'moved', valueSats: 30_000, method: 'cooperative' },
        ],
      },
    });
    // 420 000 on its way. The 30 000 that landed has left the total.
    expect(recoverable({ plan: exit }, 430_000)).toMatchObject({ amountSat: 10_000 });
  });

  it('counts a leaf both the exit and a kept recovery hold once', () => {
    const kept = plan([tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-2', status: ready })], {
      mode: 'recover',
      exit: { leaves: [{ leafId: 'leaf-2', valueSats: 420_000, method: 'cooperative' }] },
    });
    expect(recoverable({ plan: running(), recoveries: [kept] }, 430_000)).toMatchObject({ amountSat: 10_000 });
  });
});

describe('what an exit row shows', () => {
  const refunds = [
    tx({ txid: 'r1', kind: 'refund', nodeId: 'leaf-1', status: confirmed(900) }),
    tx({ txid: 'r2', kind: 'refund', nodeId: 'leaf-2', status: confirmed(900) }),
  ];

  it('shows what left the wallet, the same through the sweep and once archived', () => {
    const sweeping = twoLeaves([...refunds, tx({ txid: 's', kind: 'sweep', txHex: sweepHex })]);
    // The sweep paid 596 524 once its fee came off.
    const swept = twoLeaves([...refunds, tx({ txid: 's', kind: 'sweep', txHex: sweepHex, status: confirmed(901) })], {
      status: { type: 'done' },
      landed: [{ leafIds: ['leaf-1', 'leaf-2'], valueSat: 600_000, txid: 's', paidSat: 596_524, blockHeight: 901 }],
    });
    const archived = landed({ id: 's', exitedSat: 600_000, deliveredSat: 596_524 });

    expect(row({ pending: null, plan: sweeping }).amountSat).toBe(600_000);
    expect(row({ pending: null, plan: swept }).amountSat).toBe(600_000);
    expect(row({ pending: null, archive: [archived] }).amountSat).toBe(600_000);
  });

  it('shows what a pending exit moves, and what it said would arrive on one saved before that was kept', () => {
    expect(row({ pending: pendingExit({ movedSat: 100_000 }) }).amountSat).toBe(100_000);
    expect(row({ pending: pendingExit() }).amountSat).toBe(94_000);
  });

  it('shows what arrived on a record from before what left was kept', () => {
    expect(row({ pending: null, archive: [landed()] }).amountSat).toBe(90_000);
  });
});

describe('an exit under way in the wallet list', () => {
  it('asks for a tap on a diverged exit Glow cannot rebuild alone', () => {
    expect(row({ pending: null, plan: plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'rebuildFailed' } }) })).toMatchObject({
      title: 'Update needed',
      subtitle: 'Tap to update',
      isAction: true,
    });
  });

  it('asks for none while it runs on its own', () => {
    expect(row({ pending: null, plan: plan([tx({ txid: 'a' })]) })).toMatchObject({ title: 'Transactions in progress', isAction: false });
  });

  it('reads a diverged exit Glow rebuilds by itself as running, naming no wait from the set it replaces', () => {
    const timelocked = [tx({ txid: 'r', kind: 'refund', status: locked(1144) })];
    expect(row({ pending: null, tipHeight: 1000, plan: plan(timelocked) }).subtitle).toMatch(/, next /);
    expect(row({ pending: null, tipHeight: 1000, plan: plan(timelocked, { status: { type: 'rebuilding' } }) })).toMatchObject({
      title: 'Transactions in progress',
      subtitle: '0 of 1 processed',
      isAction: false,
    });
  });
});

describe('an exit holding a leaf it left out in the wallet list', () => {
  const landed = (over: Parameters<typeof plan>[1] = {}) =>
    plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], {
      namedLeaves: [
        { leafId: 'leaf-1', valueSats: 100_000 },
        { leafId: 'c-9', valueSats: 30_000, feeSat: 1_000 },
      ],
      ...over,
    });
  const asking = (over: Parameters<typeof plan>[1] = {}) =>
    landed({ status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 } } }, ...over });

  it('counts a leaf still to build as a transaction still to go, at its value', () => {
    expect(row({ pending: null, plan: landed() })).toMatchObject({
      title: 'Transactions in progress',
      subtitle: '1 of 2 processed',
      amountSat: 130_000,
    });
  });

  it('says what to send while one waits on more exit fee, then waits on its confirmation, then on Glow', () => {
    const at = (coins: ReturnType<typeof coin>[]) => row({ pending: null, plan: asking(), pendingCoins: coins });
    // The leaf still to build counts at its value.
    expect(at([])).toMatchObject({ id: 'active', kind: 'active', title: 'Waiting for exit fee', subtitle: 'Send ₿3 000 more', amountSat: 130_000 });
    expect(at([coin(3_000, false)])).toMatchObject({ title: 'Exit fee sent', subtitle: 'Waiting for a confirmation' });
    expect(at([coin(3_000)])).toMatchObject({ title: 'Exit fee received', subtitle: null });
    expect(at([coin(3_000)]).isAction).toBeFalsy();
  });

  it('asks for the tap only when the build needs the passkey', () => {
    const at = (coins: ReturnType<typeof coin>[]) =>
      row({
        pending: null,
        plan: asking({ status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 }, needsSignIn: true } } }),
        pendingCoins: coins,
      });
    expect(at([coin(3_000)])).toMatchObject({ title: 'Exit fee received', subtitle: 'Tap to update', isAction: true });
    expect(at([])).toMatchObject({ title: 'Waiting for exit fee', subtitle: 'Tap to update', isAction: true });
  });

  it('asks for no tap while a unilateral step is in flight, which the tap cannot build over', () => {
    const inFlight = asking({
      status: { type: 'needsExitFee', topUp: { required: { sat: 3_000, inputs: 1 }, needsSignIn: true } },
      exit: { transactions: [tx({ txid: 's', kind: 'sweep', status: ready })] },
    });
    expect(row({ pending: null, plan: inFlight, pendingCoins: [coin(3_000)] })).toMatchObject({
      title: 'Exit fee received',
      subtitle: 'Waiting for a confirmation',
    });
    expect(row({ pending: null, plan: inFlight, pendingCoins: [coin(3_000)] }).isAction).toBeFalsy();
  });
});

describe("a kept recovery's fee bump", () => {
  const kept = (status: ReturnType<typeof confirmed> | typeof ready) =>
    plan(
      [
        tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready }),
        tx({ txid: 'c2', kind: 'cooperative', nodeId: 'c-2', status }),
      ],
      { mode: 'recover' },
    );

  it('is offered for the recovery while nothing of it has confirmed, and not once part has', () => {
    expect(bumpTxidOf(kept(ready))).toBe('c1');
    expect(bumpTxidOf(kept(confirmed(9)))).toBeNull();
  });
});

describe('a finished exit waiting on a read of what landed', () => {
  it('keeps its row until the archive takes it over', () => {
    const finished = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(9) })], {
      status: { type: 'done' },
      landed: [{ leafIds: ['leaf-1'], valueSat: 100_000, outpoint: 'x:0' }],
    });
    expect(row({ pending: null, plan: finished })).toMatchObject({
      id: 'active',
      title: 'Transactions in progress',
      subtitle: '1 of 1 processed',
      isAction: false,
    });
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
