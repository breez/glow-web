// THROWAWAY: figures for the ?recovermock screenshots. Every shot reads these,
// so the walkthrough adds up from one screen to the next.

export const IDENTITY_PUBKEY = `02ab${'c3'.repeat(31)}`;
export const NETWORK = 'mainnet';
export const BALANCE_SATS = 254_810;
export const DESTINATION = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
export const EXIT_FEE_ADDRESS = 'bc1q9h7garjcvq5jyrrm0jwwnexqlx0ajzw0y8ypkp';

export const FEE_RATES = { slow: 2, medium: 5, fast: 10 };

/** What each leaf's watchtower transaction already took (191 vB at 5 sat/vB), whatever the recovery's rate. */
const WATCHTOWER_FEE_SAT = 955;
/** One co-signed recovery transaction: its fee is the only part a fee rate moves. */
const RECOVERY_VBYTES = 99;
/** The cooperative fee for `leaves` leaves at `rate`: the watchtower part plus the recovery's own. */
const cooperativeFee = (leaves: number, rate: number) => leaves * (WATCHTOWER_FEE_SAT + RECOVERY_VBYTES * rate);

/** Watchtower-exited leaves the operators co-sign a recovery for, one transaction each. */
export const COSIGNED = {
  leafSats: [30_000, 18_200],
  totalSat: 48_200,
  /** 495 recovery + 955 watchtower. */
  feePerLeafSat: cooperativeFee(1, FEE_RATES.medium), // 1 450
  networkFeeSat: cooperativeFee(2, FEE_RATES.medium), // 2 900
  willReceiveSat: 48_200 - cooperativeFee(2, FEE_RATES.medium), // 45 300
  feeBySpeed: {
    slow: cooperativeFee(2, FEE_RATES.slow), // 2 306
    medium: cooperativeFee(2, FEE_RATES.medium), // 2 900
    fast: cooperativeFee(2, FEE_RATES.fast), // 3 890
  },
};

/** Leaves stranded by a sibling exit or an old state: today's exit machinery. */
export const STRANDED = {
  totalSat: 120_000,
  exitFeeSat: 14_350,
  networkFeeSat: 1_100,
  willReceiveSat: 118_900,
  feeBySpeed: { slow: 6_180, medium: 15_450, fast: 30_900 },
};

export const MIXED = {
  totalSat: STRANDED.totalSat + COSIGNED.totalSat, // 168 200
  exitFeeSat: STRANDED.exitFeeSat,
  networkFeeSat: STRANDED.networkFeeSat + COSIGNED.networkFeeSat, // 4 000
  willReceiveSat: STRANDED.willReceiveSat + COSIGNED.willReceiveSat, // 164 200
  feeBySpeed: {
    slow: STRANDED.feeBySpeed.slow + COSIGNED.feeBySpeed.slow, // 8 486
    medium: STRANDED.feeBySpeed.medium + COSIGNED.feeBySpeed.medium, // 18 350
    fast: STRANDED.feeBySpeed.fast + COSIGNED.feeBySpeed.fast, // 34 790
  },
};

/** The stuck co-signed recovery of both leaves, re-quoted above its 5 sat/vB. */
const BUMP_RATES = { slow: 6, medium: 7, fast: 10 };
export const BUMP = {
  fundsSat: COSIGNED.totalSat,
  networkFeeSat: cooperativeFee(2, BUMP_RATES.medium), // 3 296
  willReceiveSat: COSIGNED.totalSat - cooperativeFee(2, BUMP_RATES.medium), // 44 904
  feeBySpeed: {
    slow: cooperativeFee(2, BUMP_RATES.slow), // 3 098
    medium: cooperativeFee(2, BUMP_RATES.medium), // 3 296
    fast: cooperativeFee(2, BUMP_RATES.fast), // 3 890
  },
};

/** A dust-sized total no fee rate moves. */
export const DUST_SAT = 350;

/**
 * The developer-mode exit quote for shot 01's wallet. Today `auto` moves the
 * balance, and its "You'll receive" comes from the shipped driver. The proposed
 * `all` adds the co-signed funds, with their fee in the network fee.
 */
export const DEV_EXIT = {
  balanceSat: BALANCE_SATS,
  /** Only the tracker's transaction count shows how the balance splits. */
  leaves: [
    { leafId: 'leaf-1', value: 131_072 },
    { leafId: 'leaf-2', value: 65_536 },
    { leafId: 'leaf-3', value: 58_202 },
  ],
  sweepFeeSat: 3_200,
  exitFeeSat: 36_900,
  proposed: {
    fundsSat: BALANCE_SATS + COSIGNED.totalSat, // 303 010
    networkFeeSat: 3_200 + COSIGNED.networkFeeSat, // 6 100
    willReceiveSat: BALANCE_SATS + COSIGNED.totalSat - (3_200 + COSIGNED.networkFeeSat), // 296 910
  },
};

const MOVED_SWEEP_FEE_SAT = DEV_EXIT.sweepFeeSat - RECOVERY_VBYTES * FEE_RATES.medium; // 2 705
const MOVED_SWEPT_SAT = 131_072 + 65_536 - MOVED_SWEEP_FEE_SAT; // 193 903
const MOVED_COSIGNED_SAT = 58_202 - COSIGNED.feePerLeafSat; // 56 752

/**
 * ux-13: the leaf of the user's own exit the watchtower moved, co-signed back
 * into that exit. The sweep is left with two refunds and costs one input less,
 * 495, which is what the co-signed transaction costs. What arrives is the
 * sweep's 193 903 plus the moved leaf's 56 752: 250 655, not 251 610, as the
 * watchtower transaction took 955 off the leaf.
 */
export const MOVED = {
  leafId: 'leaf-3',
  cooperativeFeeSats: COSIGNED.feePerLeafSat, // 1 450
  sweepFeeSat: MOVED_SWEEP_FEE_SAT,
  deliveredSat: MOVED_SWEPT_SAT + MOVED_COSIGNED_SAT, // 250 655
};

/** The co-signed recovery's two transactions, as Glow keeps them. */
export const COSIGNED_TXIDS = [`a4${'3f'.repeat(31)}`, `b7${'3f'.repeat(31)}`];

/** The finished stranded recovery, as ArchivedExitDialog shows it. */
export const ARCHIVED = {
  receivedSat: 118_900,
  recoveredSat: 120_000,
  exitFeePaidSat: 14_350,
  unspentExitFeeSat: 650,
};
