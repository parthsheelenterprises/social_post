import type { Product } from './content.ts';
import type { RuntimeEnv } from './index.ts';

export type SellerSku = {
  position: number;
  sku: string;
  image_pid: string | null;
  image_url: string | null;
};

type Listing = {
  product_id: string;
  product_title: string;
  product_url: string;
  listing_status: string;
  archived_status: string;
};

const api = 'https://api.flipkart.net';

export async function findFlipkartProduct(env: RuntimeEnv, queue: SellerSku[]): Promise<Product | undefined> {
  if (!env.FLIPKART_APP_ID || !env.FLIPKART_APP_SECRET) throw new Error('Flipkart credentials missing');
  const auth = await fetch(`${api}/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api`, {
    headers: { Authorization: `Basic ${btoa(`${env.FLIPKART_APP_ID}:${env.FLIPKART_APP_SECRET}`)}` },
    // Cloudflare Workers supports only follow and manual. Manual keeps an
    // unexpected redirect from silently changing the token destination.
    redirect: 'manual', signal: AbortSignal.timeout(10_000),
  });
  if (!auth.ok) throw new Error(`Flipkart authentication failed (HTTP ${auth.status})`);
  const { access_token: token } = await auth.json<{ access_token?: string }>();
  if (!token) throw new Error('Flipkart returned no access token');

  for (let offset = 0; offset < queue.length; offset += 10) {
    const batch = queue.slice(offset, offset + 10);
    const response = await fetch(`${api}/sellers/listings/v3/details`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ sku_ids: batch.map(row => row.sku) }),
      redirect: 'manual', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Flipkart listing lookup failed (HTTP ${response.status})`);
    const data = await response.json<{ available?: Record<string, Listing>; unavailable?: unknown; invalid?: unknown }>();
    if (!data.available && !data.unavailable && !data.invalid) throw new Error('Unexpected Flipkart listing response');
    for (const row of batch) {
      const listing = data.available?.[row.sku];
      if (listing?.listing_status !== 'ACTIVE' || listing.archived_status === 'ARCHIVED' ||
          !listing.product_title?.trim() || !listing.product_id) continue;
      let purchase: URL;
      try { purchase = new URL(listing.product_url); } catch { continue; }
      if (purchase.origin !== 'https://www.flipkart.com' || !purchase.pathname.includes('/p/itm') ||
          purchase.searchParams.get('pid') !== listing.product_id) continue;
      const image = row.image_pid === listing.product_id && row.image_url
        ? row.image_url : await listingImage(purchase);
      if (!image) continue;
      return {
        id: row.sku, position: 100_000 + row.position, name: listing.product_title,
        purchase_url: purchase.href, image_url: image, verified: 1,
      };
    }
  }
}

async function listingImage(purchase: URL): Promise<string | undefined> {
  try {
    const page = await fetch(purchase, { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (!page.ok || !page.headers.get('Content-Type')?.includes('text/html')) return;
    let image: string | null = null;
    const output = new HTMLRewriter().on('meta[property="og:image"]', {
      element(element) { image ??= element.getAttribute('content'); },
    }).transform(page);
    // Consume the HTML as a stream so the metadata handler can run.
    await output.body?.pipeTo(new WritableStream());
    if (!image) return;
    const url = new URL(image);
    if (!/^https:\/\/rukminim[1-9]\.flixcart\.com$/.test(url.origin) ||
        !/^\/image\/\d+\/\d+\/.+\.jpe?g$/i.test(url.pathname)) return;
    url.pathname = url.pathname.replace(/^\/image\/\d+\/\d+\//, '/image/1080/1080/');
    return url.href;
  } catch {
    return;
  }
}
