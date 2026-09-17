import QrScanner from 'qr-scanner';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/** Reads QR codes with ZXing, in the shape qr-scanner expects from a BarcodeDetector. */
export const zxingQrEngine = {
  async detect(canvas: HTMLCanvasElement) {
    const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const [code] = await readBarcodes(image, { formats: ['QRCode'], maxNumberOfSymbols: 1 });
    if (!code) return [];
    const { topLeft, topRight, bottomRight, bottomLeft } = code.position;
    return [{ rawValue: code.text, cornerPoints: [topLeft, topRight, bottomRight, bottomLeft] }];
  },
};

// Load the wasm from the app bundle, not zxing-wasm's default CDN. Defined once
// because zxing-wasm reloads the module whenever it gets different overrides.
const zxingOverrides = {
  locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path),
};
const createDefaultEngine = QrScanner.createQrEngine.bind(QrScanner);

// qr-scanner decodes with jsQR wherever the platform has no BarcodeDetector,
// which includes every iOS WebView, and jsQR rarely reads a dense code such as
// a long invoice. Use ZXing on every platform instead, and fall back to
// qr-scanner's own engine if the wasm fails to load.
QrScanner.createQrEngine = () =>
  prepareZXingModule({ overrides: zxingOverrides, fireImmediately: true }).then(
    () => zxingQrEngine,
    () => createDefaultEngine(),
  );

export default QrScanner;
