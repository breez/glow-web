// THROWAWAY: what the SDK hands the ?recovermock screenshots. Every shot reads
// these, so the walkthrough adds up from one screen to the next. What a screen
// shows is read off them by quote.ts, as in the app.
import type {
  PrepareRecoverFundsResponse,
  RecoverFundsLeaf,
  RecoverFundsResponse,
  RecoveryTransaction,
  SkippedLeaf,
} from '@breeztech/breez-sdk-spark';
import { prepared } from '@/features/unilateral-exit/testFixtures';

export const IDENTITY_PUBKEY = `02ab${'c3'.repeat(31)}`;
export const NETWORK = 'mainnet';
export const BALANCE_SATS = 254_810;
export const DESTINATION = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
export const EXIT_FEE_ADDRESS = 'bc1q9h7garjcvq5jyrrm0jwwnexqlx0ajzw0y8ypkp';

export const FEE_RATES = { slow: 2, medium: 5, fast: 10 };
/** The chain tip the mock chain reports, to the engine and to the page alike. */
export const CHAIN_TIP = 915_400;

/** What each leaf's watchtower transaction already took (191 vB at 5 sat/vB), whatever the recovery's rate. */
const WATCHTOWER_FEE_SAT = 955;
/** One co-signed recovery transaction: its fee is the only part a fee rate moves. */
const RECOVERY_VBYTES = 99;
/** The SDK's cooperative fee for `leaves` leaves at `rate`: the watchtower part plus the recovery's own. */
const cooperativeFee = (leaves: number, rate: number) => leaves * (WATCHTOWER_FEE_SAT + RECOVERY_VBYTES * rate);

/** What recoverFunds returns for `quote`: its leaves and fees, every leaf built, with these transactions. */
export const builtFrom = (quote: PrepareRecoverFundsResponse, transactions: RecoveryTransaction[]): RecoverFundsResponse => ({
  recoverableValueSats: quote.recoverableValueSats,
  totalFeeSats: quote.totalFeeSats,
  cooperativeFeeSats: quote.cooperativeFeeSats,
  cpfpFeeSats: quote.cpfpFeeSats,
  fanoutFeeSats: quote.fanoutFeeSats,
  refundFeeSats: quote.refundFeeSats,
  sweepFeeSats: quote.sweepFeeSats,
  leaves: quote.leaves,
  failed: [],
  transactions,
  fundingInputs: [],
  feeRateSatPerVbyte: quote.feeRateSatPerVbyte,
  destination: quote.destination,
});

/** A quote as prepareRecoverFunds returns it, with no funding unless `over` asks for some. */
const quote = (over: Partial<PrepareRecoverFundsResponse>): PrepareRecoverFundsResponse =>
  prepared({
    destination: DESTINATION,
    feeRateSatPerVbyte: FEE_RATES.medium,
    cpfpFeeSats: 0,
    fanoutFeeSats: 0,
    sweepFeeSats: 0,
    cooperativeFeeSats: 0,
    skipped: [],
    funding: undefined,
    ...over,
  });

/** Watchtower-exited leaves the operators co-sign a recovery for, one transaction each. */
export const COSIGNED_LEAVES: RecoverFundsLeaf[] = [
  { leafId: 'cosigned-1', valueSats: 30_000, method: 'cooperative' },
  { leafId: 'cosigned-2', valueSats: 18_200, method: 'cooperative' },
];
const COSIGNED_SAT = 48_200;

/** Leaves stranded by a sibling exit or an old state: today's exit machinery. */
export const STRANDED_LEAVES: RecoverFundsLeaf[] = [
  { leafId: 'leaf-1', valueSats: 60_000, method: 'unilateral' },
  { leafId: 'leaf-2', valueSats: 40_000, method: 'unilateral' },
  { leafId: 'leaf-3', valueSats: 20_000, method: 'unilateral' },
];
export const STRANDED_SAT = 120_000;

