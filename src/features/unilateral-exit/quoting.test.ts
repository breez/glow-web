import { quoteFresh } from './quoting';
import { keptLeafIds } from './model/plan';
import { plan, prepared, ready, sdk, tx } from './testFixtures';
import { describe, expect, it, vi } from 'vitest';

describe('what a fresh quote leaves to kept recoveries', () => {
  const kept = (over: Parameters<typeof tx>[0], refusals: Record<string, string> = {}) =>
    plan([tx(over)], {
      mode: 'recover',
      refusals,
      exit: { leaves: [{ leafId: over.nodeId ?? '', valueSats: 30_000, method: 'cooperative' }] },
    });

  it('holds a kept leaf while its recovery is out, refused or not', () => {
    expect(keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: ready })])).toEqual(new Set(['c-1']));
    expect(keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } })])).toEqual(
      new Set(['c-1']),
    );
    expect(
      keptLeafIds([kept({ txid: 'c1', kind: 'cooperative', nodeId: 'c-1', status: { type: 'unverified' } }, { c1: 'bad-txns-inputs-missingorspent' })]),
    ).toEqual(new Set(['c-1']));
  });

  it('quotes the other leaves again by name, and keeps what both quotes skipped', async () => {
    const prepareRecoverFunds = vi
      .fn()
      .mockResolvedValueOnce(
        prepared({
          leaves: [
            { leafId: 'c-1', valueSats: 30_000, method: 'cooperative' },
            { leafId: 's-1', valueSats: 60_000, method: 'unilateral' },
          ],
          skipped: [
            { leafId: 'dust', valueSats: 350, reason: { type: 'feeExceedsValue' } },
            { leafId: 'c-1', valueSats: 30_000, reason: { type: 'unverified' } },
          ],
        }),
      )
      .mockResolvedValueOnce(prepared({ skipped: [{ leafId: 's-2', valueSats: 900, reason: { type: 'unverified' } }] }));
    const quote = await quoteFresh(sdk({ prepareRecoverFunds }), { feeRateSatPerVbyte: 2, destination: 'bc1qdest' }, 'recover', new Set(['c-1']));

    expect(prepareRecoverFunds).toHaveBeenNthCalledWith(1, expect.objectContaining({ selection: { type: 'recoverableOnly' } }));
    expect(prepareRecoverFunds).toHaveBeenNthCalledWith(2, expect.objectContaining({ selection: { type: 'specific', leafIds: ['s-1'] } }));
    expect(quote.skipped.map(leaf => leaf.leafId)).toEqual(['s-2', 'dust']);
  });

  it('quotes nothing when the kept recoveries hold every leaf', async () => {
    const prepareRecoverFunds = vi.fn(async () => prepared({ leaves: [{ leafId: 'c-1', valueSats: 30_000, method: 'cooperative' }] }));
    const quote = await quoteFresh(sdk({ prepareRecoverFunds }), { feeRateSatPerVbyte: 2, destination: 'bc1qdest' }, undefined, new Set(['c-1']));
    expect(prepareRecoverFunds).toHaveBeenCalledTimes(1);
    expect(quote).toMatchObject({ leaves: [], recoverableValueSats: 0, totalFeeSats: 0 });
    expect(quote.funding).toBeUndefined();
  });
});
