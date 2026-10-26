import { loadPlan } from './plan';
import { loadRecoveries } from './recoveries';
import { deriveFundingKey } from '../funding';
import type { ExitStatus } from '../model/plan';
import { exitFeeRecordOf } from '../quote';
import { MNEMONIC, plan, tx, v4Plan } from '../testFixtures';
import { beforeEach, describe, expect, it } from 'vitest';

describe('a plan stored under SDK 0.26', () => {
  const wallet = { identityPubkey: '02abcdef0123456789', network: 'mainnet' };
  const key = `recovery-plan:${wallet.identityPubkey.slice(0, 16)}:mainnet`;
  const store = (stored: unknown) => localStorage.setItem(key, JSON.stringify(stored));

  beforeEach(() => localStorage.clear());

  it('is converted rather than dropped, keeping everything the exit was built with', () => {
    store(v4Plan());
    const loaded = loadPlan(wallet);
    expect(loaded).toMatchObject({
      version: 6,
      status: { type: 'running' },
      destination: 'bc1qold',
      feeRateSatPerVbyte: 3,
      fundingAddressIndex: 1,
      quotedSweepFeeSat: 215,
      quotedExitFeeSat: 14_350,
      exitStateSnapshot: 'frozen',
      refusals: { 'refund-1': 'non-BIP68-final' },
    });
    expect(loaded?.exit).toMatchObject({
      recoverableValueSats: 600_000,
      totalFeeSats: 3_122,
      cooperativeFeeSats: 0,
      cpfpFeeSats: 2_907,
      fanoutFeeSats: 0,
      sweepFeeSats: 215,
      failed: [],
      feeRateSatPerVbyte: 3,
      destination: 'bc1qold',
      leaves: [
        { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
        { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
      ],
      fundingInputs: [expect.objectContaining({ txid: 'fund', valueSats: 14_350 })],
    });
    expect(loaded?.exit.fundingInputs[0]).not.toHaveProperty('value');
    expect(loaded?.exit.transactions.map(t => t.txid)).toEqual(['node-1', 'refund-1']);
  });

  it('still reads its exit fee off the coins it spent, as main never kept the address', () => {
    store(v4Plan({ quotedExitFeeSat: undefined }));
    expect(exitFeeRecordOf(loadPlan(wallet)!)).toEqual({
      quotedExitFeeSat: 14_350,
      exitFeeAddress: deriveFundingKey(MNEMONIC, 'mainnet', 1).address,
    });
  });

  it('keeps a diverged exit rebuilding, and a finished one finished', () => {
    store(v4Plan({ phase: 'redo' }));
    expect(loadPlan(wallet)?.status).toEqual({ type: 'rebuilding' });
    store(v4Plan({ phase: 'complete' }));
    expect(loadPlan(wallet)?.status).toEqual({ type: 'done' });
  });

  it('drops the co-signed recoveries kept before, which only ever held mock data', () => {
    const kept = plan([tx({ txid: 'c', kind: 'cooperative' })], { mode: 'recover' });
    localStorage.setItem(
      `recovery-cosigned:${wallet.identityPubkey.slice(0, 16)}:mainnet`,
      JSON.stringify([{ ...kept, version: 4 }, kept]),
    );
    expect(loadRecoveries(wallet)).toEqual([{ ...kept, namedLeaves: [{ leafId: 'leaf-1', valueSats: 100_000 }] }]);
  });
});

describe('a plan stored as version 5', () => {
  const wallet = { identityPubkey: '02abcdef0123456789', network: 'mainnet' };
  const key = `recovery-plan:${wallet.identityPubkey.slice(0, 16)}:mainnet`;
  const loaded = (stored: Record<string, unknown>) => {
    localStorage.setItem(key, JSON.stringify(stored));
    return loadPlan(wallet);
  };

  beforeEach(() => localStorage.clear());

  it.each<[string, ExitStatus]>([
    ['active', { type: 'running' }],
    ['redo', { type: 'rebuilding' }],
    ['complete', { type: 'done' }],
  ])('turns the %s phase into the status it meant, keeping the rest', (phase, status) => {
    const stored: Record<string, unknown> = { ...plan([tx({ txid: 'a' })], { quotedExitFeeSat: 5_000 }), version: 5, phase };
    delete stored.status;
    const next = loaded(stored);
    expect(next).toMatchObject({ version: 6, quotedExitFeeSat: 5_000 });
    expect(next?.status).toEqual(status);
    expect(next).not.toHaveProperty('phase');
  });

  it('converts kept co-signed recoveries too, rather than dropping them', () => {
    const kept = plan([tx({ txid: 'c', kind: 'cooperative', nodeId: 'leaf-1' })], { mode: 'recover' });
    const asV5 = (phase: string) => {
      const stored: Record<string, unknown> = { ...kept, version: 5, phase };
      delete stored.status;
      return stored;
    };
    localStorage.setItem(`recovery-cosigned:${wallet.identityPubkey.slice(0, 16)}:mainnet`, JSON.stringify([asV5('active'), asV5('redo')]));
    expect(loadRecoveries(wallet).map(r => r.status)).toEqual([{ type: 'running' }, { type: 'rebuilding' }]);
  });
});
