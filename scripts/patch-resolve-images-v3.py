#!/usr/bin/env python3
from pathlib import Path

main = Path('apps/api/src/main.ts')
t = main.read_text(encoding='utf-8')

start = t.find('async function resolveCjImageUrls(')
if start < 0:
    raise SystemExit('resolveCjImageUrls not found')
end = t.find('function cleanProductTitle', start)
if end < 0:
    raise SystemExit('cleanProductTitle not found')

new_fn = r'''async function resolveCjImageUrls(title: string, sku?: string | null): Promise<string[]> {
  const urls: string[] = [];
  const push = (u: unknown) => {
    const s = String(u || '').trim();
    if (s && /^https?:\/\//i.test(s) && !urls.includes(s)) urls.push(s);
  };
  try {
    // A) by SKU string search
    if (sku && String(sku).trim()) {
      try {
        const bySku = await searchCjProducts({ keyword: String(sku).trim(), pageSize: 5 });
        if (bySku.ok && bySku.items?.length) {
          for (const item of bySku.items as any[]) {
            push(item.productImage);
            push(item.productImageEn);
            push(item.bigImage);
            const list = item.productImageList || item.imageList || item.productImgList;
            if (Array.isArray(list)) list.slice(0, 8).forEach(push);
          }
        }
      } catch {}
    }
    // B) keyword from cleaned title
    if (urls.length < 1) {
      const cleaned = String(title || '')
        .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
        .replace(/Cross-Border|Dropshipping/gi, ' ')
        .replace(/[^a-zA-Z0-9\u00C0-\u024F\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 6)
        .join(' ')
        .trim();
      if (cleaned) {
        try {
          const found = await searchCjProducts({ keyword: cleaned, pageSize: 8 });
          if (found.ok && found.items?.length) {
            for (const item of found.items as any[]) {
              push(item.productImage);
              push(item.productImageEn);
              push(item.bigImage);
            }
          }
        } catch {}
      }
    }
    // C) matchCjByKeyword helper if present
    if (urls.length < 1 && typeof (matchCjByKeyword as any) === 'function') {
      try {
        const kw = String(sku || title || '').slice(0, 40);
        const m = await (matchCjByKeyword as any)(kw);
        if (m?.product) {
          push(m.product.productImage);
          push(m.product.productImageEn);
        }
      } catch {}
    }
  } catch {
    /* ignore */
  }
  return urls.slice(0, 6);
}

'''

t2 = t[:start] + new_fn + t[end:]
main.write_text(t2, encoding='utf-8')
print('resolveCjImageUrls replaced, lines', len(t2.splitlines()))
