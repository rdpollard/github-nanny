import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Compile the existing vector mark to platform PNG assets. No network, runtime
// image library or new artwork is involved. Run after installing Chromium, or
// set CHROMIUM_PATH to a local executable.
const source = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const fullBleed = source.replace(' rx="40"', '');
const output = new URL('../public/icons/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  for (const [name, size, svg] of [
    ['icon-192.png', 192, source], ['icon-512.png', 512, source],
    ['maskable-512.png', 512, fullBleed], ['apple-touch-icon.png', 180, fullBleed],
  ]) {
    const png = await page.evaluate(async ({ svg, size }) => {
      const image = new Image();
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { svg, size });
    await writeFile(new URL(name, output), Buffer.from(png, 'base64'));
    console.log(`${name}: ${size}x${size}`);
  }
} finally { await browser.close(); }
