import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2';
import { hex } from '@scure/base';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inputOutpoints, outputTotalSat } from '@/utils/rawTx';
import { buildFeeSweep, scriptPubKeyOf, sweepLeftoverFee } from './feeSweep';
import { deriveFundingKey, MnemonicNeedsPasskeyError, readWalletMnemonic } from './funding';
import { chain, coin, MNEMONIC, plan, txidOf } from './testFixtures';

vi.mock('./funding', async importOriginal => ({
  ...(await importOriginal<typeof import('./funding')>()),
  readWalletMnemonic: vi.fn(),
}));

const key = deriveFundingKey(MNEMONIC, 'regtest', 0);
const destination = deriveFundingKey(MNEMONIC, 'regtest', 1).address;

const dsha = (bytes: Uint8Array) => sha256(sha256(bytes));
const join = (...parts: Uint8Array[]) => hex.decode(parts.map(part => hex.encode(part)).join(''));
const u32 = (n: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
};

/** The parts of a one-output segwit transaction, read independently of the code under test. */
function parse(txHex: string) {
  const bytes = hex.decode(txHex);
  let at = 0;
  const take = (n: number) => bytes.slice(at, (at += n));
  const version = take(4);
  expect([...take(2)]).toEqual([0, 1]);
  const inputs = Array.from({ length: take(1)[0] }, () => {
    const outpoint = take(36);
    expect(take(1)[0]).toBe(0);
    return { outpoint, sequence: take(4) };
  });
  expect(take(1)[0]).toBe(1);
  const outputStart = at;
  take(8);
  take(take(1)[0]);
  const output = bytes.slice(outputStart, at);
  const witnessStart = at;
  const witnesses = inputs.map(() => Array.from({ length: take(1)[0] }, () => take(take(1)[0])));
  const witnessBytes = at - witnessStart;
  const locktime = take(4);
  expect(at).toBe(bytes.length);
  // Weight counts the marker, flag and witnesses once and everything else four times.
  const stripped = bytes.length - 2 - witnessBytes;
  return { version, inputs, output, witnesses, locktime, stripped, vsize: Math.ceil((stripped * 3 + bytes.length) / 4) };
}

describe('scriptPubKeyOf', () => {
  it.each([
    ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', '0014751e76e8199196d454941c45d1b3a323f1433bd6'],
    ['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', '0014751e76e8199196d454941c45d1b3a323f1433bd6'],
    [
      'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
      '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
    ],
    ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', '76a91477bff20c60e522dfaa3350c39b030a5d004e839a88ac'],
    ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'a914b472a266d0bd89c13706a4132ccfb16f7c3b9fcb87'],
  ])('pays %s to its script', (address, script) => {
    expect(hex.encode(scriptPubKeyOf(address)!)).toBe(script);
  });

  it('knows no script for something that is not an address', () => {
    expect(scriptPubKeyOf('not an address')).toBeNull();
  });
});

describe('buildFeeSweep', () => {
  const coins = [coin(30_000, true, txidOf(1)), { ...coin(20_000, true, txidOf(2)), vout: 3 }];

  it('sends every coin to the destination, signed by the SDK for exactly that transaction', async () => {
    const sweep = (await buildFeeSweep(coins, key, destination, 2))!;
    expect(inputOutpoints(sweep.txHex)).toEqual([`${txidOf(1)}:0`, `${txidOf(2)}:3`]);
    expect(outputTotalSat(sweep.txHex)).toBe(sweep.valueSat);

    const tx = parse(sweep.txHex);
    expect(hex.encode(tx.output).endsWith(hex.encode(scriptPubKeyOf(destination)!))).toBe(true);

    // BIP 143: each signature commits to every outpoint, sequence and output.
    const hashPrevouts = dsha(join(...tx.inputs.map(input => input.outpoint)));
    const hashSequence = dsha(join(...tx.inputs.map(input => input.sequence)));
    const hashOutputs = dsha(tx.output);
    const pubkeyHash = scriptPubKeyOf(key.address)!.slice(2);
    tx.inputs.forEach((input, i) => {
      const [signature, pubkey] = tx.witnesses[i];
      expect(hex.encode(pubkey)).toBe(key.publicKeyHex);
      expect(signature[signature.length - 1]).toBe(0x01);
      const preimage = join(
        tx.version, hashPrevouts, hashSequence, input.outpoint,
        hex.decode('1976a914'), pubkeyHash, hex.decode('88ac'),
        hex.decode(BigInt(coins[i].value).toString(16).padStart(16, '0')).reverse(),
        input.sequence, hashOutputs, tx.locktime, u32(1),
      );
      expect(secp256k1.verify(signature.slice(0, -1), dsha(preimage), pubkey, { prehash: false, format: 'der' })).toBe(true);
    });

    // The txid is the stripped transaction's, and the fee meets the rate asked.
    const bytes = hex.decode(sweep.txHex);
    const witnessLength = bytes.length - 2 - tx.stripped;
    const stripped = join(bytes.slice(0, 4), bytes.slice(6, bytes.length - 4 - witnessLength), tx.locktime);
    expect(sweep.txid).toBe(hex.encode(dsha(stripped).reverse()));
    const feeSat = 50_000 - sweep.valueSat;
    expect(feeSat).toBeGreaterThanOrEqual(tx.vsize * 2);
    expect(feeSat).toBeLessThanOrEqual((tx.vsize + 2) * 2);
  });

  it('sends nothing the fee would leave too little of', async () => {
    await expect(buildFeeSweep([coin(700)], key, destination, 2)).resolves.toBeNull();
  });

  it('sends nothing to an address it has no script for', async () => {
    await expect(buildFeeSweep(coins, key, 'not an address', 2)).resolves.toBeNull();
  });
});

