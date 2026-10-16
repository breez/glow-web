import { broadcastReadyTransactions, isSendable } from './broadcast';
import { blocked, chain, confirmed, locked, plan, ready, tx } from './testFixtures';
import { describe, expect, it, vi } from 'vitest';

describe('broadcastReadyTransactions', () => {
  it('sends a package when the step has a cpfp child', async () => {
    const broadcastPackage = vi.fn(async () => undefined);
    await broadcastReadyTransactions(plan([tx({ txid: 'a', cpfpTxHex: 'bb' })]), chain({ broadcastPackage }));
    expect(broadcastPackage).toHaveBeenCalledWith('aa', 'bb');
  });

  it('leaves a step the sdk is still waiting on alone', async () => {
    const broadcast = vi.fn(async () => undefined);
    await broadcastReadyTransactions(plan([tx({ txid: 'a', status: blocked })]), chain({ broadcast }));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('sends a ready step on every pass, so one the mempool dropped is put back', async () => {
    const broadcast = vi.fn(async () => undefined);
    const client = chain({ broadcast });
    const once = await broadcastReadyTransactions(plan([tx({ txid: 'a' })]), client);
    await broadcastReadyTransactions(once, client);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('keeps a refusal on the step without giving up on it', async () => {
    const client = chain({
      broadcast: async () => {
        throw new Error('bad-txns-inputs-missingorspent');
      },
    });
    const after = await broadcastReadyTransactions(plan([tx({ txid: 'a' })]), client);
    expect(after.refusals.a).toMatch(/missingorspent/);
    expect(isSendable(after.exit.transactions[0])).toBe(true);
  });

  it('clears the refusal once the network takes the step', async () => {
    const after = await broadcastReadyTransactions(plan([tx({ txid: 'a' })], { refusals: { a: 'min relay fee not met' } }), chain());
    expect(after.refusals).toEqual({});
  });
});

describe('isSendable', () => {
  it('takes the sdk word that a step can go out now', () => {
    expect(isSendable(tx({ txid: 'a', status: ready }))).toBe(true);
  });

  it('holds a step back while the sdk is waiting on something', () => {
    expect(isSendable(tx({ txid: 'a', status: blocked }))).toBe(false);
    expect(isSendable(tx({ txid: 'b', status: locked(244) }))).toBe(false);
    expect(isSendable(tx({ txid: 'c', status: { type: 'unverified' } }))).toBe(false);
    expect(isSendable(tx({ txid: 'd', status: confirmed(90) }))).toBe(false);
  });

  it('sends a co-signed recovery the sdk could not verify, which the network refuses if its funds moved', () => {
    expect(isSendable(tx({ txid: 'c', kind: 'cooperative', status: { type: 'unverified' } }))).toBe(true);
    expect(isSendable(tx({ txid: 'd', kind: 'cooperative', status: confirmed(90) }))).toBe(false);
  });
});
