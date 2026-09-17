import {
  advanceNow,
  cancelPendingExit,
  dismissUnilateralExitPlan,
  getUnilateralExitState,
  pollIntervalMs,
  setPendingExit,
  setUnilateralExitPlan,
  startPendingExit,
  startUnilateralExitEngine,
  stopUnilateralExitEngine,
} from './engine';
import { loadPendingExit, loadPlan } from './driver';
import { deriveFundingKey } from './funding';
import { checked, coin, confirmed, MNEMONIC, pendingExit, plan, prepared, sdk, tx } from './testFixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainClient, ChainUtxo } from '@/services/chain';

const wallet = { identityPubkey: 'pubkey', network: 'regtest' };

const chain: ChainClient = {
  feeRates: async () => ({ slow: 1, medium: 1, fast: 1 }),
  addressUtxos: async () => [],
  tipHeight: async () => 100,
  broadcast: async () => undefined,
  broadcastPackage: async () => undefined,
};

const done = plan([tx({ txid: 's', kind: 'sweep', status: confirmed(1) })], { network: 'regtest', phase: 'complete' });

describe('the plan the engine holds', () => {
  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
  });

  it('keeps a completed plan on disk so the outcome survives a reload', () => {
    startUnilateralExitEngine(wallet, chain);
    setUnilateralExitPlan(wallet, done);
    expect(loadPlan(wallet)?.phase).toBe('complete');
    expect(getUnilateralExitState().plan?.phase).toBe('complete');
  });

  it('stores a plan even when it is not running for that wallet, for when it does', () => {
    setUnilateralExitPlan(wallet, done);
    expect(getUnilateralExitState().plan).toBeNull();
    startUnilateralExitEngine(wallet, chain);
    expect(getUnilateralExitState().plan?.phase).toBe('complete');
  });

  it('drops the plan once the user acknowledges it, freeing the next exit', () => {
    startUnilateralExitEngine(wallet, chain);
    setUnilateralExitPlan(wallet, done);
    dismissUnilateralExitPlan();
    expect(loadPlan(wallet)).toBeNull();
    expect(getUnilateralExitState().plan).toBeNull();
  });
});

describe('pollIntervalMs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('polls fast on regtest, where blocks come from a keyboard', () => {
    expect(pollIntervalMs('regtest')).toBe(5_000);
  });

  it('leaves a live chain on the slow default', () => {
    expect(pollIntervalMs('mainnet')).toBe(30_000);
  });

  it('lets the environment override any network', () => {
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', '2');
    expect(pollIntervalMs('mainnet')).toBe(2_000);
  });

  it('ignores an override that is not a positive number', () => {
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', 'soon');
    expect(pollIntervalMs('regtest')).toBe(5_000);
    vi.stubEnv('VITE_UNILATERAL_EXIT_POLL_SECS', '0');
    expect(pollIntervalMs('regtest')).toBe(5_000);
  });
});

describe('a pass that outlives its plan', () => {
  // A chain whose tip reads wait until released, so a pass can be held open.
  const held = () => {
    const pending: Array<(height: number) => void> = [];
    const client: ChainClient = { ...chain, tipHeight: () => new Promise(resolve => pending.push(resolve)) };
    return { client, pending };
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
  };
  const firstTxid = () => loadPlan(wallet)?.exit.transactions[0]?.txid;

  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
  });

  it('does not write over a plan rebuilt while it was out', async () => {
    const { client, pending } = held();
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'old' })], { network: 'regtest' }));
    startUnilateralExitEngine(wallet, client);
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'new' })], { network: 'regtest' }));

    pending[0](101);
    await settle();
    expect(firstTxid()).toBe('new');
    expect(getUnilateralExitState().plan?.exit.transactions[0].txid).toBe('new');

    // The rebuilt plan got a pass of its own, which does write.
    pending[1](102);
    await settle();
    expect(getUnilateralExitState().tipHeight).toBe(102);
    expect(firstTxid()).toBe('new');
  });

  it("does not write one wallet's plan under another started while it was out", async () => {
    const { client, pending } = held();
    const other = { identityPubkey: 'other', network: 'regtest' };
    setUnilateralExitPlan(wallet, plan([tx({ txid: 'old' })], { network: 'regtest' }));
    startUnilateralExitEngine(wallet, client);
    stopUnilateralExitEngine();
    startUnilateralExitEngine(other, chain);

    pending[0](101);
    await settle();
    expect(loadPlan(other)).toBeNull();
    expect(getUnilateralExitState().plan).toBeNull();
  });
});