describe('sweepLeftoverFee', () => {
  const finished = (over: Parameters<typeof plan>[1] = {}) =>
    plan([], { status: { type: 'done' }, network: 'regtest', destination, exitFeeAddress: key.address, ...over });
  const read = vi.mocked(readWalletMnemonic);

  beforeEach(() => {
    read.mockReset();
    read.mockResolvedValue(MNEMONIC);
  });

  it('sends what the fee address holds to the destination, and keeps the exit open until it lands', async () => {
    const broadcast = vi.fn(async () => undefined);
    const swept = await sweepLeftoverFee(
      finished(),
      chain({ addressUtxos: async () => [coin(10_000, true, txidOf(5)), coin(4_000, false, txidOf(6))], broadcast }),
      100,
    );
    expect(swept.feeSweep).toMatchObject({ outpoint: `${txidOf(5)}:0`, sentAt: 100 });
    expect(broadcast).toHaveBeenCalledWith(swept.feeSweep!.txHex);
    // Only the confirmed coin goes.
    expect(inputOutpoints(swept.feeSweep!.txHex)).toEqual([`${txidOf(5)}:0`]);
  });

  it('leaves the coins to a wallet that needs a passkey to sign', async () => {
    read.mockRejectedValue(new MnemonicNeedsPasskeyError());
    const broadcast = vi.fn(async () => undefined);
    const exit = finished();
    await expect(
      sweepLeftoverFee(exit, chain({ addressUtxos: async () => [coin(10_000)], broadcast }), 100),
    ).resolves.toBe(exit);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('waits for the ledger, and asks for no key when the address is empty', async () => {
    const addressUtxos = vi.fn(async () => []);
    const waiting = finished({ landed: [{ leafIds: ['a'], valueSat: 1_000, outpoint: `${txidOf(9)}:0` }] });
    await expect(sweepLeftoverFee(waiting, chain({ addressUtxos }), 100)).resolves.toBe(waiting);
    expect(addressUtxos).not.toHaveBeenCalled();

    const empty = finished();
    await expect(sweepLeftoverFee(empty, chain({ addressUtxos }), 100)).resolves.toBe(empty);
    expect(read).not.toHaveBeenCalled();
  });

  describe('once sent', () => {
    const sent = finished({
      landed: [{ leafIds: ['a'], valueSat: 100_000, txid: 'exit', paidSat: 99_000, blockHeight: 90 }],
      feeSweep: { txid: 'sweep', txHex: 'abcd', outpoint: `${txidOf(5)}:0`, sentAt: 100 },
    });

    it('records what it paid the destination once it is in a block', async () => {
      const spend = { txid: 'sweep', blockHeight: 101, outputs: [{ address: destination, value: 9_780 }] };
      const landed = await sweepLeftoverFee(sent, chain({ confirmedSpender: async () => spend }), 101);
      expect(landed.feeSweep).toBeUndefined();
      expect(landed.landed?.slice(-1)).toEqual([{ leafIds: [], valueSat: 0, txid: 'sweep', paidSat: 9_780, blockHeight: 101 }]);
    });

    it('sends it again while it waits', async () => {
      const broadcast = vi.fn(async () => undefined);
      await expect(sweepLeftoverFee(sent, chain({ broadcast }), 120)).resolves.toBe(sent);
      expect(broadcast).toHaveBeenCalledWith('abcd');
    });

    it('lets it go after about a day', async () => {
      const broadcast = vi.fn(async () => undefined);
      const given = await sweepLeftoverFee(sent, chain({ broadcast }), 244);
      expect(given.feeSweep).toBeUndefined();
      expect(given.landed).toEqual(sent.landed);
      expect(broadcast).not.toHaveBeenCalled();
    });
  });
});
