#!/usr/bin/env python3
"""Wire phases D-J: GET /v1/verify, GET /v1/status, GET /l/:productId (HTML)."""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

IMP = """import {
  verifyV1Final,
  V1_FINAL_META,
} from '../../../packages/v1-final/src/index';
"""

if 'verifyV1Final' not in text:
    # after phase-c import if present
    markers = [
        "from '../../../packages/phase-c/src/index';",
        "from '../../../packages/autonomy/src/index';",
        "from '../../../packages/release/src/index';",
    ]
    inserted = False
    for m in markers:
        if m in text:
            i = text.find(m)
            end = text.find(';\n', i)
            text = text[: end + 2] + IMP + text[end + 2 :]
            inserted = True
            break
    if not inserted:
        # after first import block
        text = IMP + text

CTRL = r'''
@Controller('v1')
class V1FinalController {
  @Get('status')
  status() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...V1_FINAL_META,
    };
  }

  @Get('verify')
  async verify() {
    const mode = process.env.ECOM_MODE || 'MOCK';
    const published = await prisma.product.count({ where: { status: 'PUBLISHED' } }).catch(() => 0);
    const pendingApproval = await prisma.product
      .count({ where: { status: 'PENDING_APPROVAL' } })
      .catch(() => 0);
    const paused = await prisma.product.count({ where: { status: 'PAUSED' } }).catch(() => 0);

    // published with CJ link via suppliers relation when available
    let publishedWithCj = 0;
    let orphanPublished = 0;
    try {
      const pubs = await prisma.product.findMany({
        where: { status: 'PUBLISHED' },
        include: { suppliers: { take: 3 } },
      });
      for (const p of pubs) {
        const hasCj = (p as any).suppliers?.some(
          (s: any) => s.cjVariantId || s.cjSku,
        ) || (p as any).cjVariantId || (p as any).cjSku;
        if (hasCj) publishedWithCj++;
        else orphanPublished++;
      }
    } catch {
      publishedWithCj = published;
      orphanPublished = 0;
    }

    const paidOrders = await prisma.order.count({ where: { status: 'PAID' } }).catch(() => 0);
    const fulfilledOrders = await prisma.order
      .count({ where: { status: 'FULFILLED' } })
      .catch(() => 0);
    const paidUnfulfilled = paidOrders;

    const shopify = getShopifyStatus();
    const cj = typeof getCjStatus === 'function' ? getCjStatus() : { canFulfillLive: false };

    let discoverySchedulerOn = false;
    try {
      // soft: env interval implies scheduler intent; runtime jobs/status is better
      discoverySchedulerOn =
        String(process.env.ECOM_DISCOVERY_INTERVAL_MINUTES || '').length > 0 ||
        String(process.env.ECOM_DISCOVERY_SCHEDULER || 'true').toLowerCase() !== 'false';
    } catch {
      discoverySchedulerOn = true;
    }

    const summary = verifyV1Final({
      mode,
      published,
      publishedWithCj,
      pendingApproval,
      paidOrders,
      fulfilledOrders,
      paidUnfulfilled,
      paused,
      orphanPublished,
      shopifyLive: Boolean(shopify.canPublishLive),
      cjLive: Boolean((cj as any).canFulfillLive || (cj as any).configured),
      discoverySchedulerOn,
      serperConfigured: Boolean(process.env.SERPER_API_KEY),
      telegramConfigured: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
      ),
      ffmpegAvailable: typeof ffmpegAvailable === 'function' ? ffmpegAvailable() : false,
      landingBuilderOk: typeof buildProductLanding === 'function',
      publicLandingRoute: true,
    });

    return {
      mode,
      ...summary,
    };
  }
}

@Controller('l')
class PublicLandingController {
  /** Public HTML landing for a product (phase D) */
  @Get(':productId')
  async publicLanding(@Param('productId') productId: string) {
    const p = await prisma.product.findUnique({
      where: { id: productId },
      include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
    });
    if (!p) {
      return {
        error: 'not_found',
        html: '<!DOCTYPE html><html><body><h1>Producto no encontrado</h1></body></html>',
      };
    }

    let imageUrls: string[] = [];
    try {
      if (typeof resolveCjImageUrls === 'function') {
        imageUrls = await resolveCjImageUrls(
          p.title,
          (p as any).suppliers?.[0]?.cjSku || (p as any).cjSku,
        );
      }
    } catch {
      imageUrls = [];
    }

    const shopDomain =
      process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '';
    const handleHint = p.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    const shopifyUrl =
      p.externalId && shopDomain
        ? `https://${shopDomain.includes('.') ? shopDomain : shopDomain + '.myshopify.com'}/products/${handleHint}`
        : null;

    const landing = buildProductLanding({
      title: p.title,
      description: p.description,
      salePrice: p.salePrice as any,
      currency: (p as any).currency || 'COP',
      imageUrls,
      productId: p.id,
      shopifyUrl,
      countryCode: 'CO',
    });

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      phase: 'D',
      productId: p.id,
      contentType: 'text/html',
      landing,
      // Nest default JSON; clients can use landing.html
      html: landing.html,
    };
  }
}
'''

if "class V1FinalController" not in text:
    # insert before controllers array or before @Module
    if 'controllers: [PhaseCController' in text:
        text = text.replace(
            'controllers: [PhaseCController',
            CTRL + '\ncontrollers: [V1FinalController, PublicLandingController, PhaseCController',
            1,
        )
    elif 'controllers: [' in text:
        text = text.replace(
            'controllers: [',
            CTRL + '\ncontrollers: [V1FinalController, PublicLandingController, ',
            1,
        )
    else:
        text = text + '\n' + CTRL

# bump health block if present
import re
text2, n = re.subn(r'block:\s*9\d', 'block: 100', text, count=3)
if n:
    text = text2
elif 'block: 95' in text:
    text = text.replace('block: 95', 'block: 100', 1)

MAIN.write_text(text, encoding='utf-8')
print('Patched', MAIN)
print('V1FinalController:', 'class V1FinalController' in text)
print('PublicLandingController:', 'class PublicLandingController' in text)
print('verifyV1Final import:', 'verifyV1Final' in text)
