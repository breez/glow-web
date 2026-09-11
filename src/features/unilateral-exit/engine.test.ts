import { dismissUnilateralExitPlan, getUnilateralExitState, pollIntervalMs, setUnilateralExitPlan, startUnilateralExitEngine, stopUnilateralExitEngine } from './engine';
import { loadPlan } from './driver';
import { confirmed, plan, tx } from './testFixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainClient } from '@/services/chain';

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
