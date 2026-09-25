export type Product = {
  id: string;
  position: number;
  purchase_url: string;
  name: string | null;
  image_url: string | null;
  verified: number;
};

export function istDay(timestamp: number): string {
  return new Date(timestamp + 330 * 60_000).toISOString().slice(0, 10);
}

export function rotationIndex(day: string, start: string, count: number): number {
  if (!count) throw new Error('No products configured');
  const days = Math.floor((Date.parse(day) - Date.parse(start)) / 86_400_000);
  if (!Number.isFinite(days)) throw new Error('Invalid rotation date');
  return ((days % count) + count) % count;
}

export function productReady(product: Product): boolean {
  if (product.verified !== 1 || !product.name?.trim() || !product.image_url) return false;
  try {
    const image = new URL(product.image_url);
    const purchase = new URL(product.purchase_url);
    return image.protocol === 'https:' && purchase.protocol === 'https:' &&
      ['flipkart.com', 'www.flipkart.com', 'dl.flipkart.com'].includes(purchase.hostname);
  } catch { return false; }
}

export function makeCaption(product: Product, day: string): string {
  const openers = [
    'Today’s PESoaps pick',
    'Meet your next PESoaps pick',
    'Explore the PESoaps collection',
    'A little PESoaps inspiration for your day',
    'Discover PESoaps by Parthsheel Enterprises',
    'Your daily PESoaps spotlight',
    'Take a closer look at PESoaps',
  ];
  const opener = openers[new Date(day + 'T00:00:00Z').getUTCDay()];
  return `${opener}\n\n${product.name}\n\nShop on Flipkart: ${product.purchase_url}\n\nPESoaps | Parthsheel Enterprises\n#PESoaps #ParthsheelEnterprises #Soap #ShopOnFlipkart`;
}
