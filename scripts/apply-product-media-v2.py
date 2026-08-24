#!/usr/bin/env python3
"""Add sync-media endpoint + optional imageUrls field. No re.sub with backslashes."""
from pathlib import Path

schema = Path('packages/database/prisma/schema.prisma')
s = schema.read_text(encoding='utf-8')
if 'imageUrls' not in s:
    s = s.replace(
        '  description        String?\n  status             ProductStatus',
        '  description        String?\n  imageUrls          Json?\n  status             ProductStatus',
        1,
    )
    schema.write_text(s, encoding='utf-8')
    print('schema imageUrls added')
else:
    print('schema ok')

main = Path('apps/api/src/main.ts')
t = main.read_text(encoding='utf-8')

if "@Post(':id/sync-media')" not in t:
    needle = "  @Post(':id/generate-copy')"
    insert = """  @Post(':id/sync-media')
  async syncMedia(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const primary = p.suppliers && p.suppliers[0];
    const urls = await resolveCjImageUrls(p.title, primary ? primary.cjSku : null);
    let updated = p;
    try {
      updated = await prisma.product.update({
        where: { id },
        data: { imageUrls: urls as any },
      });
    } catch (e: any) {
      // schema without imageUrls yet — still return urls
      return {
        mode: MODE,
        productId: id,
        imageUrls: urls,
        count: urls.length,
        warning: 'imageUrls column missing or update failed: ' + String(e && e.message),
      };
    }
    await writeAudit('PRODUCT_MEDIA_SYNC', 'Product', id, {
      count: urls.length,
      sku: primary ? primary.cjSku : null,
    });
    return {
      mode: MODE,
      productId: id,
      imageUrls: urls,
      count: urls.length,
      product: enrichProduct({ ...p, ...updated, imageUrls: urls }),
    };
  }

  @Post(':id/generate-copy')"""
    if needle not in t:
        raise SystemExit('generate-copy anchor not found')
    t = t.replace(needle, insert, 1)
    main.write_text(t, encoding='utf-8')
    print('sync-media endpoint inserted')
else:
    print('sync-media already present')

# web button
web = Path('apps/web/app/page.tsx')
w = web.read_text(encoding='utf-8')
changed = False
if 'async function syncMedia' not in w:
    w = w.replace(
        'async function syncInventory(id: string) {',
        """async function syncMedia(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/sync-media`, { method: 'POST' });
    const data = await res.json();
    if (data.error) setMessage(`Media: ${data.error}`);
    else setMessage(`Media OK · ${data.count || 0} imagen(es)`);
    await load();
  }

  async function syncInventory(id: string) {""",
        1,
    )
    changed = True
    print('web helper')
if 'Sync media' not in w and 'syncInventory(p.id)' in w:
    w = w.replace(
        "onClick={() => syncInventory(p.id)}",
        "onClick={() => syncMedia(p.id)}\n                      style={{ cursor: 'pointer' }}\n                    >\n                      Sync media\n                    </button>\n                    <button\n                      type=\"button\"\n                      onClick={() => syncInventory(p.id)}",
        1,
    )
    # fragile — better explicit block
    changed = True

if 'Sync media' not in w:
    # insert button before Sync stock label
    if '>\n                      Sync stock\n                    </button>' in w:
        w = w.replace(
            '>\n                      Sync stock\n                    </button>',
            """>
                      Sync stock
                    </button>
                    <button
                      type="button"
                      onClick={() => syncMedia(p.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      Sync media
                    </button>""",
            1,
        )
        changed = True
        print('web button near sync stock')

if changed:
    web.write_text(w, encoding='utf-8')
else:
    print('web unchanged or already patched')

print('done')
