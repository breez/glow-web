import { applyExitCheck, checkExit } from './check';
import { checked, checking, confirmed, plan, ready, redo, sdk, tx } from './testFixtures';
import { describe, expect, it, vi } from 'vitest';
import type { CheckRecoverFundsRequest } from '@breeztech/breez-sdk-spark';

describe('applyExitCheck', () => {
  it('takes the sdk word on the whole exit', () => {
    const exit = checked([{ txid: 'a', status: confirmed(812_345) }], { sweepFeeSats: 250 });
    expect(applyExitCheck(plan([tx({ txid: 'a' })]), exit, 'valid').exit).toBe(exit);
  });

  it('keeps the refusal on a step that is still out there', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' })], { refusals: { a: 'txn-mempool-conflict' } }),
      checked([{ txid: 'a', status: ready }]),
      'valid',
    );
    expect(next.refusals).toEqual({ a: 'txn-mempool-conflict' });
  });

  it('drops the refusal once the step has confirmed, or is no longer in the set', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' }), tx({ txid: 'b' })], { refusals: { a: 'conflict', b: 'conflict' } }),
      checked([{ txid: 'a', status: confirmed(1) }]),
      'valid',
    );
    expect(next.refusals).toEqual({});
  });

  it('finishes the exit on the done verdict, and starts rebuilding it on redo', () => {
    expect(applyExitCheck(plan([tx({ txid: 'a' })]), checked([{ txid: 'a' }]), 'done').status).toEqual({ type: 'done' });
    expect(applyExitCheck(plan([tx({ txid: 'a' })]), checked([{ txid: 'a' }]), 'redo').status).toEqual({ type: 'rebuilding' });
  });

  it('keeps a running exit as it is on the valid verdict, a converted one or one waiting on exit fee included', () => {
    const topUp = { required: { sat: 3_000, inputs: 1 } };
    for (const status of [{ type: 'running', converted: true }, { type: 'needsExitFee', topUp }] as const) {
      expect(applyExitCheck(plan([tx({ txid: 'a' })], { status }), checked([{ txid: 'a' }]), 'valid').status).toEqual(status);
    }
  });

  it('runs a diverged exit again once the chain matches it, keeping when its rebuilds started failing', () => {
    const failing = plan([tx({ txid: 'a' })], { status: { type: 'needsUpdate', why: 'rebuildFailed' }, rebuildFailingSince: 90 });
    expect(applyExitCheck(failing, checked([{ txid: 'a' }]), 'valid')).toMatchObject({ status: { type: 'running' }, rebuildFailingSince: 90 });
    const rebuilding = plan([tx({ txid: 'a' })], { status: { type: 'rebuilding' } });
    expect(applyExitCheck(rebuilding, checked([{ txid: 'a' }]), 'valid').status).toEqual({ type: 'running' });
  });

  describe('a tap asked for over a step the SDK could not read', () => {
    const unverified = { type: 'unverified' } as const;
    const asking = { type: 'needsUpdate', why: 'signIn', cause: 'unverified' } as const;
    const waiting = plan([tx({ txid: 'a', status: unverified })], { status: asking });

    it('stands while the step does', () => {
      expect(applyExitCheck(waiting, checked([{ txid: 'a', status: unverified }]), 'valid').status).toEqual(asking);
    });

    it('ends once the step settles, or the chain diverges, so a later divergence reads as one', () => {
      expect(applyExitCheck(waiting, checked([{ txid: 'a', status: ready }]), 'valid').status).toEqual({ type: 'running' });
      expect(applyExitCheck(waiting, checked([{ txid: 'a', status: unverified }]), 'redo').status).toEqual({ type: 'rebuilding' });
    });
  });
});

describe('checkExit', () => {
  it('hands the sdk the exit it stored, untouched', async () => {
    const stored = plan([tx({ txid: 'a', cpfpTxHex: 'bb', dependsOn: ['x'] })], { refusals: { a: 'refused' } });
    const checkRecoverFunds = vi.fn(async (_request: CheckRecoverFundsRequest) => ({
      recovery: checked([{ txid: 'a', status: confirmed(9) }]),
      verdict: { type: 'valid' as const },
    }));
    const next = await checkExit(stored, sdk({ checkRecoverFunds }));
    expect(checkRecoverFunds.mock.calls[0][0].recovery).toBe(stored.exit);
    expect(next.exit.transactions[0].status).toEqual(confirmed(9));
  });

  it.each([
    [{ type: 'valid' } as const, 'running'],
    [{ type: 'done' } as const, 'done'],
    [redo, 'rebuilding'],
  ])('turns the %o verdict into the %s status', async (verdict, status) => {
    expect((await checkExit(plan([tx({ txid: 'a' })]), checking(checked([{ txid: 'a' }]), verdict))).status).toEqual({ type: status });
  });
});
