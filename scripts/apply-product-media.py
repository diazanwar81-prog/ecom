#!/usr/bin/env python3
"""
1) Add Product.imageUrls Json? to Prisma schema
2) Improve resolveCjImageUrls to prefer SKU
3) POST /products/:id/sync-media and bulk hook
4) Panel: larger thumbs + Sync media button
"""
from pathlib import Path
import re

schema = Path('packages/database/prisma/schema.prisma')
s = schema.read_text(encoding='utf-8')
if 'imageUrls' not in s:
    s = s.replace(
        '  description        String?\n  status             ProductStatus',
        '  description        String?\n  imageUrls          Json?\n  status             ProductStatus',
        1,
    )
    schema.write_text(s, encoding='utf-8')
    print('schema: imageUrls added')
else:
    print('schema: imageUrls already present')

main = Path('apps/api/src/main.ts')
t = main.read_text(encoding='utf-8')

# Replace resolveCjImageUrls with SKU-aware version
OLD_RESOLVE = re.compile(
    r'async function resolveCjImageUrls\(title: string, sku\?: string \| null\): Promise<string\[]> \{[\s\S]*?^}\n\nfunction cleanProductTitle',
    re.M,
)

NEW_RESOLVE = r'''async function resolveCjImageUrls(title: string, sku?: string | null): Promise<string[]> {
  try {
    const urls: string[] = [];
    const push = (u: unknown) => {
      const s = String(u || '').trim();
      if (s && /^https?:\/\//i.test(s) && !urls.includes(s)) urls.push(s);
    };

    // 1) Prefer exact SKU lookup when available
    if (sku && String(sku).trim()) {
      try {
        const bySku = await searchCjProducts({ keyword: String(sku).trim(), pageSize: 3 });
        if (bySku.ok && bySku.items?.length) {
          for (const item of bySku.items) {
            push((item as any).productImage);
            push((item as any).productImageEn);
            push((item as any).bigImage);
            const gallery = (item as any).productImageList || (item as any).imageList || [];
            if (Array.isArray(gallery)) gallery.slice(0, 6).forEach(push);
          }
        }
      } catch {
        /* ignore sku path */
      }
    }

    // 2) Fallback keyword from title
    if (urls.length < 2) {
      const cleaned = String(title || '')
        .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
        .replace(/Cross-Border|Dropshipping|Fashion|Elegant|Light|Luxury/gi, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5)
        .join(' ')
        .trim();
      const keyword = cleaned || 'necklace';
      const found = await searchCjProducts({ keyword, pageSize: 5 });
      if (found.ok && found.items?.length) {
        for (const item of found.items) {
          push((item as any).productImage);
          push((item as any).productImageEn);
          push((item as any).bigImage);
        }
      }
    }
    return urls.slice(0, 6);
  } catch {
    return [];
  }
}

function cleanProductTitle'''

if OLD_RESOLVE.search(t):
    t = OLD_RESOLVE.sub(NEW_RESOLVE, t, count=1)
    print('resolveCjImageUrls upgraded')
else:
    print('WARNING: resolveCjImageUrls block not found')

# Add sync-media endpoint before generate-copy if missing
if "@Post(':id/sync-media')" not in t:
    anchor = "  @Post(':id/generate-copy')"
    sync_ep = r'''  @Post(':id/sync-media')
  async syncMedia(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const primary = p.suppliers?.[0];
    const urls = await resolveCjImageUrls(p.title, primary?.cjSku || null);
    const updated = await prisma.product.update({
      where: { id },
      data: { imageUrls: urls as any },
    });
    await writeAudit('PRODUCT_MEDIA_SYNC', 'Product', id, { count: urls.length, sku: primary?.cjSku });
    return {
      mode: MODE,
      productId: id,
      imageUrls: urls,
      count: urls.length,
      product: enrichProduct({ ...p, ...updated, imageUrls: urls }),
    };
  }

  @Post(':id/generate-copy')'''
    if anchor in t:
        t = t.replace(anchor, sync_ep, 1)
        print('sync-media endpoint added')
    else:
        print('WARNING: generate-copy anchor missing')
else:
    print('sync-media already present')

# On list: if imageUrls empty and has cjSku, try lightweight resolve (optional - skip for perf)
# Instead ensure enrichProduct reads Json correctly
t = t.replace(
    'imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],',
    '''imageUrls: Array.isArray(p.imageUrls)
      ? p.imageUrls
      : typeof p.imageUrls === 'string'
        ? (() => {
            try {
              const j = JSON.parse(p.imageUrls as any);
              return Array.isArray(j) ? j : [];
            } catch {
              return [];
            }
          })()
        : [],''',
    1,
)
print('enrichProduct imageUrls hardened')

main.write_text(t, encoding='utf-8')

# Web: Sync media button + larger images
web = Path('apps/web/app/page.tsx')
w = web.read_text(encoding='utf-8')

if 'syncMedia' not in w:
    w = w.replace(
        'async function syncInventory(id: string) {',
        '''async function syncMedia(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/sync-media`, { method: 'POST' });
    const data = await res.json();
    if (data.error) setMessage(`Media: ${data.error}`);
    else setMessage(`Media OK · ${data.count || 0} imagen(es) CJ`);
    await load();
  }

  async function syncInventory(id: string) {''',
        1,
    )
    print('web syncMedia helper')

# Enlarge thumbs if present
w = w.replace(
    '''                        style={{
                          width: 96,
                          height: i === 0 ? 96 : 44,
                          objectFit: 'cover',
                          borderRadius: 6,
                          background: '#f1f5f9',
                        }}''',
    '''                        style={{
                          width: i === 0 ? 140 : 64,
                          height: i === 0 ? 140 : 64,
                          objectFit: 'cover',
                          borderRadius: 8,
                          background: '#f1f5f9',
                          border: '1px solid #e2e8f0',
                        }}''',
    1,
)

# grid column wider
w = w.replace(
    "gridTemplateColumns: imgs.length ? '96px 1fr' : '1fr',",
    "gridTemplateColumns: imgs.length ? '148px 1fr' : '1fr',",
    1,
)

# Add Sync media button next to Sync stock
if 'Sync media' not in w:
    w = w.replace(
        '''                    <button
                      type="button"
                      onClick={() => syncInventory(p.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      Sync stock
                    </button>''',
        '''                    <button
                      type="button"
                      onClick={() => syncMedia(p.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      Sync media
                    </button>
                    <button
                      type="button"
                      onClick={() => syncInventory(p.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      Sync stock
                    </button>''',
        1,
    )
    print('web Sync media button')

# Placeholder when no images
if 'Sin imagen CJ' not in w:
    w = w.replace(
        '{imgs.length > 0 && (',
        '''{imgs.length === 0 && (
                  <div
                    style={{
                      width: 140,
                      height: 140,
                      borderRadius: 8,
                      background: '#f1f5f9',
                      border: '1px dashed #cbd5e1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      color: '#94a3b8',
                      textAlign: 'center',
                      padding: 8,
                    }}
                  >
                    Sin imagen CJ
                    <br />
                    usa Sync media
                  </div>
                )}
                {imgs.length > 0 && (''',
        1,
    )
    # also force grid when no imgs to show placeholder
    w = w.replace(
        "gridTemplateColumns: imgs.length ? '148px 1fr' : '1fr',",
        "gridTemplateColumns: '148px 1fr',",
        1,
    )
    print('web placeholder')

web.write_text(w, encoding='utf-8')
print('Done')
