import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker, { deliver, runDaily } from '../src/index.ts';
import { imageForDay, imagesForDay, istDay, rotationIndex } from '../src/content.ts';
import { MetaClient } from '../src/meta.ts';
import sharp from 'sharp';

// Exercise the real migrations, SQL constraints and state transitions with
// SQLite. Only the D1 transport and Meta network calls are substituted.
function setup() {
  const db = new DatabaseSync(':memory:');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  const binding = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; },
        async first() { return db.prepare(sql).get(...values) ?? null; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
      };
    },
  };
  const env = {
    DB: binding, PUBLISH_ENABLED: 'true', FACEBOOK_PAGE_ID: '61581662363686',
    INSTAGRAM_USER_ID: '123', META_GRAPH_VERSION: 'v25.0',
    META_PAGE_ACCESS_TOKEN: 'test-only-token', ROTATION_START_DATE: '2026-09-26',
  };
  return { db, env };
}

function verifyProducts(db) {
  db.exec("UPDATE products SET verified=1,name='Fixture product',image_url='https://example.com/soap.jpg'");
}

function fakeMeta(t, failFacebook = false) {
  const calls = [];
  let photoNumber = 0;
  let childNumber = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.hostname, 'graph.facebook.com');
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    const path = url.pathname;
    calls.push(path);
    if (path.endsWith('/photos')) {
      assert.ok(options.body.get('url'));
      if (options.body.get('published') === 'false') return Response.json({ id: `fb-photo-${++photoNumber}` });
      assert.match(options.body.get('caption'), /https:\/\/(www|dl).flipkart.com\//);
      return Response.json({ id: 'fb-1' });
    }
    if (path.endsWith('/feed')) {
      if (failFacebook) throw new Error('socket closed after Meta accepted request');
      assert.match(options.body.get('message'), /https:\/\/(www|dl).flipkart.com\//);
      for (let i = 0; i < photoNumber; i++) {
        assert.deepEqual(JSON.parse(options.body.get(`attached_media[${i}]`)), { media_fbid: `fb-photo-${i + 1}` });
      }
      return Response.json({ id: 'fb-1' });
    }
    if (path.endsWith('/media')) {
      if (options.body.get('is_carousel_item') === 'true') return Response.json({ id: `child-${++childNumber}` });
      if (options.body.get('media_type') === 'CAROUSEL') {
        assert.equal(options.body.get('children'), Array.from({ length: childNumber }, (_, i) => `child-${i + 1}`).join(','));
        return Response.json({ id: 'carousel-1' });
      }
      return Response.json({ id: 'container-1' });
    }
    if (/\/(child-\d+|container-1|carousel-1)$/.test(path)) return Response.json({ status_code: 'FINISHED' });
    if (path.endsWith('/media_publish')) return Response.json({ id: 'ig-1' });
    throw new Error(`Unexpected path: ${path}`);
  });
  return calls;
}

test('08:00 IST is 02:30 UTC; five-product rotation wraps correctly', () => {
  assert.equal(istDay(Date.parse('2026-09-25T18:29:59Z')), '2026-09-25');
  assert.equal(istDay(Date.parse('2026-09-25T18:30:00Z')), '2026-09-26');
  assert.equal(istDay(Date.parse('2026-09-26T02:30:00Z')), '2026-09-26');
  assert.equal(rotationIndex('2026-09-26', '2026-09-26', 5), 0);
  assert.equal(rotationIndex('2026-10-01', '2026-09-26', 5), 0);
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.triggers.crons, ['30 2 * * *']);
});

test('disabled or incomplete setup never contacts Meta', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not contact network'); });
  await runDaily({ ...env, PUBLISH_ENABLED: 'false' }, Date.parse('2026-09-26T02:30Z'));
  await assert.rejects(runDaily({ ...env, META_PAGE_ACCESS_TOKEN: '' }, Date.parse('2026-09-26T02:30Z')), /configuration/);
  db.exec('UPDATE products SET verified=0');
  await assert.rejects(runDaily(env, Date.parse('2026-09-26T02:30Z')), /Product data/);
  assert.equal(network.mock.callCount(), 0);
});

