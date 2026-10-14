import type { PrepareRecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { logger, LogCategory } from '@/services/logger';
import type { UnilateralExitEngineState } from '../engine/state';
import { namedLeavesOf, type NamedLeaf, type UnilateralExitPlan, type WalletKey } from '../model/plan';
import { stopClock, type StoppedSince } from '../quote';

/**
 * What the Recoverable Funds row subtracts that no live record holds. getInfo
 * counts a dropped leaf for good, and a landed one until a sync recounts after
 * it landed. Kept apart from the archive, which records only exits that paid.
 */
export interface ExitAccounting {
  droppedLeaves: NamedLeaf[];
  unsettledLeaves: NamedLeaf[];
  /** When a Recover Funds quote first showed each leaf it stops, so one never relabelled is dropped. */
  stoppedSince?: StoppedSince;
}

export const noAccounting: ExitAccounting = { droppedLeaves: [], unsettledLeaves: [] };

const key = ({ identityPubkey, network }: WalletKey): string =>
  `unilateral-exit-accounting:${identityPubkey.slice(0, 16)}:${network}`;

const isLeaf = (leaf: unknown): leaf is NamedLeaf =>
  typeof (leaf as NamedLeaf | null)?.leafId === 'string' && typeof (leaf as NamedLeaf).valueSats === 'number';

const leavesIn = (value: unknown): NamedLeaf[] =>
  Array.isArray(value) ? value.filter(isLeaf).map(({ leafId, valueSats }) => ({ leafId, valueSats })) : [];

function datesIn(value: unknown): StoppedSince | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const dates = Object.entries(value).filter(([, height]) => typeof height === 'number');
  return dates.length > 0 ? Object.fromEntries(dates) : undefined;
}

/** By leafId, keeping the larger value: 0 means a value no record knew. */
function merged(leaves: NamedLeaf[], added: NamedLeaf[]): NamedLeaf[] {
  const byId = new Map(leaves.map(leaf => [leaf.leafId, leaf]));
  for (const { leafId, valueSats } of added) {
    if (valueSats > (byId.get(leafId)?.valueSats ?? -1)) byId.set(leafId, { leafId, valueSats });
  }
  return [...byId.values()];
}

export function loadAccounting(wallet: WalletKey): ExitAccounting {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(wallet)) ?? 'null') as Record<string, unknown> | null;
    return {
      droppedLeaves: leavesIn(parsed?.droppedLeaves),
      unsettledLeaves: leavesIn(parsed?.unsettledLeaves),
      stoppedSince: datesIn(parsed?.stoppedSince),
    };
  } catch {
    return noAccounting;
  }
}

/** Applied to what storage holds, not what the caller last saw: a settle and a retirement can interleave. */
function update(
  wallet: WalletKey,
  change: (stored: ExitAccounting) => ExitAccounting,
): { accounting: ExitAccounting; saved: boolean } {
  const accounting = change(loadAccounting(wallet));
  try {
    localStorage.setItem(key(wallet), JSON.stringify(accounting));
    return { accounting, saved: true };
  } catch (e) {
    logger.error(LogCategory.SDK, 'Failed to save the recoverable funds accounting', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { accounting, saved: false };
  }
}

/**
 * The leaves `record` paid out, read off every ledger entry, waiting or not.
 * An entry holds one value for all its leaves, so what the leaves with a known
 * value leave of it goes on the first one without.
 */
export function landedLeavesOf(record: UnilateralExitPlan): NamedLeaf[] {
  const values = new Map([...namedLeavesOf(record), ...record.exit.leaves].map(leaf => [leaf.leafId, leaf.valueSats]));
  return (record.landed ?? []).flatMap(({ leafIds, valueSat }) => {
    const known = leafIds.reduce((sum, id) => sum + (values.get(id) ?? 0), 0);
    const rest = leafIds.find(id => !values.has(id));
    return leafIds.map(leafId => ({
      leafId,
      valueSats: values.get(leafId) ?? (leafId === rest ? Math.max(0, valueSat - known) : 0),
    }));
  });
}

/** Landed leaves no sync has recounted yet: those of ended records, and the live records' own. */
export function unsettledLeaves({
  plan,
  recoveries,
  accounting,
  settledLeafIds,
}: Pick<UnilateralExitEngineState, 'plan' | 'recoveries' | 'accounting' | 'settledLeafIds'>): NamedLeaf[] {
  const live = [plan, ...recoveries].flatMap(record => (record ? landedLeavesOf(record) : []));
  return merged(accounting.unsettledLeaves, live.filter(leaf => !settledLeafIds.has(leaf.leafId)));
}

/**
 * Takes over what `record` accounted for as it ends, paid or not. Null when
 * that could not be stored: the record is then the only place it is kept.
 */
export function retireRecord(wallet: WalletKey, record: UnilateralExitPlan, settledIds: ReadonlySet<string>): ExitAccounting | null {
  const { accounting, saved } = update(wallet, stored => ({
    ...stored,
    droppedLeaves: merged(stored.droppedLeaves, record.droppedLeaves ?? []),
    unsettledLeaves: merged(stored.unsettledLeaves, landedLeavesOf(record).filter(leaf => !settledIds.has(leaf.leafId))),
  }));
  return saved ? accounting : null;
}

export const recordDropped = (wallet: WalletKey, leaves: NamedLeaf[]): ExitAccounting =>
  update(wallet, stored => ({ ...stored, droppedLeaves: merged(stored.droppedLeaves, leaves) })).accounting;

/** Dates at `tipHeight` each leaf `quote` stops that no earlier quote showed. */
export const recordStopped = (wallet: WalletKey, quote: PrepareRecoverFundsResponse, tipHeight: number): ExitAccounting =>
  update(wallet, stored => ({ ...stored, stoppedSince: stopClock(stored.stoppedSince, quote, tipHeight).since })).accounting;

export const settleLeaves = (wallet: WalletKey, ids: string[]): ExitAccounting =>
  update(wallet, stored => ({ ...stored, unsettledLeaves: stored.unsettledLeaves.filter(leaf => !ids.includes(leaf.leafId)) }))
    .accounting;
