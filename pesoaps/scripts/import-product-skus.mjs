import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalog = join(root, 'catalog');
const skus = (await readFile(join(catalog, 'product-skus.txt'), 'utf8'))
  .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
if (!skus.length || skus.some(sku => !/^[A-Z0-9]{12,25}$/.test(sku)) || new Set(skus).size !== skus.length) {
  throw new Error('product-skus.txt needs unique Flipkart pid values, one per line');
}
const metadataPath = join(catalog, 'source-metadata.json');
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const known = new Map(metadata.map(row => [new URL(row.source_url).searchParams.get('pid'), row]));
for (const sku of known.keys()) {
  if (!skus.includes(sku)) throw new Error(`Existing SKU ${sku} was removed; disable it deliberately in D1 instead`);
}
const additions = skus.filter(sku => !known.has(sku));
if (!additions.length) {
  console.log('All product SKUs are already in the catalog.');
  process.exit(0);
}

const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; PESoapsCatalog/1.0)' };
const get = async url => {
  const response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
};
const unescapeHtml = value => value.replaceAll('&amp;', '&').replaceAll('&#x3D;', '=')
  .replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const sql = value => `'${value.replaceAll("'", "''")}'`;
const base = 'https://raw.githubusercontent.com/parthsheelenterprises/social_post/main/pesoaps/catalog/images/gallery';
const newRows = [];
const newMetadata = [];

for (const sku of additions) {
  // Flipkart does not publish a stable PID-to-product endpoint. Search is only
  // a discovery aid: an exact PID match in a listing URL is mandatory.
  const search = await (await get(`https://www.flipkart.com/search?q=${encodeURIComponent(sku)}`)).text();
  const hrefs = [...search.matchAll(/href="([^"]+)"/g)].map(match => unescapeHtml(match[1]));
  const candidate = hrefs.find(href => {
    try {
      const url = new URL(href, 'https://www.flipkart.com');
      return url.hostname === 'www.flipkart.com' && url.pathname.includes('/p/itm') && url.searchParams.get('pid') === sku;
    } catch { return false; }
  });
  if (!candidate) throw new Error(`Cannot resolve exact Flipkart listing for ${sku}. Existing daily posts remain unchanged; supply its full product URL for manual verification.`);
  const discovered = new URL(candidate, 'https://www.flipkart.com');
  const pageUrl = `${discovered.origin}${discovered.pathname}?pid=${sku}`;
  const page = await (await get(pageUrl)).text();
  const title = unescapeHtml(page.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? '');
  if (!/^PARTHSHEEL ENTERPRISES\b/i.test(title)) throw new Error(`${sku} did not resolve to a Parthsheel Enterprises product`);
  const name = title.split(' - Price in India')[0].trim();
  const gallery = [...new Set([...page.matchAll(/https:\/\/rukminim2\.flixcart\.com\/image\/1600\/2130\/([^" ]+?\.jpe?g)/g)]
    .map(match => `https://rukminim2.flixcart.com/image/1080/1080/${match[1]}`))];
  if (!gallery.length || gallery.length > 10) throw new Error(`${sku} has ${gallery.length} detectable listing photos; expected 1–10`);
  const id = `pesoaps-${sku.toLowerCase()}`;
  const hosted = [];
  for (let index = 0; index < gallery.length; index++) {
    const response = await get(gallery[index]);
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error(`${sku} gallery contains a non-image`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const dimensions = await sharp(bytes).metadata();
    if (!dimensions.width || !dimensions.height || Math.min(dimensions.width, dimensions.height) < 480) {
      throw new Error(`${sku} gallery image ${index + 1} is too small`);
    }
    const filename = `${id}-${index + 1}.jpg`;
    await mkdir(join(catalog, 'images/gallery'), { recursive: true });
    await sharp(bytes).resize(1080, 1080, { fit: 'contain', background: '#f0eee7' })
      .jpeg({ quality: 93 }).toFile(join(catalog, 'images/gallery', filename));
    hosted.push(`${base}/${filename}`);
  }
  newRows.push({ id, sku, name, pageUrl, gallery, hosted, position: metadata.length + newRows.length });
  newMetadata.push({ id, source_url: pageUrl, title, image_url: gallery[0], fetched_url: pageUrl,
    image_file: `catalog/images/gallery/${id}-1.jpg`, image_content_type: 'image/jpeg',
    verified_at: new Date().toISOString().slice(0, 10), display_name: name });
  console.log(`Verified ${sku}: ${name}; ${gallery.length} photos`);
}

const files = await readdir(join(root, 'migrations'));
const next = Math.max(...files.map(file => Number(file.match(/^(\d+)_/)?.[1] ?? 0))) + 1;
const migration = join(root, 'migrations', `${String(next).padStart(4, '0')}_import_product_skus.sql`);
const statements = newRows.map(row => `INSERT INTO products(id,position,purchase_url,name,image_url,verified,enabled,gallery_json) VALUES(${[
  row.id, row.position, row.pageUrl, row.name, row.hosted[0], 1, 1, JSON.stringify(row.hosted),
].map(value => typeof value === 'number' ? value : sql(value)).join(',')});`);
await writeFile(migration, `${statements.join('\n')}\n`);
await writeFile(metadataPath, `${JSON.stringify([...metadata, ...newMetadata], null, 2)}\n`);
const sourceUrls = join(catalog, 'source-urls.json');
await writeFile(sourceUrls, `${JSON.stringify([...JSON.parse(await readFile(sourceUrls, 'utf8')), ...newRows.map(row => row.pageUrl)], null, 2)}\n`);
console.log(`Created ${migration}. Deploy its D1 migration before the next daily post.`);
