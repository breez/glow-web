// THROWAWAY: what the SDK hands the ?recovermock screenshots. Every shot reads
// these, so the walkthrough adds up from one screen to the next. What a screen
// shows is read off them by quote.ts, as in the app.
import type { PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark';
import { prepared } from '@/features/unilateral-exit/testFixtures';

export const IDENTITY_PUBKEY = `02ab${'c3'.repeat(31)}`;
export const NETWORK = 'mainnet';
export const BALANCE_SATS = 254_810;
export const DESTINATION = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
export const EXIT_FEE_ADDRESS = 'bc1q9h7garjcvq5jyrrm0jwwnexqlx0ajzw0y8ypkp';

export const FEE_RATES = { slow: 2, medium: 5, fast: 10 };
/** A stuck co-signed recovery re-quoted above its 5 sat/vB. */
export const BUMP_RATES = { slow: 6, medium: 7, fast: 10 };

/** What each leaf's watchtower transaction already took (191 vB at 5 sat/vB), whatever the recovery's rate. */
const WATCHTOWER_FEE_SAT = 955;
/** One co-signed recovery transaction: its fee is the only part a fee rate moves. */
const RECOVERY_VBYTES = 99;
/** The SDK's cooperative fee for `leaves` leaves at `rate`: the watchtower part plus the recovery's own. */
const cooperativeFee = (leaves: number, rate: number) => leaves * (WATCHTOWER_FEE_SAT + RECOVERY_VBYTES * rate);

interface SkippedLeaf {
  leafId: string;
  valueSats: number;
  reason: { type: string };
}

/** A quote as the recover-funds API returns it, on today's type: leaf methods, the co-signed fee, the skipped list. */
const quote = (
  over: Partial<PrepareUnilateralExitResponse>,
  api: { cooperativeFeeSats?: number; skipped?: SkippedLeaf[] } = {},
): PrepareUnilateralExitResponse =>
  ({
    ...prepared({
      destination: DESTINATION,
      feeRateSatPerVbyte: FEE_RATES.medium,
      cpfpFeeSat: 0,
      fanoutFeeSat: 0,
      sweepFeeSat: 0,
      singleUtxoFundingSat: 0,
      ...over,
    }),
    cooperativeFeeSats: 0,
    skipped: [],
    ...api,
  }) as PrepareUnilateralExitResponse;

type Leaf = { leafId: string; value: number; method: 'cooperative' | 'unilateral' };

/** Watchtower-exited leaves the operators co-sign a recovery for, one transaction each. */
export const COSIGNED_LEAVES: Leaf[] = [
  { leafId: 'cosigned-1', value: 30_000, method: 'cooperative' },
  { leafId: 'cosigned-2', value: 18_200, method: 'cooperative' },
];
const COSIGNED_SAT = 48_200;

/** Leaves stranded by a sibling exit or an old state: today's exit machinery. */
export const STRANDED_LEAVES: Leaf[] = [
  { leafId: 'leaf-1', value: 60_000, method: 'unilateral' },
  { leafId: 'leaf-2', value: 40_000, method: 'unilateral' },
  { leafId: 'leaf-3', value: 20_000, method: 'unilateral' },
];
export const STRANDED_SAT = 120_000;

/** A dust-sized leaf no fee rate moves. */
export const DUST_SAT = 350;
const dustSkipped = (leafId: string): SkippedLeaf => ({ leafId, valueSats: DUST_SAT, reason: { type: 'feeExceedsValue' } });

/** The co-signed leaves at `rate`: no funding, the operators' fee off the funds. */
export const cosignedQuote = (rate = FEE_RATES.medium, skipped: SkippedLeaf[] = []) =>
  quote(
    { leaves: COSIGNED_LEAVES, recoverableValueSat: COSIGNED_SAT, totalFeeSat: cooperativeFee(2, rate), feeRateSatPerVbyte: rate },
    { cooperativeFeeSats: cooperativeFee(2, rate), skipped },
  );
export const COSIGNED_QUOTE = cosignedQuote();

/** The same, with a dust leaf left out: at this rate its recovery costs more than it holds. */
export const LEFT_OUT_QUOTE = cosignedQuote(FEE_RATES.medium, [dustSkipped('cosigned-3')]);

const STRANDED_FUNDING = { cpfpFeeSat: 13_000, fanoutFeeSat: 1_350, singleUtxoFundingSat: 14_350 };

/** The stranded leaves before anything is on-chain: funded from another wallet. */
export const STRANDED_QUOTE = quote({
  leaves: STRANDED_LEAVES,
  recoverableValueSat: STRANDED_SAT,
  sweepFeeSat: 1_100,
  ...STRANDED_FUNDING,
  totalFeeSat: 15_450,
});

/** Those leaves once their refunds are on-chain: only the sweep is left, and it pays its own fee. */
export const SWEEP_ONLY_QUOTE = quote({
  leaves: STRANDED_LEAVES,
  recoverableValueSat: STRANDED_SAT,
  sweepFeeSat: 1_100,
  totalFeeSat: 1_100,
});

/** Both kinds at once, as one sync finds them. */
export const MIXED_QUOTE = quote(
  {
    leaves: [...STRANDED_LEAVES, ...COSIGNED_LEAVES],
    recoverableValueSat: STRANDED_SAT + COSIGNED_SAT,
    sweepFeeSat: 1_100,
    ...STRANDED_FUNDING,
    totalFeeSat: 15_450 + cooperativeFee(2, FEE_RATES.medium),
  },
  { cooperativeFeeSats: cooperativeFee(2, FEE_RATES.medium) },
);

/** Nothing but a dust leaf, which the quote leaves out. */
export const DUST_QUOTE = quote({ leaves: [], recoverableValueSat: 0, totalFeeSat: 0 }, { skipped: [dustSkipped('dust-1')] });

/** The wallet's own unilateral exit in ux-13: today's `auto` quote of its balance. */
export const DEV_EXIT = {
  /** Only the tracker's transaction count shows how the balance splits. */
  leaves: [
    { leafId: 'leaf-1', value: 131_072 },
    { leafId: 'leaf-2', value: 65_536 },
    { leafId: 'leaf-3', value: 58_202 },
  ],
  sweepFeeSat: 3_200,
  exitFeeSat: 36_900,
};

/**
 * ux-13: the leaf of the user's own exit the watchtower moved, co-signed back
 * into that exit. The sweep is left with two refunds and costs one input less,
 * 495, which is what the co-signed transaction costs.
 */
export const MOVED = {
  leafId: 'leaf-3',
  cooperativeFeeSats: cooperativeFee(1, FEE_RATES.medium),
  sweepFeeSat: DEV_EXIT.sweepFeeSat - RECOVERY_VBYTES * FEE_RATES.medium,
};

/** The co-signed recovery's two transactions, as Glow keeps them. */
export const COSIGNED_TXIDS = [`a4${'3f'.repeat(31)}`, `b7${'3f'.repeat(31)}`];

/** What a finished recovery's watchtower refund left unspent at the exit fee address. */
export const UNSPENT_EXIT_FEE_SAT = 650;
