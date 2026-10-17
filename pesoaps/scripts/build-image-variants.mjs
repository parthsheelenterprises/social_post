import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = JSON.parse(await readFile(join(root, 'catalog/source-metadata.json'), 'utf8'));
const output = join(root, 'catalog/images/variants');
await mkdir(output, { recursive: true });

const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const palette = [
  ['#183d2b', '#efe7d6'], ['#234536', '#f4ebd8'], ['#4b2a1e', '#f2e5d4'],
  ['#335437', '#f5e9cf'], ['#2d4a35', '#eee5d4'],
];

for (const [i, product] of catalog.entries()) {
  const source = join(root, product.image_file);
  const photo = await sharp(source).resize(800, 800, { fit: 'contain', background: '#fff' }).jpeg({ quality: 94 }).toBuffer();
  const [dark, cream] = palette[i];

  // The source photo remains intact inside each graphic; the vector layer only
  // changes the frame. This avoids invented packaging or product claims.
  const frameA = Buffer.from(`<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1080" fill="${cream}"/>
    <rect x="42" y="42" width="996" height="996" rx="34" fill="none" stroke="${dark}" stroke-width="4"/>
    <text x="540" y="104" text-anchor="middle" fill="${dark}" font-family="Arial,sans-serif" font-weight="700" font-size="43" letter-spacing="8">PESOAPS</text>
    <text x="540" y="1011" text-anchor="middle" fill="${dark}" font-family="Arial,sans-serif" font-size="23" letter-spacing="4">PARTHSHEEL ENTERPRISES</text>
    <path d="M70 186 Q110 135 150 186 M930 186 Q970 135 1010 186 M70 895 Q110 945 150 895 M930 895 Q970 945 1010 895" fill="none" stroke="${dark}" stroke-opacity=".45" stroke-width="3"/>
  </svg>`);
  await sharp({ create: { width: 1080, height: 1080, channels: 3, background: cream } })
    .composite([{ input: frameA, left: 0, top: 0 }, { input: photo, left: 140, top: 140 }])
    .jpeg({ quality: 92 }).toFile(join(output, `${product.id}-frame.jpg`));

  const portrait = await sharp(source).resize(800, 800, { fit: 'contain', background: cream }).jpeg({ quality: 94 }).toBuffer();
  const frameB = Buffer.from(`<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1080" fill="${dark}"/>
    <rect x="184" y="55" width="840" height="970" rx="28" fill="${cream}"/>
    <path d="M84 83 L84 990" stroke="${cream}" stroke-width="3"/>
    <text x="117" y="540" transform="rotate(-90 117 540)" text-anchor="middle" fill="${cream}" font-family="Arial,sans-serif" font-weight="700" font-size="38" letter-spacing="7">PARTHSHEEL ENTERPRISES</text>
    <text x="605" y="983" text-anchor="middle" fill="${dark}" font-family="Arial,sans-serif" font-weight="700" font-size="35" letter-spacing="9">PESOAPS</text>
  </svg>`);
  await sharp({ create: { width: 1080, height: 1080, channels: 3, background: dark } })
    .composite([{ input: frameB, left: 0, top: 0 }, { input: portrait, left: 204, top: 100 }])
    .jpeg({ quality: 92 }).toFile(join(output, `${product.id}-editorial.jpg`));
  console.log(`${escape(product.id)}: two 1080x1080 verified-photo layouts`);
}
