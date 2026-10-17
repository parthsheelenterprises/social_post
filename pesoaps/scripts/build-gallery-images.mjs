import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const gallery = JSON.parse(await readFile(join(root, 'catalog/flipkart-gallery.json'), 'utf8'));
const output = join(root, 'catalog/images/gallery');
await mkdir(output, { recursive: true });

for (const image of gallery) {
  const response = await fetch(image.source_url);
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg')) {
    throw new Error(`Cannot fetch verified gallery image for ${image.id}: HTTP ${response.status}`);
  }
  const source = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 480 || metadata.height < 480) {
    throw new Error(`Gallery image too small for ${image.id}`);
  }
  // Preserve the entire Flipkart photo. Portrait images receive side margins
  // so both Facebook and Instagram can publish a compliant square JPEG.
  await sharp(source).resize(1080, 1080, {
    fit: 'contain', background: '#f0eee7', withoutEnlargement: false,
  }).jpeg({ quality: 93 }).toFile(join(root, image.social_file));
  console.log(`${image.id}: ${metadata.width}x${metadata.height} -> 1080x1080 ${image.social_file}`);
}
