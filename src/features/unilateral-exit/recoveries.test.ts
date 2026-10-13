import { buildRecoveryBump, quoteRecoveryBump } from './recoveries';
import { EmptyRecoveryError } from './building';
import { canBumpRecovery } from './model/plan';
import { checked, confirmed, funding, plan, prepared, ready, sdk, tx, txidOf } from './testFixtures';
import { describe, expect, it, vi } from 'vitest';

describe('raising the fee of a kept co-signed recovery', () => {
  const coLeaf = (leafId: string, valueSats: number) => ({ leafId, valueSats, method: 'cooperative' as const });
  const leaves = [coLeaf('c-1', 30_000), coLeaf('c-2', 18_200)];
  // Sent at 1 sat/vB to its own address, with a leaf whose co-signing failed.
  const kept = (over: Parameters<typeof plan>[1] = {}) =>
    plan(
      [
        tx({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready }),
        tx({ txid: 'c2', kind: 'cooperative', nodeId: 'c-2', status: { type: 'unverified' } }),
      ],
      {
        network: 'regtest',
        mode: 'recover',
        destination: 'bcrt1qmine',
        feeRateSatPerVbyte: 1,
        fundingAddressIndex: 3,
        namedLeaves: [
          { leafId: 'c-1', valueSats: 30_000 },
          { leafId: 'c-2', valueSats: 18_200 },
          { leafId: 'c-9', valueSats: 5_000 },
        ],
        ...over,
        exit: { leaves, recoverableValueSats: 48_200, ...over.exit },
      },
    );
  const bumpQuote = (over: Parameters<typeof prepared>[0] = {}) =>
    prepared({
      leaves,
      recoverableValueSats: 48_200,
      sweepFeeSats: 0,
      cpfpFeeSats: 0,
      cooperativeFeeSats: 1_200,
      totalFeeSats: 1_200,
      funding: undefined,
      feeRateSatPerVbyte: 6,
      destination: 'bcrt1qmine',
      ...over,
    });
  const bumpBuild = (over: Parameters<typeof checked>[1] = {}) =>
    checked(
      [
        { txid: 'c1-bumped', kind: 'cooperative', nodeId: 'c-1' },
        { txid: 'c2-bumped', kind: 'cooperative', nodeId: 'c-2' },
      ],
      { leaves, recoverableValueSats: 48_200, cooperativeFeeSats: 1_200, sweepFeeSats: 0, feeRateSatPerVbyte: 6, destination: 'bcrt1qmine', ...over },
    );

  describe('canBumpRecovery', () => {
    it('offers it while nothing of the recovery has confirmed', () => {
      expect(canBumpRecovery(kept())).toBe(true);
    });

    it('offers none once part of it confirmed, or once it is done or diverged', () => {
      const partly = kept();
      partly.exit.transactions[0] = { ...partly.exit.transactions[0], status: confirmed(90) };
      expect(canBumpRecovery(partly)).toBe(false);
      expect(canBumpRecovery(kept({ status: { type: 'done' } }))).toBe(false);
      expect(canBumpRecovery(kept({ status: { type: 'rebuilding' } }))).toBe(false);
    });
  });

  describe('quoteRecoveryBump', () => {
    it("names exactly the leaves it built, at its own address and the new rate, not the one whose co-signing failed", async () => {
      const prepareRecoverFunds = vi.fn(async () => bumpQuote());
      const quote = await quoteRecoveryBump(sdk({ prepareRecoverFunds }), kept(), 6);

      expect(prepareRecoverFunds).toHaveBeenCalledWith(
        expect.objectContaining({
          feeRateSatPerVbyte: 6,
          destination: 'bcrt1qmine',
          selection: { type: 'specific', leafIds: ['c-1', 'c-2'] },
        }),
      );
      expect(quote).toEqual(bumpQuote());
    });

    it.each([
      ['skips one of its leaves', bumpQuote({ leaves: [leaves[0]], skipped: [{ leafId: 'c-2', valueSats: 18_200, reason: { type: 'feeExceedsValue' } }] })],
      ['leaves one of its leaves out', bumpQuote({ leaves: [leaves[0]] })],
      ['needs funding', bumpQuote({ funding: funding(3_000) })],
      ['would move a leaf unilaterally', bumpQuote({ leaves: [leaves[0], { ...leaves[1], method: 'unilateral' }] })],
    ])('comes back empty when the quote %s', async (_, quote) => {
      const bump = await quoteRecoveryBump(sdk({ prepareRecoverFunds: async () => quote }), kept(), 6);
      expect(bump).toMatchObject({ leaves: [], recoverableValueSats: 0, totalFeeSats: 0, cooperativeFeeSats: 0 });
      expect(bump.funding).toBeUndefined();
    });
  });

  describe('buildRecoveryBump', () => {
    it('builds with no inputs and no signer, into a recovery at the new rate that keeps where it goes', async () => {
      const recoverFunds = vi.fn(async () => bumpBuild());
      const next = await buildRecoveryBump(sdk({ recoverFunds }), kept(), bumpQuote());

      expect(recoverFunds.mock.calls[0]).toEqual([{ prepared: bumpQuote() }]);
      expect(next).toMatchObject({
        mode: 'recover',
        status: { type: 'running' },
        network: 'regtest',
        destination: 'bcrt1qmine',
        feeRateSatPerVbyte: 6,
        fundingAddressIndex: 3,
        quotedSweepFeeSat: 1_200,
      });
      expect(next.exit.transactions.map(t => t.txid)).toEqual(['c1-bumped', 'c2-bumped']);
    });

    it('carries what the recovery dropped and what landed elsewhere, which its record alone keeps', async () => {
      const landed = [{ leafIds: ['c-3'], valueSat: 9_000, outpoint: `${txidOf(5)}:0` }];
      const droppedLeaves = [{ leafId: 'c-4', valueSats: 2_000 }];
      const next = await buildRecoveryBump(sdk({ recoverFunds: async () => bumpBuild() }), kept({ landed, droppedLeaves }), bumpQuote());
      expect(next).toMatchObject({ landed, droppedLeaves });
    });

    it('builds nothing to keep when a leaf it had to replace was left out', async () => {
      const partial = bumpBuild({
        leaves: [leaves[0]],
        transactions: [tx({ txid: 'c1-bumped', kind: 'cooperative', nodeId: 'c-1' })],
        failed: [
          {
            leafId: 'c-2',
            outputTxid: 'o',
            outputVout: 0,
            error: { type: 'replacementFeeTooLow', requiredFeeSats: 1_600, requiredFeeRateSatPerVbyte: 8 },
          },
        ],
      });
      const bump = buildRecoveryBump(sdk({ recoverFunds: async () => partial }), kept(), bumpQuote());
      await expect(bump).rejects.toBeInstanceOf(EmptyRecoveryError);
      await expect(bump).rejects.toMatchObject({ failed: partial.failed, message: 'Please try again or choose a different fee.' });
    });

    it('offers a different fee too when the build comes back with nothing at all', async () => {
      const failed = [
        {
          leafId: 'c-1',
          outputTxid: 'o',
          outputVout: 0,
          error: { type: 'replacementFeeTooLow' as const, requiredFeeSats: 1_600, requiredFeeRateSatPerVbyte: 8 },
        },
      ];
      const bump = buildRecoveryBump(sdk({ recoverFunds: async () => bumpBuild({ leaves: [], transactions: [], failed }) }), kept(), bumpQuote());
      await expect(bump).rejects.toBeInstanceOf(EmptyRecoveryError);
      await expect(bump).rejects.toMatchObject({ failed, message: 'Please try again or choose a different fee.' });
    });

    it('passes on any other refusal as the SDK gave it', async () => {
      const refused = new Error('operators unavailable');
      const bump = buildRecoveryBump(sdk({ recoverFunds: async () => Promise.reject(refused) }), kept(), bumpQuote());
      await expect(bump).rejects.toBe(refused);
    });
  });
});
