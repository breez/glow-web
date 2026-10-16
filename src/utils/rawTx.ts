import { bytesToHex, hexToBytes } from './hex';

const readVarInt = (bytes: Uint8Array, at: number): [bigint, number] => {
  const first = bytes[at];
  if (first < 0xfd) return [BigInt(first), at + 1];
  const width = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
  let value = 0n;
  for (let i = width - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[at + 1 + i]);
  return [value, at + 1 + width];
};

/**
 * Total value of a raw transaction's outputs, in satoshis. Null when the hex is
 * not a transaction. Reads only as far as the outputs, so the witness is never
 * parsed.
 */
export function outputTotalSat(txHex: string): number | null {
  try {
    const bytes = hexToBytes(txHex);
    let at = 4;
    if (bytes[at] === 0x00) at += 2;

    const [inputs, afterInputCount] = readVarInt(bytes, at);
    at = afterInputCount;
    for (let i = 0n; i < inputs; i += 1n) {
      const [scriptLen, afterLen] = readVarInt(bytes, at + 36);
      at = afterLen + Number(scriptLen) + 4;
    }

    const [outputs, afterOutputCount] = readVarInt(bytes, at);
    at = afterOutputCount;
    let total = 0n;
    for (let i = 0n; i < outputs; i += 1n) {
      let value = 0n;
      for (let b = 7; b >= 0; b -= 1) value = (value << 8n) | BigInt(bytes[at + b]);
      total += value;
      const [scriptLen, afterLen] = readVarInt(bytes, at + 8);
      at = afterLen + Number(scriptLen);
    }
    return at > bytes.length ? null : Number(total);
  } catch {
    return null;
  }
}

/**
 * Each input of a raw transaction as the `txid:vout` it spends, with the txid
 * in display order: the serialized prevout hash is byte-reversed. Empty when
 * the hex is not a transaction.
 */
export function inputOutpoints(txHex: string): string[] {
  try {
    const bytes = hexToBytes(txHex);
    let at = 4;
    if (bytes[at] === 0x00) at += 2;

    const [inputs, afterInputCount] = readVarInt(bytes, at);
    at = afterInputCount;
    const outpoints: string[] = [];
    for (let i = 0n; i < inputs; i += 1n) {
      if (at + 36 > bytes.length) return [];
      const txid = bytesToHex(bytes.slice(at, at + 32).reverse());
      const vout = new DataView(bytes.buffer, bytes.byteOffset + at + 32, 4).getUint32(0, true);
      outpoints.push(`${txid}:${vout}`);
      const [scriptLen, afterLen] = readVarInt(bytes, at + 36);
      at = afterLen + Number(scriptLen) + 4;
    }
    return at > bytes.length ? [] : outpoints;
  } catch {
    return [];
  }
}
