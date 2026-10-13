import type {
  ExitTransactionStatus,
  PrepareRecoverFundsResponse,
  RecoverFundsResponse,
  RecoveryFunding,
  RecoveryTransaction,
  RecoveryVerdict,
} from '@breeztech/breez-sdk-spark';
import type { ChainClient, ChainUtxo } from '@/services/chain';
import { deriveFundingKey } from './funding';
import type { PendingExit, UnilateralExitPlan } from './model/plan';
import type { ExitSdk } from './quoting';

/** The phrase the fee key derives from in tests that start or rebuild an exit. */
export const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/** An exit quoted at 2 sat/vB for 5 898 sats of fee, nothing paid yet. */
export const pendingExit = (over: Partial<PendingExit> = {}): PendingExit => ({
  network: 'regtest',
  destination: 'bcrt1qdest',
  feeRateSatPerVbyte: 2,
  fundingAddressIndex: 0,
  fundingAddress: 'bcrt1qfund',
  required: { sat: 5_898, inputs: 1 },
  willReceiveSat: 94_000,
  ...over,
});

export const coin = (value: number, confirmed = true, txid = `coin-${value}`): ChainUtxo => ({
  txid,
  vout: 0,
  value,
  confirmed,
});

export const confirmed = (blockHeight?: number): ExitTransactionStatus => ({
  type: 'confirmed',
  blockHeight,
});
export const ready: ExitTransactionStatus = { type: 'ready' };
export const blocked: ExitTransactionStatus = { type: 'waitingForDependencies' };
export const locked = (spendableAtHeight?: number): ExitTransactionStatus => ({
  type: 'waitingForTimelock',
  spendableAtHeight,
});

export const tx = (
  over: Partial<RecoveryTransaction> & { txid: string },
): RecoveryTransaction => ({
  kind: 'node',
  txHex: 'aa',
  dependsOn: [],
  status: ready,
  ...over,
});

/** What the sdk hands back for an exit: the same set, statuses refreshed. */
export const checked = (
  transactions: Array<Partial<RecoveryTransaction> & { txid: string }>,
  over: Partial<RecoverFundsResponse> = {},
): RecoverFundsResponse => ({
  recoverableValueSats: 100_000,
  totalFeeSats: 2_000,
  cooperativeFeeSats: 0,
  cpfpFeeSats: 1_800,
  fanoutFeeSats: 0,
  sweepFeeSats: 200,
  leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }],
  failed: [],
  fundingInputs: [],
  transactions: transactions.map(tx),
  feeRateSatPerVbyte: 2,
  destination: 'bc1qdest',
  ...over,
});

export const plan = (
  transactions: RecoveryTransaction[],
  over: Partial<Omit<UnilateralExitPlan, 'exit'>> & { exit?: Partial<RecoverFundsResponse> } = {},
): UnilateralExitPlan => {
  const { exit, ...rest } = over;
  return {
    version: 6,
    network: 'mainnet',
    destination: 'bc1qdest',
    feeRateSatPerVbyte: 2,
    fundingAddressIndex: 0,
    quotedSweepFeeSat: 200,
    exit: { ...checked([]), transactions, ...exit },
    refusals: {},
    status: { type: 'running' },
    ...rest,
  };
};

/** One input, one 596 524 sat output: a sweep as the chain reports it. */
export const sweepHex =
  '0200000001' + '00'.repeat(32) + '00000000' + '00' + 'ffffffff' +
  '01' + '2c1a090000000000' + '160014' + 'ab'.repeat(20) + '00000000';

/** A txid as the chain writes it, for a test that reads which outpoint a transaction spends. */
export const txidOf = (n: number): string => n.toString(16).padStart(64, '0');

const littleEndian = (value: number, bytes: number): string =>
  (value.toString(16).padStart(bytes * 2, '0').match(/../g) ?? []).reverse().join('');

/** A raw transaction spending each `txid:vout` of `inputs` and paying one output per value. */
export function rawTx(inputs: string[], values: number[]): string {
  const input = (outpoint: string) => {
    const [txid, vout] = outpoint.split(':');
    return (txid.match(/../g) ?? []).reverse().join('') + littleEndian(Number(vout), 4) + '00' + 'ffffffff';
  };
  const output = (value: number) => littleEndian(value, 8) + '160014' + 'ab'.repeat(20);
  return (
    '02000000' +
    littleEndian(inputs.length, 1) + inputs.map(input).join('') +
    littleEndian(values.length, 1) + values.map(output).join('') +
    '00000000'
  );
}

