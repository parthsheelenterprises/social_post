import { istDay, makeCaption, productReady, rotationIndex, type Product } from './content.ts';
import { MetaClient, MetaError } from './meta.ts';

export type RuntimeEnv = Env & { META_PAGE_ACCESS_TOKEN?: string };
type Platform = 'facebook' | 'instagram';
type Post = { day: string; product_id: string; name: string; purchase_url: string; image_url: string; caption: string };

async function recordRun(env: RuntimeEnv, day: string, status: string, details: string) {
  await env.DB.prepare(`INSERT INTO runs(day,status,details) VALUES(?,?,?)
    ON CONFLICT(day) DO UPDATE SET status=excluded.status,details=excluded.details,updated_at=CURRENT_TIMESTAMP`)
    .bind(day, status, details).run();
  console.log(JSON.stringify({ event: 'daily_post', day, status, details }));
}

export function configurationIssues(env: RuntimeEnv): string[] {
  const issues: string[] = [];
  if (!env.META_PAGE_ACCESS_TOKEN) issues.push('META_PAGE_ACCESS_TOKEN');
  if (!/^\d+$/.test(env.FACEBOOK_PAGE_ID)) issues.push('FACEBOOK_PAGE_ID');
  if (!/^\d+$/.test(env.INSTAGRAM_USER_ID)) issues.push('INSTAGRAM_USER_ID');
  if (!/^v\d+\.0$/.test(env.META_GRAPH_VERSION)) issues.push('META_GRAPH_VERSION');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.ROTATION_START_DATE) || !Number.isFinite(Date.parse(env.ROTATION_START_DATE))) {
    issues.push('ROTATION_START_DATE');
  }
  return issues;
}

export async function deliver(env: RuntimeEnv, post: Post, platform: Platform, meta: MetaClient): Promise<void> {
  // The unique primary key is the atomic claim. Never automatically reclaim an
  // interrupted delivery: Meta may already have published it before a timeout.
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO deliveries(day,platform,status) VALUES(?,?,'claimed')`)
    .bind(post.day, platform).run();
  if (claim.meta.changes !== 1) return;

  try {
    let containerId: string | undefined;
    if (platform === 'instagram') {
      containerId = await meta.createInstagram(env.INSTAGRAM_USER_ID, post.image_url, post.caption);
      await env.DB.prepare(`UPDATE deliveries SET status='container_ready',container_id=?,updated_at=CURRENT_TIMESTAMP WHERE day=? AND platform=?`)
        .bind(containerId, post.day, platform).run();
      let ready = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const status = await meta.instagramStatus(containerId);
        if (status === 'FINISHED') { ready = true; break; }
        if (['ERROR', 'EXPIRED', 'PUBLISHED'].includes(status)) throw new MetaError(`container_${status.toLowerCase()}`);
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
      if (!ready) throw new MetaError('container_not_ready');
    }
    await env.DB.prepare(`UPDATE deliveries SET status='publishing',updated_at=CURRENT_TIMESTAMP WHERE day=? AND platform=?`)
      .bind(post.day, platform).run();
    const remoteId = platform === 'facebook'
      ? await meta.publishFacebook(env.FACEBOOK_PAGE_ID, post.image_url, post.caption)
      : await meta.publishInstagram(env.INSTAGRAM_USER_ID, containerId!);
    await env.DB.prepare(`UPDATE deliveries SET status='published',remote_id=?,updated_at=CURRENT_TIMESTAMP WHERE day=? AND platform=?`)
      .bind(remoteId, post.day, platform).run();
  } catch (error) {
    const code = error instanceof MetaError ? error.code : 'internal_outcome_unknown';
    await env.DB.prepare(`UPDATE deliveries SET status='needs_review',error_code=?,updated_at=CURRENT_TIMESTAMP WHERE day=? AND platform=?`)
      .bind(code, post.day, platform).run();
    console.error(JSON.stringify({ event: 'delivery_needs_review', day: post.day, platform, code }));
  }
}

export async function runDaily(env: RuntimeEnv, timestamp: number): Promise<void> {
  const day = istDay(timestamp);
  if (env.PUBLISH_ENABLED !== 'true') {
    await recordRun(env, day, 'disabled', 'Publishing is not enabled');
    return;
  }
  const issues = configurationIssues(env);
  if (issues.length) {
    await recordRun(env, day, 'blocked', `Missing or invalid configuration: ${issues.join(', ')}`);
    throw new Error('Publishing configuration incomplete');
  }
  let post = await env.DB.prepare('SELECT * FROM daily_posts WHERE day=?').bind(day).first<Post>();
  if (!post) {
    const { results } = await env.DB.prepare('SELECT * FROM products WHERE enabled=1 ORDER BY position').all<Product>();
    // Keep unverified products in the rotation; stop on their day instead of
    // silently advertising a different item or inventing product information.
    const product = results.length ? results[rotationIndex(day, env.ROTATION_START_DATE, results.length)] : undefined;
    if (!product || !productReady(product)) {
      await recordRun(env, day, 'blocked', `Product data needs verification: ${product?.id ?? 'empty_catalog'}`);
      throw new Error('Product data incomplete');
    }
    await env.DB.prepare(`INSERT OR IGNORE INTO daily_posts(day,product_id,name,purchase_url,image_url,caption) VALUES(?,?,?,?,?,?)`)
      .bind(day, product.id, product.name!, product.purchase_url, product.image_url!, makeCaption(product, day)).run();
    post = await env.DB.prepare('SELECT * FROM daily_posts WHERE day=?').bind(day).first<Post>();
    if (!post) throw new Error('Unable to save daily post');
  }
  const meta = new MetaClient(env.META_GRAPH_VERSION, env.META_PAGE_ACCESS_TOKEN!);
  // Independent deliveries: a failure on Facebook does not stop Instagram.
  const results = await Promise.allSettled([
    deliver(env, post, 'facebook', meta),
    deliver(env, post, 'instagram', meta),
  ]);
  const { results: deliveries } = await env.DB.prepare('SELECT platform,status FROM deliveries WHERE day=?').bind(day)
    .all<{ platform: Platform; status: string }>();
  const complete = results.every(result => result.status === 'fulfilled') && deliveries.length === 2 &&
    deliveries.every(delivery => delivery.status === 'published');
  await recordRun(env, day, complete ? 'published' : 'needs_review', JSON.stringify(deliveries));
  if (!complete) throw new Error('One or more deliveries need review; inspect D1 and Meta before retrying');
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return Response.json({ service: 'PESoaps social posts', schedule: '08:00 Asia/Kolkata', status: 'running' });
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(controller: ScheduledController, env: RuntimeEnv): Promise<void> {
    await runDaily(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<RuntimeEnv>;
