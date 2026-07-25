/**
 * Generate the iOS standalone launch images referenced by the
 * apple-touch-startup-image links in index.html.
 *
 * The mark is drawn in the same 144pt box that every launch-path logo
 * uses (index.html's .splash-logo and the w-36 screens), so the PWA
 * launch image and the #splash it hands off to are the same size on
 * every device. Sizing it as a fraction of device width instead would
 * only agree with #splash at one screen width.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_LOGO = join(rootDir, 'public/assets/Glow_Logo.svg');
const OUTPUT_DIR = join(rootDir, 'public/apple-splash');
const CANVAS = { r: 15, g: 15, b: 24, alpha: 1 }; // #0f0f18, matches #splash
const MARK_BOX_PT = 144;

// Device point sizes and DPRs, one per apple-touch-startup-image link.
const DEVICES = [
  [320, 568, 2], [375, 667, 2], [375, 812, 3], [390, 844, 3],
  [393, 852, 3], [402, 874, 3], [414, 736, 3], [414, 896, 2],
  [414, 896, 3], [428, 926, 3], [430, 932, 3], [440, 956, 3],
];

for (const [w, h, dpr] of DEVICES) {
  const box = MARK_BOX_PT * dpr;
  const mark = await sharp(SOURCE_LOGO, { density: 600 })
    .trim()
    .resize(box, box, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const name = `apple-splash-${w}x${h}@${dpr}.png`;
  await sharp({ create: { width: w * dpr, height: h * dpr, channels: 4, background: CANVAS } })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(join(OUTPUT_DIR, name));

  console.log(`✓ ${name} (${w * dpr}x${h * dpr}, mark ${MARK_BOX_PT}pt box)`);
}