/** An exit of two leaves worth 600 000, held to a 215 sat sweep fee. */
export const twoLeaves = (transactions: Parameters<typeof plan>[0], over: Parameters<typeof plan>[1] = {}) =>
  plan(transactions, {
    quotedSweepFeeSat: 215,
    ...over,
    exit: {
      leaves: [
        { leafId: 'leaf-1', valueSats: 180_000, method: 'unilateral' },
        { leafId: 'leaf-2', valueSats: 420_000, method: 'unilateral' },
      ],
      recoverableValueSats: 600_000,
      totalFeeSats: 3_122,
      cpfpFeeSats: 2_907,
      sweepFeeSats: 0,
      ...over.exit,
    },
  });

/** The funding a quote asks for: one coin of `singleUtxoSats`, or one per branch. */
export const funding = (singleUtxoSats: number): RecoveryFunding => ({
  singleUtxoSats,
  perBranch: [{ leafId: 'leaf-1', fundingSats: singleUtxoSats }],
});

/** A quote that needs funding unless `over.funding` is undefined. */
export const prepared = (
  over: Partial<PrepareRecoverFundsResponse> = {},
): PrepareRecoverFundsResponse => ({
  leaves: [{ leafId: 'leaf-1', valueSats: 100_000, method: 'unilateral' }],
  skipped: [],
  recoverableValueSats: 100_000,
  totalFeeSats: 2_000,
  cooperativeFeeSats: 0,
  cpfpFeeSats: 1_800,
  fanoutFeeSats: 0,
  sweepFeeSats: 200,
  funding: funding(3_000),
  feeRateSatPerVbyte: 2,
  destination: 'bc1qdest',
  exitChainState: {
    confirmedNodes: [],
    refunds: [],
    stoppedLeafIds: [],
    unverifiedNodeIds: [],
    unverifiableConfirmedNodeIds: [],
  },
  ...over,
});

/** An sdk whose check confirms whatever it is handed, with nothing to rebuild. */
export const sdk = (over: Partial<ExitSdk> = {}): ExitSdk => ({
  checkRecoverFunds: async ({ recovery }) => ({ recovery, verdict: { type: 'valid' } }),
  importUnilateralExitState: async () => ({
    importedLeaves: 0,
    skippedForeignLeaves: 0,
    skippedConflictingLeaves: 0,
    skippedChains: 0,
  }),
  prepareRecoverFunds: async () => prepared({ leaves: [] }),
  // One transaction, since a build with none is an error.
  recoverFunds: async () => checked([{ txid: 'built' }]),
  exportUnilateralExitState: async () => ({ exitState: 'snapshot' }),
  syncWallet: async () => ({}),
  ...over,
});

export const chain = (over: Partial<ChainClient> = {}): ChainClient => ({
  feeRates: async () => ({ slow: 1, medium: 2, fast: 3 }),
  addressUtxos: async () => [],
  tipHeight: async () => 100,
  broadcast: async () => undefined,
  broadcastPackage: async () => undefined,
  confirmedSpender: async () => null,
  ...over,
});

export const redo: RecoveryVerdict = { type: 'redo', reason: 'onChainStateDiverged' };

export const checking = (exit: ReturnType<typeof checked>, verdict: RecoveryVerdict = { type: 'valid' }) =>
  sdk({ checkRecoverFunds: async () => ({ recovery: exit, verdict }) });

/** A plan as SDK 0.26 builds left it on main: `value` fields, no exit fee address. */
export const v4Plan = (over: Record<string, unknown> = {}) => ({
  version: 4,
  network: 'mainnet',
  destination: 'bc1qold',
  feeRateSatPerVbyte: 3,
  fundingAddressIndex: 1,
  quotedSweepFeeSat: 215,
  quotedExitFeeSat: 14_350,
  exit: {
    recoverableValueSat: 600_000,
    totalFeeSat: 3_122,
    cpfpFeeSat: 2_907,
    fanoutFeeSat: 0,
    sweepFeeSat: 215,
    leaves: [
      { leafId: 'leaf-1', value: 180_000 },
      { leafId: 'leaf-2', value: 420_000 },
    ],
    transactions: [
      { kind: 'node', nodeId: 'node-1', txid: 'node-1', txHex: 'aa', cpfpTxHex: 'bb', dependsOn: [], status: confirmed(10) },
      { kind: 'refund', nodeId: 'leaf-1', txid: 'refund-1', txHex: 'aa', dependsOn: ['node-1'], status: locked(900) },
    ],
    fundingInputs: [{ type: 'p2wpkh', txid: 'fund', vout: 0, value: 14_350, pubkey: deriveFundingKey(MNEMONIC, 'mainnet', 1).publicKeyHex }],
  },
  refusals: { 'refund-1': 'non-BIP68-final' },
  phase: 'active',
  exitStateSnapshot: 'frozen',
  ...over,
});