/** A dust-sized leaf no fee rate moves. */
export const DUST_SAT = 350;
const dustSkipped = (leafId: string): SkippedLeaf => ({ leafId, valueSats: DUST_SAT, reason: { type: 'feeExceedsValue' } });

/** The co-signed leaves at `rate`: no funding, the operators' fee off the funds. */
export const cosignedQuote = (rate = FEE_RATES.medium, skipped: SkippedLeaf[] = []) =>
  quote({
    leaves: COSIGNED_LEAVES,
    recoverableValueSats: COSIGNED_SAT,
    totalFeeSats: cooperativeFee(2, rate),
    cooperativeFeeSats: cooperativeFee(2, rate),
    skipped,
    feeRateSatPerVbyte: rate,
  });
export const COSIGNED_QUOTE = cosignedQuote();

/** The same, with a dust leaf left out: at this rate its recovery costs more than it holds. */
export const LEFT_OUT_QUOTE = cosignedQuote(FEE_RATES.medium, [dustSkipped('cosigned-3')]);

/** One coin funds all three branches through a fan-out; per-branch funding skips it. */
const STRANDED_FUNDING = {
  cpfpFeeSats: 13_000,
  fanoutFeeSats: 1_350,
  funding: {
    singleUtxoSats: 14_350,
    perBranch: STRANDED_LEAVES.map(leaf => ({ leafId: leaf.leafId, fundingSats: 4_334 })),
  },
};

/** The stranded leaves before anything is on-chain: funded from another wallet. */
export const STRANDED_QUOTE = quote({
  leaves: STRANDED_LEAVES,
  recoverableValueSats: STRANDED_SAT,
  sweepFeeSats: 1_100,
  ...STRANDED_FUNDING,
  totalFeeSats: 15_450,
});

/** Those leaves once their refunds are on-chain: only the sweep is left, and it pays its own fee. */
export const SWEEP_ONLY_QUOTE = quote({
  leaves: STRANDED_LEAVES,
  recoverableValueSats: STRANDED_SAT,
  sweepFeeSats: 1_100,
  totalFeeSats: 1_100,
});

/** Both kinds at once, as one sync finds them. */
export const MIXED_QUOTE = quote({
  leaves: [...STRANDED_LEAVES, ...COSIGNED_LEAVES],
  recoverableValueSats: STRANDED_SAT + COSIGNED_SAT,
  sweepFeeSats: 1_100,
  ...STRANDED_FUNDING,
  cooperativeFeeSats: cooperativeFee(2, FEE_RATES.medium),
  totalFeeSats: 15_450 + cooperativeFee(2, FEE_RATES.medium),
});

/** Nothing but a dust leaf, which the quote leaves out. */
export const DUST_QUOTE = quote({ leaves: [], recoverableValueSats: 0, totalFeeSats: 0, skipped: [dustSkipped('dust-1')] });

/** Only the tracker's transaction count shows how the balance splits. */
const DEV_EXIT_LEAVES: RecoverFundsLeaf[] = [
  { leafId: 'leaf-1', valueSats: 131_072, method: 'unilateral' },
  { leafId: 'leaf-2', valueSats: 65_536, method: 'unilateral' },
  { leafId: 'leaf-3', valueSats: 58_202, method: 'unilateral' },
];

/** The wallet's own unilateral exit in ux-13: an `all` quote of its balance. */
export const DEV_EXIT = {
  leaves: DEV_EXIT_LEAVES,
  sweepFeeSats: 3_200,
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
  sweepFeeSats: DEV_EXIT.sweepFeeSats - RECOVERY_VBYTES * FEE_RATES.medium,
};

/** The co-signed recovery's two transactions, as Glow keeps them. */
export const COSIGNED_TXIDS = [`a4${'3f'.repeat(31)}`, `b7${'3f'.repeat(31)}`];
/** The two that replace them once the fee is raised. */
export const BUMPED_TXIDS = [`d9${'3f'.repeat(31)}`, `e2${'3f'.repeat(31)}`];
