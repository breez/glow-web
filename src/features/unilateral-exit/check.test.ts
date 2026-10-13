import { applyExitCheck, checkExit } from './check';
import { checked, checking, confirmed, plan, ready, redo, sdk, tx } from './testFixtures';
import { describe, expect, it, vi } from 'vitest';
import type { CheckRecoverFundsRequest } from '@breeztech/breez-sdk-spark';

describe('applyExitCheck', () => {
  it('takes the sdk word on the whole exit', () => {
    const exit = checked([{ txid: 'a', status: confirmed(812_345) }], { sweepFeeSats: 250 });
    expect(applyExitCheck(plan([tx({ txid: 'a' })]), exit, 'active').exit).toBe(exit);
  });

  it('keeps the refusal on a step that is still out there', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' })], { refusals: { a: 'txn-mempool-conflict' } }),
      checked([{ txid: 'a', status: ready }]),
      'active',
    );
    expect(next.refusals).toEqual({ a: 'txn-mempool-conflict' });
  });

  it('drops the refusal once the step has confirmed, or is no longer in the set', () => {
    const next = applyExitCheck(
      plan([tx({ txid: 'a' }), tx({ txid: 'b' })], { refusals: { a: 'conflict', b: 'conflict' } }),
      checked([{ txid: 'a', status: confirmed(1) }]),
      'active',
    );
    expect(next.refusals).toEqual({});
  });

  it('sets the phase', () => {
    const next = applyExitCheck(plan([tx({ txid: 'a' })]), checked([{ txid: 'a' }]), 'complete');
    expect(next.phase).toBe('complete');
  });

  describe('a tap asked for over a step the SDK could not read', () => {
    const unverified = { type: 'unverified' } as const;
    const waiting = plan([tx({ txid: 'a', status: unverified })], { needsSignIn: true, redoCause: 'unverified' });

    it('stands while the step does', () => {
      expect(applyExitCheck(waiting, checked([{ txid: 'a', status: unverified }]), 'active')).toMatchObject({
        needsSignIn: true,
        redoCause: 'unverified',
      });
    });

    it('ends once the step settles, or the chain diverges, so a later divergence reads as one', () => {
      for (const [status, phase] of [[ready, 'active'], [unverified, 'redo']] as const) {
        const next = applyExitCheck(waiting, checked([{ txid: 'a', status }]), phase);
        expect(next.redoCause).toBeUndefined();
        expect(next.needsSignIn).toBeUndefined();
      }
    });

    it("leaves a converted exit's sign-in alone, which waits on no such step", () => {
      const converted = plan([tx({ txid: 'a' })], { needsRebuild: true, needsSignIn: true });
      expect(applyExitCheck(converted, checked([{ txid: 'a' }]), 'active').needsSignIn).toBe(true);
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
    [{ type: 'valid' } as const, 'active'],
    [{ type: 'done' } as const, 'complete'],
    [redo, 'redo'],
  ])('turns the %o verdict into the %s phase', async (verdict, phase) => {
    expect((await checkExit(plan([tx({ txid: 'a' })]), checking(checked([{ txid: 'a' }]), verdict))).phase).toBe(phase);
  });
});
