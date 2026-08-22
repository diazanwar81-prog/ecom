#!/usr/bin/env python3
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "class CatalogQualityController" in t and "packages/catalog-quality" in t:
    print("already 41-44")
    raise SystemExit(0)

if "packages/catalog-quality/src/index" not in t:
    imp = """import {
  cleanCommercialTitle,
  titleQualityScore,
  strictCjGate,
  countOrphanPublished,
  priceFromUsdCost,
  marginAfterFees,
  approvalQueuePolicy,
  verifyCatalogQuality,
  summarizeQuality,
  CATALOG_QUALITY_META,
} from '../../../packages/catalog-quality/src/index';
"""
    for pkg in [
        "packages/real-close/src/index",
        "packages/deploy/src/index",
        "packages/ops/src/index",
    ]:
        needle = f"}} from '../../../{pkg}';"
        if needle in t:
            t = t.replace(needle, needle + "\n" + imp.rstrip() + "\n", 1)
            break
    else:
        t = imp + t
    print("catalog-quality import")

t = t.replace("block: 40", "block: 44")
t = t.replace("block-40", "block-44")

CTRL = r'''
@Controller('catalog')
class CatalogQualityController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...CATALOG_QUALITY_META };
  }

  @Get('verify')
  async verify() {
    const products = await prisma.product.findMany({
      take: 300,
      include: { suppliers: true },
    });
    const published = products.filter((p) => p.status === 'PUBLISHED');
    const pending = products.filter((p) => p.status === 'PENDING_APPROVAL');
    const orphan = countOrphanPublished(products as any);

    const titles = published.map((p) => p.title);
    // sample margin on first published with supplier costs
    let sampleMarginOk = true;
    let sampleMarginPct: number | undefined;
    const sample = published.find((p) => (p.suppliers || []).length > 0);
    if (sample) {
      const s = sample.suppliers[0] as any;
      const sale = Number(sample.salePrice || 0);
      const cost = Number(s.productCost || 0);
      const ship = Number(s.shippingCost || 0);
      if (sale > 0) {
        const m = marginAfterFees({
          salePrice: sale,
          productCost: cost,
          shippingCost: ship,
        });
        sampleMarginOk = m.ok;
        sampleMarginPct = m.marginPct;
      }
    }

    const items = verifyCatalogQuality({
      publishedTitles: titles,
      orphanPublished: orphan.orphans,
      published: orphan.published,
      pendingApproval: pending.length,
      sampleMarginOk,
      sampleMarginPct,
    });
    const summary = summarizeQuality(items);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 44,
      ...summary,
      orphan,
      pendingApproval: pending.length,
      nextActions: summary.ok
        ? ['Opcional: POST /catalog/clean-titles dryRun',
           'Revisar PENDING_APPROVAL y go-live selectivo']
        : summary.items.filter((i) => !i.ok).map((i) => i.message),
    };
  }

  @Post('clean-title')
  cleanOne(@Body() body: { title?: string }) {
    const raw = body?.title || '';
    const q = titleQualityScore(raw);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 41,
      raw,
      ...q,
    };
  }

  @Post('clean-titles')
  async cleanTitles(@Body() body: { dryRun?: boolean; limit?: number }) {
    const dryRun = body?.dryRun !== false;
    const limit = Math.min(Number(body?.limit || 50), 100);
    const products = await prisma.product.findMany({
      where: { status: { in: ['PUBLISHED', 'PENDING_APPROVAL', 'DRAFT'] } },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });
    const changes: { id: string; from: string; to: string; score: number }[] = [];
    for (const p of products) {
      const q = titleQualityScore(p.title);
      if (q.cleaned && q.cleaned !== p.title && q.score < 85) {
        changes.push({ id: p.id, from: p.title, to: q.cleaned, score: q.score });
        if (!dryRun) {
          await prisma.product.update({
            where: { id: p.id },
            data: { title: q.cleaned },
          });
          await writeAudit('TITLE_CLEANED', 'Product', p.id, {
            from: p.title,
            to: q.cleaned,
          });
        }
      }
    }
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 41,
      dryRun,
      scanned: products.length,
      changes: changes.length,
      items: changes.slice(0, 30),
    };
  }

  @Post('cj-gate')
  async cjGate(@Body() body: { productId: string }) {
    const p = await prisma.product.findUnique({
      where: { id: body.productId },
      include: { suppliers: true },
    });
    if (!p) return { error: 'not_found' };
    const s = (p.suppliers || []).find((x: any) => x.isPrimary) || p.suppliers[0];
    const gate = strictCjGate({
      status: p.status,
      cjVariantId: s?.cjVariantId,
      cjSku: s?.cjSku,
      stock: s?.stock,
      verified: true,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 42, productId: p.id, gate, supplier: s };
  }

  @Post('price-cop')
  priceCop(
    @Body()
    body: {
      productCostUsd: number;
      shippingUsd?: number;
      targetMarginPct?: number;
    },
  ) {
    const result = priceFromUsdCost({
      productCostUsd: Number(body?.productCostUsd || 0),
      shippingUsd: body?.shippingUsd,
      targetMarginPct: body?.targetMarginPct,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 43, ...result };
  }

  @Post('margin-check')
  marginCheck(
    @Body()
    body: {
      salePrice: number;
      productCost: number;
      shippingCost: number;
    },
  ) {
    const m = marginAfterFees({
      salePrice: Number(body.salePrice),
      productCost: Number(body.productCost),
      shippingCost: Number(body.shippingCost),
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 43, ...m };
  }

  @Post('approval-policy')
  approvalPolicy(
    @Body()
    body: {
      createdToday?: number;
      confidence?: number;
      isFirstPublication?: boolean;
    },
  ) {
    const policy = approvalQueuePolicy({
      createdToday: Number(body?.createdToday || 0),
      confidence: Number(body?.confidence || 80),
      isFirstPublication: body?.isFirstPublication,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 44, policy };
  }
}
'''

if "class CatalogQualityController" not in t:
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + CTRL + "\n" + t[m.start() :]
        print("controller inserted")
    else:
        t = t + "\n" + CTRL

section = t.split("controllers:")[1][:800] if "controllers:" in t else ""
if "CatalogQualityController" not in section:
    t = re.sub(r"(controllers:\s*\[)", r"\1CatalogQualityController, ", t, count=1)
    print("registered CatalogQualityController")

MAIN.write_text(t)
print("done 41-44")
print("lines", len(t.splitlines()))
