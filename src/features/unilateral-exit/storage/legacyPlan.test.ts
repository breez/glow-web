import { loadPlan } from './plan';
import { loadRecoveries } from './recoveries';
import { deriveFundingKey } from '../funding';
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
      version: 5,
      needsRebuild: true,
      phase: 'active',
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

  it('keeps a diverged exit in redo, and a finished one finished', () => {
    store(v4Plan({ phase: 'redo' }));
    expect(loadPlan(wallet)).toMatchObject({ phase: 'redo', needsRebuild: true });
    store(v4Plan({ phase: 'complete' }));
    const done = loadPlan(wallet);
    expect(done?.phase).toBe('complete');
    expect(done?.needsRebuild).toBeUndefined();
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
