/**
 * Brand Setup CLI
 *
 * Generates PWA icons from logo and manifest.json from brand config.
 * Run: npm run brand:setup
 */

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { brand } from '../src/config/brand.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const logoPath = join(rootDir, 'public', brand.logo.replace(/^\//, ''));
const iconsDir = join(rootDir, 'public/icons');

// Ensure output directory exists
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

const ICON_SIZES = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-maskable-192.png', size: 192 },
  { name: 'icon-maskable-512.png', size: 512 },
] as const;

async function generateIcons() {
  if (!existsSync(logoPath)) {
    console.error(`\n  Logo not found: ${logoPath}`);
    console.error(`  Place your logo at public${brand.logo}\n`);
    process.exit(1);
  }

  console.log(`\n  Brand: ${brand.name}`);
  console.log(`  Logo:  public${brand.logo}\n`);
  console.log('  Generated:');

  for (const { name, size } of ICON_SIZES) {
    await sharp(logoPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ quality: 90, compressionLevel: 9 })
      .toFile(join(iconsDir, name));

    console.log(`    icons/${name} (${size}x${size})`);
  }

  // Favicon
  await sharp(logoPath)
    .resize(32, 32, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(join(iconsDir, 'favicon.png'));

  console.log('    icons/favicon.png (32x32)');
}

function generateManifest() {
  const manifest = {
    name: brand.name,
    short_name: brand.name,
    description: brand.description,
    start_url: '/',
    id: '/',
    display: 'standalone',
    background_color: brand.theme.colors.background,
    theme_color: brand.theme.colors.background,
    orientation: 'portrait-primary',
    categories: ['finance', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/favicon.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcuts: [],
    related_applications: [],
    prefer_related_applications: false,
  };

  const manifestPath = join(rootDir, 'public/manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('    manifest.json');
}

async function main() {
  try {
    await generateIcons();
    generateManifest();
    console.log(`\n  Ready! Run npm run dev to preview.\n`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
