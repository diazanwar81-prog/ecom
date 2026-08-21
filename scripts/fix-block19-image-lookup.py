#!/usr/bin/env python3
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / 'apps/api/src/main.ts'
t = MAIN.read_text()

OLD = r'''async function resolveCjImageUrls(title: string, sku?: string | null): Promise<string[]> {
  try {
    const keyword =
      (sku && String(sku)) ||
      String(title || '')
        .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 4)
        .join(' ');
    if (!keyword) return [];
    const found = await searchCjProducts({ keyword, pageSize: 3 });
    if (!found.ok) return [];
    const urls = found.items
      .map((p) => p.productImage)
      .filter((u): u is string => Boolean(u && /^https?:\/\//i.test(u)));
    return urls.slice(0, 3);
  } catch {
    return [];
  }
}'''

# more tolerant: match function by name
pat = re.compile(
    r'async function resolveCjImageUrls\([\s\S]*?\n\}\n',
    re.M,
)

NEW = '''async function resolveCjImageUrls(title: string, sku?: string | null): Promise<string[]> {
  try {
    // Never search CJ by SKU in productNameEn — use title words
    const cleaned = String(title || '')
      .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
      .replace(/Cross-Border|Dropshipping|Fashion|Elegant|Light|Luxury/gi, ' ')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(' ')
      .trim();
    const keyword = cleaned || 'home decor';
    const found = await searchCjProducts({ keyword, pageSize: 5 });
    if (!found.ok || !found.items?.length) return [];
    const urls: string[] = [];
    for (const p of found.items) {
      const u = (p as any).productImage || (p as any).productImageEn || (p as any).bigImage;
      if (u && /^https?:\/\//i.test(String(u))) urls.push(String(u));
    }
    // Prefer items whose sku matches if we have one
    if (sku) {
      const hit = found.items.find((p) => (p.productSku || '').includes(String(sku).slice(0, 8)));
      const u = hit && ((hit as any).productImage || (hit as any).bigImage);
      if (u && /^https?:\/\//i.test(String(u))) return [String(u), ...urls].slice(0, 3);
    }
    return urls.slice(0, 3);
  } catch {
    return [];
  }
}
'''

m = pat.search(t)
if not m:
    print('resolveCjImageUrls not found')
    raise SystemExit(1)
t = pat.sub(NEW, t, count=1)
MAIN.write_text(t)
print('Fixed resolveCjImageUrls')
