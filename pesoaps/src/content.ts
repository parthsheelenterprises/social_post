export type Product = {
  id: string;
  position: number;
  purchase_url: string;
  name: string | null;
  image_url: string | null;
  verified: number;
};

const variantBase = 'https://raw.githubusercontent.com/parthsheelenterprises/social_post/main/pesoaps/catalog/images/variants';
const galleryBase = 'https://raw.githubusercontent.com/parthsheelenterprises/social_post/main/pesoaps/catalog/images/gallery';
const alternateImages: Record<string, string[]> = Object.fromEntries(
  [1, 2, 3, 4, 5].map(number => {
    const id = `pesoaps-${number}`;
    return [id, [`${variantBase}/${id}-frame.jpg`, `${variantBase}/${id}-editorial.jpg`]];
  }),
);
// These are every additional photo in the exact product listing galleries.
// Related-product recommendations are deliberately excluded.
alternateImages['pesoaps-1'].push(
  `${galleryBase}/pesoaps-1-gallery-2.jpg`,
  `${galleryBase}/pesoaps-1-gallery-3.jpg`,
  `${galleryBase}/pesoaps-1-gallery-4.jpg`,
);
alternateImages['pesoaps-3'].push(`${galleryBase}/pesoaps-3-gallery-2.jpg`);

export function istDay(timestamp: number): string {
  return new Date(timestamp + 330 * 60_000).toISOString().slice(0, 10);
}

export function rotationIndex(day: string, start: string, count: number): number {
  if (!count) throw new Error('No products configured');
  const days = Math.floor((Date.parse(day) - Date.parse(start)) / 86_400_000);
  if (!Number.isFinite(days)) throw new Error('Invalid rotation date');
  return ((days % count) + count) % count;
}

export function imagesForDay(product: Product, day: string, start: string, productCount: number, previousImageUrl?: string): string[] {
  const images = [product.image_url!, ...(alternateImages[product.id] ?? [])];
  const days = Math.floor((Date.parse(day) - Date.parse(start)) / 86_400_000);
  const appearance = Math.floor(days / productCount);
  // A product gets a different image each time it comes around. The fixed
  // product-specific offset makes the grid varied while retries stay identical.
  const offset = [...product.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % images.length;
  const step = images.length > 2 ? images.length - 1 : 1;
  const index = ((offset + appearance * step) % images.length + images.length) % images.length;
  const front = images[index] === previousImageUrl ? (index + 1) % images.length : index;
  return [...images.slice(front), ...images.slice(0, front)];
}

export function imageForDay(product: Product, day: string, start: string, productCount: number, previousImageUrl?: string): string {
  return imagesForDay(product, day, start, productCount, previousImageUrl)[0];
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
