#!/usr/bin/env python3
"""Wire autonomy blocks 67-75 into apps/api/src/main.ts without breaking bootstrap."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/api/src/main.ts"
text = MAIN.read_text()

IMPORT = """
import {
  AUTONOMY_META,
  isAutoGoLiveEnabled,
  publishBudgetGate,
  autonomyBoard,
  firstSaleSmoke,
  dailyPublishCap,
} from '../../../packages/autonomy/src/index';
"""

if "packages/autonomy/src/index" not in text:
    for anchor in [
        "from '../../../packages/approvals-auto/src/index';",
        "from '../../../packages/media/src/index';",
    ]:
        if anchor in text:
            idx = text.find(anchor) + len(anchor)
            text = text[:idx] + "\n" + IMPORT + text[idx:]
            break
    else:
        raise SystemExit("no import anchor")

# health block -> 75
text = re.sub(
    r"(async health\(\)[\s\S]*?block:\s*)\d+",
    r"\g<1>75",
    text,
    count=1,
)

CONTROLLER = r'''
@Controller('autonomy')
class AutonomyController {
  @Get('meta')
  meta() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...AUTONOMY_META,
      autoGoLive: isAutoGoLiveEnabled(),
      publishCap: dailyPublishCap(),
    };
  }

  @Get('board')
  async board() {
    const products = await prisma.product.findMany({ take: 400, include: { suppliers: true } });
    const orders = await prisma.order.findMany({ take: 200 });
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const publishedToday = await prisma.product.count({
      where: { status: 'PUBLISHED', updatedAt: { gte: start } },
    });
    const published = products.filter((p) => p.status === 'PUBLISHED');
    const withCj = published.filter((p) =>
      (p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 75,
      ...autonomyBoard({
        mode: process.env.ECOM_MODE || 'MOCK',
        published: published.length,
        draft: products.filter((p) => p.status === 'DRAFT').length,
        pendingApproval: products.filter((p) => p.status === 'PENDING_APPROVAL').length,
        publishedWithCj: withCj,
        paidUnfulfilled: orders.filter((o) => o.status === 'PAID').length,
        autoApproveOn: String(process.env.ECOM_AUTO_APPROVE_CJ || '').toLowerCase() === 'true',
        autoGoLiveOn: isAutoGoLiveEnabled(),
        shopifyLive: String(process.env.SHOPIFY_ACCESS_TOKEN || '').length > 5,
        cjLive: String(process.env.CJ_API_KEY || '').length > 5,
        killSwitch:
          process.env.ECOM_KILL_SWITCH === 'true' || process.env.ECOM_PAUSE_ALL === 'true',
        publishedToday,
      }),
    };
  }

  @Get('smoke')
  async smoke() {
    const products = await prisma.product.findMany({ take: 300, include: { suppliers: true } });
    const orders = await prisma.order.findMany({ take: 200 });
    const publishedWithCj = products.filter(
      (p) =>
        p.status === 'PUBLISHED' &&
        (p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    const apiUrl = process.env.API_URL || process.env.APP_URL || '';
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...firstSaleSmoke({
        shopifyLive: String(process.env.SHOPIFY_ACCESS_TOKEN || '').length > 5,
        cjLive: String(process.env.CJ_API_KEY || '').length > 5,
        publishedWithCj,
        hasDraftApproved: products.some((p) => p.status === 'DRAFT'),
        paidOrders: orders.filter((o) => o.status === 'PAID').length,
        fulfilledOrders: orders.filter((o) => o.status === 'FULFILLED').length,
        webhookSecret: String(process.env.SHOPIFY_WEBHOOK_SECRET || '').length > 3,
        httpsPublic: /^https:\/\//i.test(apiUrl),
      }),
    };
  }

  /** Block 70: batch go-live for DRAFT products with CJ (respects daily cap if auto flag on; manual always limited) */
  @Post('go-live-batch')
  async goLiveBatch(
    @Body()
    body: { limit?: number; note?: string; requireAutoFlag?: boolean },
  ) {
    const limit = Math.min(Number(body?.limit || 1), 5);
    const requireFlag = body?.requireAutoFlag === true;
    if (requireFlag && !isAutoGoLiveEnabled()) {
      return {
        error: 'disabled',
        message: 'ECOM_AUTO_GO_LIVE=false. Quita requireAutoFlag o actívalo en .env',
      };
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const publishedToday = await prisma.product.count({
      where: { status: 'PUBLISHED', updatedAt: { gte: start } },
    });
    const gate = publishBudgetGate({
      publishedToday,
      killSwitch:
        process.env.ECOM_KILL_SWITCH === 'true' || process.env.ECOM_PAUSE_ALL === 'true',
    });
    // Manual batch allowed even if auto flag off, but still respect kill switch + soft cap
    if (gate.reason === 'kill_switch') {
      return { error: 'kill_switch', gate };
    }
    const softCap = requireFlag ? gate.remaining : Math.min(limit, dailyPublishCap());
    const max = Math.min(limit, softCap > 0 ? softCap : limit);

    const drafts = await prisma.product.findMany({
      where: { status: 'DRAFT' },
      take: 40,
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    });

    const results: any[] = [];
    for (const p of drafts) {
      if (results.filter((r) => r.published).length >= max) break;
      const e = enrichProduct(p);
      if (!(e.cjVariantId || e.cjSku) || e.shouldPause || !e.canPublish) {
        results.push({ productId: p.id, published: false, reason: 'rules_or_no_cj' });
        continue;
      }
      // Reuse go-live logic via internal approval + publishProduct
      try {
        const admin = await prisma.user.findFirst({ where: { email: 'admin@ecom.local' } });
        let approval = await prisma.approval.findFirst({
          where: { productId: p.id, status: 'APPROVED' },
        });
        if (!approval) {
          approval = await prisma.approval.create({
            data: {
              productId: p.id,
              requestedBy: admin?.id ?? 'system',
              action: 'FIRST_PUBLICATION',
              reason: body?.note || 'batch go-live 67-75',
              status: 'APPROVED',
              decidedAt: new Date(),
              metadata: { via: 'go-live-batch' },
            },
          });
        }
        const liveTitle = cleanProductTitle(e.title);
        const imageUrls = await resolveCjImageUrls(liveTitle, e.cjSku);
        const pub = await publishProduct({
          title: liveTitle,
          description: e.description || liveTitle,
          price: e.salePrice,
          currency: e.currency,
          sku: e.cjSku || `ECOM-${p.id.slice(-8)}`,
          inventory: e.stock,
          imageUrls,
        });
        if (!pub.ok) {
          results.push({ productId: p.id, published: false, error: pub.error || 'publish_failed' });
          continue;
        }
        await prisma.product.update({
          where: { id: p.id },
          data: {
            status: 'PUBLISHED',
            externalId: pub.externalId,
            isFirstPublication: false,
            title: liveTitle,
            sourceMode: pub.mock ? 'MOCK' : MODE_ENUM,
          },
        });
        await writeAudit('BATCH_GO_LIVE', 'Product', p.id, { externalId: pub.externalId });
        results.push({
          productId: p.id,
          published: true,
          externalId: pub.externalId,
          adminUrl: pub.adminUrl,
          title: liveTitle.slice(0, 60),
        });
      } catch (err: any) {
        results.push({ productId: p.id, published: false, error: err?.message || String(err) });
      }
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 70,
      max,
      publishedToday,
      published: results.filter((r) => r.published).length,
      results,
      note: 'Batch go-live (67-75). Prefer limit=1 la primera vez.',
    };
  }
}

'''

if "class AutonomyController" not in text:
    # insert before @Module
    mod = "@Module({"
    if mod not in text:
        raise SystemExit("@Module not found")
    text = text.replace(mod, CONTROLLER + "\n" + mod, 1)

if "AutonomyController" not in text.split("controllers:")[1][:800]:
    text = text.replace(
        "controllers: [CreativeController",
        "controllers: [AutonomyController, CreativeController",
        1,
    )

# Safe bootstrap log rewrite
idx = text.rfind("console.log(`ECOM API block-")
if idx >= 0:
    good = (
        "console.log(`ECOM API block-75 (autonomy 67-75) on "
        "${process.env.API_PORT ?? 4000} mode=${MODE}`);\n"
        "}\n\n"
        "void bootstrap();\n"
    )
    text = text[:idx] + good
else:
    if not text.rstrip().endswith("void bootstrap();"):
        text = text.rstrip() + "\n\nvoid bootstrap();\n"

text = re.sub(
    r"void alertOps\('BOOT', \{ service: 'ecom-api', block: \d+ \}\);",
    "void alertOps('BOOT', { service: 'ecom-api', block: 75 });",
    text,
    count=1,
)

MAIN.write_text(text)
out = MAIN.read_text()
print("Patched", MAIN)
print("  autonomy import:", "packages/autonomy" in out)
print("  AutonomyController:", "class AutonomyController" in out)
print("  board route:", "go-live-batch" in out)
print("  bootstrap ok:", out.rstrip().endswith("void bootstrap();"))
print("  last line:", out.splitlines()[-1])
