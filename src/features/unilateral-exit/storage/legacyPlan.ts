import type { CpfpInput, ExitTransactionStatus, RecoverFundsResponse } from '@breeztech/breez-sdk-spark';
import { PLAN_VERSION, type ExitStatus, type UnilateralExitPlan } from '../model/plan';

/** The plan as version 5 kept it: where the exit stood, as a phase. */
export interface V5Plan extends Omit<UnilateralExitPlan, 'version' | 'status'> {
  version: 5;
  phase: 'active' | 'complete' | 'redo';
}

const statusOfPhase: Record<V5Plan['phase'], ExitStatus> = {
  active: { type: 'running' },
  redo: { type: 'rebuilding' },
  complete: { type: 'done' },
};

export function planFromV5(old: V5Plan): UnilateralExitPlan {
  const { phase, ...rest } = old;
  return { ...rest, version: PLAN_VERSION, status: statusOfPhase[phase] };
}

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
  extends Omit<V5Plan, 'version' | 'exit' | 'namedLeaves' | 'recoverableLeafIds' | 'recoverableFundsSat'> {
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
 * carry over for any rebuild a divergence needs, and for the exit fee record a
 * version 4 plan keeps nowhere else.
 */
export function planFromV4(old: V4Plan): V5Plan {
  const { exit, ...rest } = old;
  const converted: RecoverFundsResponse = {
    recoverableValueSats: exit.recoverableValueSat,
    totalFeeSats: exit.totalFeeSat,
    cooperativeFeeSats: 0,
    refundFeeSats: 0,
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
  return { ...rest, version: 5, exit: converted };
}