describe('an exit waiting on its fee', () => {
  const holding = (coins: ChainUtxo[]): ChainClient => ({ ...chain, addressUtxos: async () => coins });
  const building = () => {
    const unilateralExit = vi.fn(async () => checked([{ txid: 'fan', kind: 'fanOut' }]));
    return { unilateralExit, driver: sdk({ prepareUnilateralExit: async () => prepared(), unilateralExit }) };
  };

  beforeEach(() => {
    localStorage.clear();
    stopUnilateralExitEngine();
    localStorage.setItem('walletMnemonic', MNEMONIC);
  });

  afterEach(() => {
    stopUnilateralExitEngine();
  });

  it('does not start when its fee confirms, only when the user taps', async () => {
    const { unilateralExit, driver } = building();
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), driver);
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await advanceNow();
    expect(unilateralExit).not.toHaveBeenCalled();

    await startPendingExit();
    expect(getUnilateralExitState().plan?.exit.transactions[0].txid).toBe('fan');
    expect(getUnilateralExitState().pending).toBeNull();
    expect(loadPendingExit(wallet)).toBeNull();
  });

  it('ignores a tap before the fee has confirmed', async () => {
    const { unilateralExit, driver } = building();
    startUnilateralExitEngine(wallet, holding([coin(5_898, false)]), driver);
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(unilateralExit).not.toHaveBeenCalled();
  });

  it('asks for what the build says it still needs', async () => {
    const unilateralExit = vi.fn(async () => {
      throw new Error('Insufficient CPFP funding: need at least 6400 sats');
    });
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), sdk({ prepareUnilateralExit: async () => prepared(), unilateralExit }));
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(loadPendingExit(wallet)?.required).toEqual({ sat: 6_400, inputs: 1 });
    expect(getUnilateralExitState().pending?.required.sat).toBe(6_400);
    expect(getUnilateralExitState().startError).toBeNull();
  });

  it('keeps why a start failed, so the user can try again', async () => {
    const driver = sdk({
      prepareUnilateralExit: async () => prepared(),
      unilateralExit: async () => {
        throw new Error('chain service unreachable');
      },
    });
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), driver);
    setPendingExit(wallet, pendingExit());

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(getUnilateralExitState().startError).toBe('chain service unreachable');
    expect(getUnilateralExitState().isStarting).toBe(false);
    expect(getUnilateralExitState().pending).not.toBeNull();
  });

  it('starts with the key the wizard derived, without a second sign-in', async () => {
    localStorage.removeItem('walletMnemonic');
    localStorage.setItem('passkeyLabel', 'Default');
    const key = deriveFundingKey(MNEMONIC, 'regtest', 0);
    const { driver } = building();
    startUnilateralExitEngine(wallet, holding([coin(5_898)]), driver);
    setPendingExit(wallet, pendingExit({ fundingAddress: key.address }), key);

    await vi.waitFor(() => expect(getUnilateralExitState().pendingCoins).toHaveLength(1));
    await startPendingExit();
    expect(getUnilateralExitState().plan).not.toBeNull();
  });

  it('survives a reload, and forgets the exit once cancelled', () => {
    setPendingExit(wallet, pendingExit());
    startUnilateralExitEngine(wallet, chain);
    expect(getUnilateralExitState().pending).toEqual(pendingExit());

    cancelPendingExit();
    expect(getUnilateralExitState().pending).toBeNull();
    expect(loadPendingExit(wallet)).toBeNull();
  });
});
