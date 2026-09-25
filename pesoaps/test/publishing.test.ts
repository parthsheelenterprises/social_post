import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker, { deliver, runDaily } from '../src/index.ts';
import { istDay, rotationIndex } from '../src/content.ts';
import { MetaClient } from '../src/meta.ts';

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
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.hostname, 'graph.facebook.com');
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    const path = url.pathname;
    calls.push(path);
    if (path.endsWith('/photos')) {
      if (failFacebook) throw new Error('socket closed after Meta accepted request');
      assert.match(options.body.get('caption'), /https:\/\/(www|dl).flipkart.com\//);
      return Response.json({ id: 'fb-1' });
    }
    if (path.endsWith('/media')) return Response.json({ id: 'container-1' });
    if (path.endsWith('/container-1')) return Response.json({ status_code: 'FINISHED' });
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
  assert.equal(calls.length, 4);
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
  assert.equal(calls.filter(p => p.endsWith('/photos')).length, 1);
  assert.equal(calls.filter(p => p.endsWith('/media_publish')).length, 1);
  const row = db.prepare("SELECT status,error_code FROM deliveries WHERE platform='facebook'").get();
  assert.equal(row.status, 'needs_review');
  assert.equal(row.error_code, 'network_outcome_unknown');
});

test('concurrent delivery claims publish only once', async t => {
  const { db, env } = setup();
  t.after(() => db.close());
  verifyProducts(db);
  const calls = fakeMeta(t);
  db.exec("INSERT INTO daily_posts VALUES ('2026-09-26','pesoaps-1','Fixture','https://dl.flipkart.com/s/lHa0cAuuuN','https://example.com/soap.jpg','Buy https://dl.flipkart.com/s/lHa0cAuuuN')");
  const post = db.prepare('SELECT * FROM daily_posts').get();
  const meta = new MetaClient(env.META_GRAPH_VERSION, env.META_PAGE_ACCESS_TOKEN);
  await Promise.all([deliver(env, post, 'facebook', meta), deliver(env, post, 'facebook', meta)]);
  assert.equal(calls.length, 1);
});

test('public HTTP requests cannot trigger publishing', async () => {
  const response = await worker.fetch(new Request('https://example.com/run', { method: 'POST' }));
  assert.equal(response.status, 404);
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
