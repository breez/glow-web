import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { prepareZXingModule } from 'zxing-wasm/reader';
import { prepareZXingModule as prepareWriter, writeBarcode } from 'zxing-wasm/writer';
import { zxingQrEngine } from './qrScanner';

// Tests have no server to fetch the wasm from, so read it from disk.
const wasm = (path: string) => readFileSync(createRequire(import.meta.url).resolve(path)).buffer as ArrayBuffer;
prepareZXingModule({ overrides: { wasmBinary: wasm('zxing-wasm/reader/zxing_reader.wasm') } });
prepareWriter({ overrides: { wasmBinary: wasm('zxing-wasm/writer/zxing_writer.wasm') } });

/** A stand-in for qr-scanner's canvas: the QR code at 3px per module, with a quiet zone. */
async function canvasWithQrCode(text: string) {
  const { symbol } = await writeBarcode(text, { format: 'QRCode', ecLevel: 'M' });
  const scale = 3;
  const size = (symbol.width + 8) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [mx, my] = [Math.floor(x / scale) - 4, Math.floor(y / scale) - 4];
      const inCode = mx >= 0 && my >= 0 && mx < symbol.width && my < symbol.height;
      if (inCode && symbol.data[my * symbol.width + mx] === 0) data.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
    }
  }
  return {
    width: size,
    height: size,
    getContext: () => ({ getImageData: () => ({ data, width: size, height: size, colorSpace: 'srgb' }) }),
  } as unknown as HTMLCanvasElement;
}

describe('zxingQrEngine', () => {
  it('reads a QR code as dense as a long invoice', async () => {
    const invoice = 'lnbc10u1p' + 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(12).slice(0, 377);
    const [result] = await zxingQrEngine.detect(await canvasWithQrCode(invoice));

    expect(result.rawValue).toBe(invoice);
    expect(result.cornerPoints).toHaveLength(4);
  });

  it('returns nothing when there is no QR code', async () => {
    const blank = new Uint8ClampedArray(200 * 200 * 4).fill(255);
    const canvas = {
      width: 200,
      height: 200,
      getContext: () => ({ getImageData: () => ({ data: blank, width: 200, height: 200, colorSpace: 'srgb' }) }),
    } as unknown as HTMLCanvasElement;

    expect(await zxingQrEngine.detect(canvas)).toEqual([]);
  });
});
