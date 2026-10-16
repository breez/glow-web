import { singleKeyCpfpSigner } from '@breeztech/breez-sdk-spark';
import { sha256 } from '@noble/hashes/sha2';
import { bech32, bech32m, createBase58check, hex } from '@scure/base';
import type { ChainClient, ChainUtxo } from '@/services/chain';
import { logger, LogCategory } from '@/services/logger';
import { MIN_SEND_SAT } from './exitFee';
import { deriveFundingKey, MnemonicNeedsPasskeyError, readWalletMnemonic, type FundingKey } from './funding';
import { hasWaitingLanding } from './ledger';
import type { UnilateralExitPlan } from './model/plan';
import { exitFeeRecordOf } from './quote';

const PSBT_MAGIC = Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff);
/** A P2WPKH input's weight, its witness at the largest signature size. */
const P2WPKH_INPUT_WEIGHT = 272;
/** Version, locktime, both counts, and the segwit marker and flag. */
const TX_OVERHEAD_WEIGHT = 42;
/** Signals replace-by-fee, so the key's holder can replace a stuck sweep. */
const SEQUENCE = 0xfffffffd;
/**
 * About a day. The sweep pays the exit's own fee rate, which just confirmed the
 * exit, so one still out by then is let go, and its coins count toward the
 * next exit as before.
 */
const FEE_SWEEP_BLOCKS = 144;

const base58check = createBase58check(sha256);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const littleEndian = (value: number, bytes: 4 | 8): Uint8Array => {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  if (bytes === 4) view.setUint32(0, value, true);
  else view.setBigUint64(0, BigInt(value), true);
  return out;
};

const compactSize = (n: number): Uint8Array =>
  n < 0xfd ? Uint8Array.of(n) : n <= 0xffff ? Uint8Array.of(0xfd, n & 0xff, n >> 8) : concat(Uint8Array.of(0xfe), littleEndian(n, 4));

/** The output script an address pays to, or null for one the sweep cannot pay. */
export function scriptPubKeyOf(address: string): Uint8Array | null {
  const lower = address.toLowerCase();
  for (const codec of [bech32, bech32m]) {
    try {
      const [version, ...words] = codec.decode(lower as `${string}1${string}`).words;
      // Version 0 is bech32 and every later one bech32m (BIP 350).
      if ((version === 0) !== (codec === bech32) || version > 16) continue;
      const program = codec.fromWords(words);
      return concat(Uint8Array.of(version === 0 ? 0 : 0x50 + version, program.length), program);
    } catch {
      // Not this encoding.
    }
  }
  try {
    const payload = base58check.decode(address);
    const hash = payload.subarray(1);
    if (hash.length !== 20) return null;
    if (payload[0] === 0x00 || payload[0] === 0x6f) return concat(Uint8Array.of(0x76, 0xa9, 0x14), hash, Uint8Array.of(0x88, 0xac));
    if (payload[0] === 0x05 || payload[0] === 0xc4) return concat(Uint8Array.of(0xa9, 0x14), hash, Uint8Array.of(0x87));
  } catch {
    // Not base58 either.
  }
  return null;
}

/** Each input's final witness, as the signer wrote it into the PSBT. */
function finalWitnesses(psbt: Uint8Array, inputs: number): Uint8Array[] {
  if (!PSBT_MAGIC.every((byte, i) => psbt[i] === byte)) throw new Error('The signer returned no PSBT');
  let at = PSBT_MAGIC.length;
  const size = (): number => {
    const first = psbt[at++];
    if (first < 0xfd) return first;
    const bytes = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
    let value = 0;
    for (let i = 0; i < bytes; i++) value += psbt[at++] * 2 ** (8 * i);
    return value;
  };
  const readMap = (): Map<number, Uint8Array> => {
    const entries = new Map<number, Uint8Array>();
    for (let keyLength = size(); keyLength > 0; keyLength = size()) {
      const type = psbt[at];
      at += keyLength;
      const valueLength = size();
      entries.set(type, psbt.subarray(at, at + valueLength));
      at += valueLength;
    }
    return entries;
  };
  readMap();
  return Array.from({ length: inputs }, (_, i) => {
    const witness = readMap().get(0x08);
    if (!witness) throw new Error(`The signer left sweep input ${i} unsigned`);
    return witness;
  });
}

export interface BuiltSweep {
  txid: string;
  txHex: string;
  /** What reaches the destination. */
  valueSat: number;
}

export type PsbtSigner = (psbt: Uint8Array, secretKey: Uint8Array) => Promise<Uint8Array>;

const sdkSigner: PsbtSigner = (psbt, secretKey) => singleKeyCpfpSigner(secretKey).signPsbt(psbt);

/**
 * One transaction paying every coin to `destination`, signed with the fee key
 * by the SDK's own single-key signer. Null when a script is unknown, or when
 * the fee leaves too little to send.
 */
