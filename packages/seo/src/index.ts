/**
 * ECOM SEO — block 34
 * Meta tags, JSON-LD Product, sitemap/robots helpers.
 */

export type SeoProductInput = {
  title: string;
  description?: string | null;
  salePrice?: number | string | null;
  currency?: string;
  imageUrl?: string | null;
  url?: string | null;
  sku?: string | null;
  brand?: string;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder';
};

export function buildMetaTags(p: SeoProductInput): Record<string, string> {
  const title = (p.title || 'Producto').slice(0, 60);
  const desc = (p.description || p.title || '').replace(/\s+/g, ' ').slice(0, 155);
  const price = p.salePrice != null ? String(p.salePrice) : '';
  return {
    title: `${title} | ECOM`,
    description: desc,
    'og:title': title,
    'og:description': desc,
    'og:type': 'product',
    'og:image': p.imageUrl || '',
    'og:url': p.url || '',
    'twitter:card': 'summary_large_image',
    'product:price:amount': price,
    'product:price:currency': p.currency || 'COP',
  };
}

export function buildProductJsonLd(p: SeoProductInput): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: p.description || p.title,
    image: p.imageUrl ? [p.imageUrl] : undefined,
    sku: p.sku || undefined,
    brand: { '@type': 'Brand', name: p.brand || 'ECOM' },
    offers: {
      '@type': 'Offer',
      priceCurrency: p.currency || 'COP',
      price: p.salePrice != null ? Number(p.salePrice) : undefined,
      availability: `https://schema.org/${p.availability || 'InStock'}`,
      url: p.url || undefined,
    },
  };
}

export function buildRobotsTxt(opts: { sitemapUrl?: string; disallowAdmin?: boolean } = {}): string {
  const lines = ['User-agent: *', 'Allow: /'];
  if (opts.disallowAdmin !== false) {
    lines.push('Disallow: /admin', 'Disallow: /api');
  }
  if (opts.sitemapUrl) lines.push(`Sitemap: ${opts.sitemapUrl}`);
  return lines.join('\n') + '\n';
}

export function buildSitemapXml(
  urls: { loc: string; lastmod?: string; changefreq?: string; priority?: number }[],
): string {
  const body = urls
    .map((u) => {
      const last = u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '';
      const freq = u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : '';
      const pri = u.priority != null ? `<priority>${u.priority}</priority>` : '';
      return `<url><loc>${escapeXml(u.loc)}</loc>${last}${freq}${pri}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

export function seoScore(input: {
  hasTitle: boolean;
  hasDescription: boolean;
  hasImage: boolean;
  hasJsonLd: boolean;
  titleLen?: number;
  descLen?: number;
}): { score: number; tips: string[] } {
  let score = 0;
  const tips: string[] = [];
  if (input.hasTitle) score += 25;
  else tips.push('Falta title');
  if (input.hasDescription) score += 25;
  else tips.push('Falta description');
  if (input.hasImage) score += 20;
  else tips.push('Falta imagen OG');
  if (input.hasJsonLd) score += 20;
  else tips.push('Falta JSON-LD Product');
  if (input.titleLen && input.titleLen >= 20 && input.titleLen <= 60) score += 5;
  else tips.push('Title ideal 20–60 chars');
  if (input.descLen && input.descLen >= 70 && input.descLen <= 160) score += 5;
  else tips.push('Description ideal 70–160 chars');
  return { score: Math.min(100, score), tips };
}

export const SEO_META = {
  block: 34,
  features: ['meta_tags', 'json_ld_product', 'sitemap', 'robots', 'seo_score'],
};