test('both platforms publish once and replay cannot duplicate posts', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  verifyProducts(db);
  const calls = fakeMeta(t);
  await runDaily(env, Date.parse('2026-09-26T02:30Z'));
  await runDaily(env, Date.parse('2026-09-26T02:30Z'));
  assert.equal(calls.filter(p => p.endsWith('/feed')).length, 1);
  assert.equal(calls.filter(p => p.endsWith('/media_publish')).length, 1);
  assert.equal(calls.filter(p => p.endsWith('/photos')).length, 6);
  const post = db.prepare('SELECT image_url,image_urls_json FROM daily_posts').get();
  const images = JSON.parse(post.image_urls_json);
  assert.equal(images.length, 6);
  assert.equal(images[0], post.image_url);
  const rows = db.prepare('SELECT status,remote_id FROM deliveries ORDER BY platform').all();
  assert.deepEqual(rows.map(r => [r.status, r.remote_id]), [['published', 'fb-1'], ['published', 'ig-1']]);
  assert.equal(db.prepare('SELECT status FROM runs').get().status, 'published');
});

test('ambiguous Facebook failure does not block Instagram or trigger duplicate retries', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  verifyProducts(db);
  const calls = fakeMeta(t, true);
  await assert.rejects(runDaily(env, Date.parse('2026-09-26T02:30Z')), /need review/);
  await assert.rejects(runDaily(env, Date.parse('2026-09-26T02:30Z')), /need review/);
  assert.equal(calls.filter(p => p.endsWith('/feed')).length, 1);
  assert.equal(calls.filter(p => p.endsWith('/media_publish')).length, 1);
  const row = db.prepare("SELECT status,error_code FROM deliveries WHERE platform='facebook'").get();
  assert.equal(row.status, 'needs_review');
  assert.equal(row.error_code, 'network_outcome_unknown');
});

test('Meta redirects fail visibly without following to another host', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://example.com/' } });
  });
  const meta = new MetaClient('v21.0', 'test-only-token');
  await assert.rejects(meta.publishFacebook('123', 'https://example.com/soap.jpg', 'Caption'), /meta_302_0/);
});

test('concurrent delivery claims publish only once', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  verifyProducts(db);
  const calls = fakeMeta(t);
  db.exec("INSERT INTO daily_posts(day,product_id,name,purchase_url,image_url,caption,image_urls_json) VALUES ('2026-09-26','pesoaps-1','Fixture','https://dl.flipkart.com/s/lHa0cAuuuN','https://example.com/soap.jpg','Buy https://dl.flipkart.com/s/lHa0cAuuuN','[\"https://example.com/soap.jpg\"]')");
  const post = db.prepare('SELECT * FROM daily_posts').get();
  const meta = new MetaClient(env.META_GRAPH_VERSION, env.META_PAGE_ACCESS_TOKEN);
  await Promise.all([deliver(env, post, 'facebook', meta), deliver(env, post, 'facebook', meta)]);
  assert.equal(calls.length, 1);
});

test('public HTTP requests cannot trigger publishing', async () => {
  const response = await worker.fetch(new Request('https://example.com/run', { method: 'POST' }));
  assert.equal(response.status, 404);
});

test('daily health reports a missed run after the scheduled post window', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  const clock = t.mock.method(Date, 'now', () => Date.parse('2026-09-26T03:30:00Z'));
  const url = new Request('https://example.com/health/daily');
  let response = await worker.fetch(url, env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { day: '2026-09-26', status: 'missing' });
  db.exec("INSERT INTO runs(day,status,details) VALUES('2026-09-26','published','both platforms')");
  response = await worker.fetch(url, env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { day: '2026-09-26', status: 'published' });
  clock.mock.mockImplementation(() => Date.parse('2026-09-26T02:00:00Z'));
  response = await worker.fetch(url, env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { day: '2026-09-26', status: 'pending' });
});