export async function buildFeeSweep(
  coins: ChainUtxo[],
  key: FundingKey,
  destination: string,
  feeRateSatPerVbyte: number,
  sign: PsbtSigner = sdkSigner,
): Promise<BuiltSweep | null> {
  const output = scriptPubKeyOf(destination);
  const owned = scriptPubKeyOf(key.address);
  if (!output || !owned || coins.length === 0) return null;
  const weight = TX_OVERHEAD_WEIGHT + P2WPKH_INPUT_WEIGHT * coins.length + 4 * (9 + output.length);
  const feeSat = Math.ceil(Math.ceil(weight / 4) * Math.max(1, feeRateSatPerVbyte));
  const valueSat = coins.reduce((sum, coin) => sum + coin.value, 0) - feeSat;
  if (valueSat < MIN_SEND_SAT) return null;

  const version = littleEndian(2, 4);
  const locktime = littleEndian(0, 4);
  const body = concat(
    compactSize(coins.length),
    ...coins.map(coin =>
      concat(hex.decode(coin.txid).reverse(), littleEndian(coin.vout, 4), Uint8Array.of(0), littleEndian(SEQUENCE, 4)),
    ),
    compactSize(1),
    littleEndian(valueSat, 8),
    compactSize(output.length),
    output,
  );
  const unsigned = concat(version, body, locktime);
  const entry = (type: number, value: Uint8Array) => concat(Uint8Array.of(1, type), compactSize(value.length), value);
  const psbt = concat(
    PSBT_MAGIC,
    entry(0x00, unsigned),
    Uint8Array.of(0),
    ...coins.map(coin => concat(entry(0x01, concat(littleEndian(coin.value, 8), compactSize(owned.length), owned)), Uint8Array.of(0))),
    Uint8Array.of(0),
  );
  const witnesses = finalWitnesses(await sign(psbt, key.secretKey), coins.length);
  return {
    txid: hex.encode(sha256(sha256(unsigned)).reverse()),
    txHex: hex.encode(concat(version, Uint8Array.of(0, 1), body, ...witnesses, locktime)),
    valueSat,
  };
}

/** The ledger gains the sweep once a spend of its coin is in a block. */
async function followFeeSweep(plan: UnilateralExitPlan, chain: ChainClient, tipHeight: number): Promise<UnilateralExitPlan> {
  const sweep = plan.feeSweep;
  if (!sweep) return plan;
  const split = sweep.outpoint.lastIndexOf(':');
  const spend = await chain
    .confirmedSpender(sweep.outpoint.slice(0, split), Number(sweep.outpoint.slice(split + 1)))
    .catch(e => {
      logger.warn(LogCategory.SDK, 'Failed to read the exit fee sweep', { error: e instanceof Error ? e.message : String(e) });
      return null;
    });
  if (spend) {
    const destination = plan.destination.toLowerCase();
    const paidSat = spend.outputs
      .filter(output => output.address?.toLowerCase() === destination)
      .reduce((sum, output) => sum + output.value, 0);
    const landing = { leafIds: [], valueSat: 0, txid: spend.txid, paidSat, blockHeight: spend.blockHeight };
    return { ...plan, feeSweep: undefined, landed: [...(plan.landed ?? []), landing] };
  }
  if (tipHeight - sweep.sentAt >= FEE_SWEEP_BLOCKS) {
    logger.warn(LogCategory.SDK, 'Gave up on the exit fee sweep');
    return { ...plan, feeSweep: undefined };
  }
  // The node takes one it already holds as sent.
  await chain.broadcast(sweep.txHex).catch(() => undefined);
  return plan;
}

/**
 * Sends what a finished exit left at its fee address to its destination, and
 * holds the exit open until that lands. The exit's own sweep takes back only
 * the change of what it spent, so a coin it never spent, as when the
 * operators' copy landed first, stays at the address. A wallet that needs a
 * passkey to sign leaves it there, to count toward its next exit.
 */
export async function sweepLeftoverFee(plan: UnilateralExitPlan, chain: ChainClient, tipHeight: number): Promise<UnilateralExitPlan> {
  if (hasWaitingLanding(plan)) return plan;
  if (plan.feeSweep) return followFeeSweep(plan, chain, tipHeight);
  const address = exitFeeRecordOf(plan).exitFeeAddress;
  if (!address) return plan;
  try {
    const coins = (await chain.addressUtxos(address)).filter(coin => coin.confirmed);
    if (coins.length === 0) return plan;
    const key = deriveFundingKey(await readWalletMnemonic(), plan.network, plan.fundingAddressIndex);
    if (key.address !== address) return plan;
    const sweep = await buildFeeSweep(coins, key, plan.destination, plan.feeRateSatPerVbyte);
    if (!sweep) return plan;
    await chain.broadcast(sweep.txHex);
    const [first] = coins;
    return { ...plan, feeSweep: { txid: sweep.txid, txHex: sweep.txHex, outpoint: `${first.txid}:${first.vout}`, sentAt: tipHeight } };
  } catch (e) {
    if (!(e instanceof MnemonicNeedsPasskeyError)) {
      logger.warn(LogCategory.SDK, 'Failed to send the leftover exit fee', { error: e instanceof Error ? e.message : String(e) });
    }
    return plan;
  }
}
