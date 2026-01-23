import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const inputPath = join(rootDir, 'public/assets/Glow_Logo.png');
const outputDir = join(rootDir, 'public/icons');

// Ensure output directory exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const sizes = [
  { name: 'Glow-icon-192.png', size: 192 },
  { name: 'Glow-icon-512.png', size: 512 },
  { name: 'Glow-icon-maskable-192.png', size: 192 },
  { name: 'Glow-icon-maskable-512.png', size: 512 },
];

async function resizeIcons() {
  try {
    console.log('Resizing icons...');
    
    for (const { name, size } of sizes) {
      await sharp(inputPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png({ quality: 90, compressionLevel: 9 })
        .toFile(join(outputDir, name));
      
      console.log(`✓ Created ${name} (${size}x${size})`);
    }
    
    // Also create favicon (32x32)
    await sharp(inputPath)
      .resize(32, 32, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ quality: 90, compressionLevel: 9 })
      .toFile(join(outputDir, 'Glow_favicon.png'));
    
    console.log('✓ Created Glow_favicon.png (32x32)');
    console.log('\nAll icons created successfully!');
  } catch (error) {
    console.error('Error resizing icons:', error);
    process.exit(1);
  }
}

resizeIcons();
