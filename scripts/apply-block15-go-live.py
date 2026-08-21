#!/usr/bin/env python3
"""Add POST /products/:id/go-live (approve + publish) and bump health block to 15."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/api/src/main.ts"
WEB = ROOT / "apps/web/app/page.tsx"

GO_LIVE = r'''
  /** Block 15: human OK + publish Shopify in one step (CJ links preserved on product). */
  @Post(':id/go-live')
  async goLive(@Param('id') id: string, @Body() body: { note?: string }) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const enriched = enrichProduct(p);
    if (enriched.shouldPause || !enriched.canPublish) {
      return { error: 'rules_block', reason: 'Margen/stock no permiten publicación', item: enriched };
    }

    const admin = await prisma.user.findFirst({ where: { email: 'admin@ecom.local' } });
    let approval = await prisma.approval.findFirst({
      where: { productId: id, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
    });

    if (!approval) {
      const pending = await prisma.approval.findFirst({
        where: { productId: id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      if (pending) {
        approval = await prisma.approval.update({
          where: { id: pending.id },
          data: {
            status: 'APPROVED',
            decidedAt: new Date(),
            metadata: { ...(pending.metadata as object), note: body?.note || 'go-live', via: 'go-live' },
          },
        });
      } else {
        approval = await prisma.approval.create({
          data: {
            productId: id,
            requestedBy: admin?.id ?? 'system',
            action: 'FIRST_PUBLICATION',
            reason: body?.note || 'Go-live: aprobación + publicación',
            status: 'APPROVED',
            decidedAt: new Date(),
            metadata: { via: 'go-live', requiresHuman: true },
          },
        });
      }
      await writeAudit('APPROVAL_APPROVED', 'Approval', approval.id, { via: 'go-live' });
    }

    const sku = enriched.cjSku || `ECOM-${id.slice(-8)}`;
    const result = await publishProduct({
      title: enriched.title,
      description: enriched.description,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku,
      inventory: enriched.stock,
    });
    if (!result.ok) {
      await writeAudit('GO_LIVE_FAILED', 'Product', id, result);
      return { mode: MODE, error: 'publish_failed', approval, result };
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        externalId: result.externalId,
        isFirstPublication: false,
        sourceMode: result.mock ? 'MOCK' : MODE_ENUM,
      },
    });
    await writeAudit('PRODUCT_GO_LIVE', 'Product', id, {
      shopify: result.externalId,
      cjVariantId: enriched.cjVariantId,
      cjSku: enriched.cjSku,
      mock: result.mock,
    });

    return {
      mode: MODE,
      published: true,
      mock: result.mock,
      product: updated,
      approval,
      shopify: result,
      cj: { variantId: enriched.cjVariantId, sku: enriched.cjSku },
      note: 'Publicado tras aprobación humana (go-live). Vínculo CJ conservado en ProductSupplier.',
    };
  }

'''

def patch_main():
    t = MAIN.read_text()
    if "async goLive" in t and "block: 15" in t:
        print("main already block 15")
        return
    if "async goLive" not in t:
        anchor = "  @Post(':id/generate-copy')"
        if anchor not in t:
            print("ERROR: generate-copy anchor missing")
            sys.exit(1)
        t = t.replace(anchor, GO_LIVE + anchor, 1)
    # prefer publish sku with cj if present — optional soft replace
    t = t.replace(
        "sku: `ECOM-${id.slice(-8)}`",
        "sku: enriched.cjSku || `ECOM-${id.slice(-8)}`",
        1,
    )
    t = t.replace("block: 13,", "block: 15,", 1)
    t = t.replace("block: 11,", "block: 15,", 1)
    t = t.replace(
        "ECOM API block-13 (scheduler)",
        "ECOM API block-15 (go-live)",
        1,
    )
    MAIN.write_text(t)
    print("Patched main.ts go-live + block 15")

def patch_web():
    if not WEB.exists():
        print("skip web")
        return
    t = WEB.read_text()
    if "goLive" in t:
        print("web already has goLive")
        return
    # add function after publish if exists, else after requestApproval
    fn = '''
  async function goLive(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/go-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Aprobado y publicado desde panel' }),
    });
    const data = await res.json();
    if (data.error) setMessage(`Go-live: ${data.error} ${data.reason || ''}`);
    else setMessage(`Go-live OK · shopify=${data.shopify?.externalId} · mock=${data.mock}`);
    await load();
  }
'''
    if "async function publish" in t:
        t = t.replace("async function publish", fn + "\n  async function publish", 1)
    elif "async function requestApproval" in t:
        t = t.replace("async function requestApproval", fn + "\n  async function requestApproval", 1)
    else:
        print("WARNING: could not insert goLive fn")

    btn = '<button type="button" onClick={() => goLive(p.id)} style={{ cursor: \'pointer\', background: \'#16a34a\', color: \'#fff\', border: \'none\', padding: \'4px 10px\', borderRadius: 4 }}>Aprobar y publicar</button>'
    # insert near publish button or pipeline
    if "onClick={() => publish(p.id)}" in t and "goLive(p.id)" not in t:
        t = t.replace(
            "<button type=\"button\" onClick={() => publish(p.id)}" ,
            btn + "\n                <button type=\"button\" onClick={() => publish(p.id)",
            1,
        )
    elif "Pipeline" in t and "goLive(p.id)" not in t:
        t = t.replace(
            "Pipeline</button>",
            "Pipeline</button>\n                " + btn,
            1,
        )
    WEB.write_text(t)
    print("Patched web page go-live button")

def main():
    patch_main()
    patch_web()
    print("Done block 15")

if __name__ == "__main__":
    main()