test('catalog preserves all five exact Flipkart variants and verified JPEG URLs', t => {
  const { db } = setup();
  t.after(() => db.close());
  const rows = db.prepare('SELECT * FROM products ORDER BY position').all();
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => new URL(r.purchase_url).searchParams.get('pid')), [
    'SOPHR8SDHRHRJKGS', 'SOPHR9YYWTARCTEY', 'SOPHPTRAWNB7ZZGT', 'SOPHR9UDPKNGFU6K', 'SOPHQ7RXFZVSQXXE',
  ]);
  for (const row of rows) {
    assert.equal(row.verified, 1);
    assert.ok(row.name);
    assert.equal(new URL(row.image_url).hostname, 'rukminim2.flixcart.com');
    assert.ok(new URL(row.image_url).pathname.endsWith('.jpeg'));
  }
});

test('repeat appearances vary the same product photo without changing its listing', t => {
  const { db } = setup();
  t.after(() => db.close());
  const products = db.prepare('SELECT * FROM products ORDER BY position').all();
  for (const product of products) {
    const images = [];
    const count = [6, 3, 4, 3, 3][product.position];
    for (let cycle = 0; cycle < count; cycle++) {
      const day = new Date(Date.parse('2026-09-26') + (product.position + cycle * products.length) * 86_400_000)
        .toISOString().slice(0, 10);
      const carousel = imagesForDay(product, day, '2026-09-26', products.length);
      assert.equal(carousel.length, count);
      assert.equal(new Set(carousel).size, carousel.length);
      images.push(carousel[0]);
    }
    assert.equal(new Set(images).size, count, `${product.id} should use every image as the front`);
    for (const image of images) {
      assert.equal(new URL(image).protocol, 'https:');
      assert.match(image, /\.jpe?g(?:\?|$)/);
    }
  }
});

test('imported product gallery rotates every verified listing photo', () => {
  const product = { id: 'pesoaps-new', position: 5, purchase_url: 'https://www.flipkart.com/example/p/itm123?pid=SOPNEW123456',
    name: 'PE Soap', image_url: 'https://example.com/one.jpg', verified: 1,
    gallery_json: JSON.stringify(['https://example.com/one.jpg', 'https://example.com/two.jpg', 'https://example.com/three.jpg']) };
  const fronts = Array.from({ length: 3 }, (_, appearance) => {
    const day = new Date(Date.parse('2026-09-26') + (5 + appearance * 6) * 86_400_000).toISOString().slice(0, 10);
    const images = imagesForDay(product, day, '2026-09-26', 6);
    assert.equal(images.length, 3);
    return images[0];
  });
  assert.equal(new Set(fronts).size, 3);
});

test('all curated Flipkart gallery photos have social-ready local assets', async () => {
  const gallery = JSON.parse(readFileSync(new URL('../catalog/flipkart-gallery.json', import.meta.url), 'utf8'));
  assert.deepEqual(gallery.map(image => image.id), ['pesoaps-1', 'pesoaps-1', 'pesoaps-1', 'pesoaps-3']);
  for (const image of gallery) {
    assert.equal(new URL(image.source_url).hostname, 'rukminim2.flixcart.com');
    const file = new URL(`../${image.social_file}`, import.meta.url);
    assert.ok(statSync(file).size > 100_000);
    const metadata = await sharp(fileURLToPath(file)).metadata();
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1080);
  }
});

test('first new creative avoids repeating the previously published photo', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  verifyProducts(db);
  const product = db.prepare("SELECT * FROM products WHERE id='pesoaps-3'").get();
  db.prepare(`INSERT INTO daily_posts(day,product_id,name,purchase_url,image_url,caption)
    VALUES(?,?,?,?,?,?)`).run('2026-10-13', product.id, product.name, product.purchase_url, product.image_url, 'prior');
  fakeMeta(t);
  await runDaily(env, Date.parse('2026-10-18T02:30:00Z'));
  const next = db.prepare("SELECT image_url FROM daily_posts WHERE day='2026-10-18'").get();
  assert.notEqual(next.image_url, product.image_url);
  assert.match(next.image_url, /pesoaps-3-gallery-2\.jpg$/);
});
