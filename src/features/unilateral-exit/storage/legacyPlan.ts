import type { CpfpInput, ExitTransactionStatus, RecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import type { UnilateralExitPlan } from '../model/plan';

// The plan Glow stored under SDK 0.26 (version 4). Its exit no longer parses
// as this SDK's recovery, so a stored one is converted on load.

type V4CpfpInput =
  | { type: 'p2wpkh' | 'p2tr'; txid: string; vout: number; value: number; pubkey: string }
  | { type: 'custom'; txid: string; vout: number; value: number; scriptPubkeyHex: string; signedInputWeight: number };

interface V4ExitTransaction {
  kind: 'fanOut' | 'node' | 'refund' | 'sweep';
  nodeId?: string;
  txid: string;
  txHex: string;
  cpfpTxHex?: string;
  csvTimelockBlocks?: number;
  dependsOn: string[];
  status: ExitTransactionStatus;
}

interface V4Exit {
  recoverableValueSat: number;
  totalFeeSat: number;
  cpfpFeeSat: number;
  fanoutFeeSat: number;
  sweepFeeSat: number;
  leaves: { leafId: string; value: number }[];
  transactions: V4ExitTransaction[];
  fundingInputs: V4CpfpInput[];
}

export interface V4Plan
  extends Omit<
    UnilateralExitPlan,
    'version' | 'exit' | 'namedLeaves' | 'recoverableLeafIds' | 'recoverableFundsSat' | 'needsRebuild' | 'needsSignIn'
  > {
  version: 4;
  exit: V4Exit;
}

const fundingInputOf = (input: V4CpfpInput): CpfpInput =>
  input.type === 'custom'
    ? {
        type: 'custom',
        txid: input.txid,
        vout: input.vout,
        valueSats: input.value,
        scriptPubkeyHex: input.scriptPubkeyHex,
        signedInputWeight: input.signedInputWeight,
      }
    : { type: input.type, txid: input.txid, vout: input.vout, valueSats: input.value, pubkey: input.pubkey };

/**
 * The same exit in this SDK's shape. Each transaction reads the same in both,
 * so the set keeps running and the tracker keeps showing it. The funding inputs
 * carry over for the rebuild to follow, and for the exit fee record a version 4
 * plan keeps nowhere else. An exit still running is marked for that rebuild.
 */
export function planFromV4(old: V4Plan): UnilateralExitPlan {
  const { exit, ...rest } = old;
  const converted: RecoverFundsResponse = {
    recoverableValueSats: exit.recoverableValueSat,
    totalFeeSats: exit.totalFeeSat,
    cooperativeFeeSats: 0,
    cpfpFeeSats: exit.cpfpFeeSat,
    fanoutFeeSats: exit.fanoutFeeSat,
    sweepFeeSats: exit.sweepFeeSat,
    leaves: exit.leaves.map(leaf => ({ leafId: leaf.leafId, valueSats: leaf.value, method: 'unilateral' })),
    failed: [],
    transactions: exit.transactions,
    fundingInputs: exit.fundingInputs.map(fundingInputOf),
    feeRateSatPerVbyte: old.feeRateSatPerVbyte,
    destination: old.destination,
  };
  const plan: UnilateralExitPlan = { ...rest, version: 5, exit: converted };
  return old.phase === 'complete' ? plan : { ...plan, needsRebuild: true };
}
