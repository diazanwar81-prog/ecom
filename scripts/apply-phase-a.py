#!/usr/bin/env python3
"""Wire Phase A verify endpoint + enrichProduct imageUrls into apps/api/src/main.ts"""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

IMPORT = """import {
  PHASE_A_META,
  buildPhaseAChecks,
  summarizePhaseA,
} from '../../../packages/phase-a/src/index';
import {
  ensureShopifyAccessToken,
} from '../../../packages/shopify/src/index';
"""

if 'PHASE_A_META' not in text:
    # after autonomy import block
    needle = "from '../../../packages/autonomy/src/index';"
    if needle in text:
        text = text.replace(needle, needle + "\n\n" + IMPORT, 1)
    else:
        text = IMPORT + text

# enrichProduct: add imageUrls: [] if missing
if 'imageUrls:' not in text.split('function enrichProduct')[1][:1200]:
    text = text.replace(
        'description: p.description,\n  };\n}',
        "description: p.description,\n    imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],\n  };\n}",
        1,
    )

CONTROLLER = r'''
@Controller('phase-a')
class PhaseAController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...PHASE_A_META };
  }

  @Get('verify')
  async verify() {
    const mode = process.env.ECOM_MODE || 'MOCK';
    const shopify = getShopifyStatus();
    const cj = getCjStatus();
    const products = await prisma.product.findMany({
      take: 300,
      include: { suppliers: true },
    });
    const orders = await prisma.order.findMany({ take: 200 });
    const publishedWithCj = products.filter(
      (p) =>
        p.status === 'PUBLISHED' &&
        (p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    const withDesc = products.filter((p) => p.description && String(p.description).length > 10).length;
    const apiUrl = process.env.API_URL || process.env.APP_URL || '';

    let tokenOk: boolean | undefined;
    let tokenError: string | undefined;
    try {
      const tr = await ensureShopifyAccessToken();
      tokenOk = tr.ok;
      tokenError = tr.error;
    } catch (e: any) {
      tokenOk = false;
      tokenError = e?.message || String(e);
    }

    const items = buildPhaseAChecks({
      mode,
      shopifyConfigured: shopify.configured,
      tokenRefreshReady: Boolean((shopify as any).tokenRefreshReady),
      tokenOk,
      tokenError,
      cjConfigured: Boolean(process.env.CJ_API_KEY && String(process.env.CJ_API_KEY).length > 5),
      webhookSecret: String(process.env.SHOPIFY_WEBHOOK_SECRET || '').length > 3,
      httpsPublic: /^https:\/\//i.test(apiUrl),
      publishedWithCj,
      productsWithDescription: withDesc,
      productsTotal: products.length,
      paidOrders: orders.filter((o) => o.status === 'PAID').length,
      fulfilledOrders: orders.filter((o) => o.status === 'FULFILLED').length,
      inventorySyncSupported: true,
    });

    const summary = summarizePhaseA(items);
    const errors = items.filter((i) => !i.ok).map((i) => ({
      id: i.id,
      severity: i.severity,
      message: i.message,
      detail: i.detail,
    }));

    return {
      mode,
      block: 81,
      phase: 'A',
      ...summary,
      errors,
      panel: errors.length
        ? { title: 'Errores / advertencias Fase A', items: errors }
        : { title: 'Fase A OK', items: [] },
      next: summary.ok
        ? [
            '1) go-live de 1 producto con stock > 0',
            '2) Revisar inventario en Shopify > 0',
            '3) Pedido de prueba → fulfill → tracking',
          ]
        : errors.filter((e) => e.severity === 'critical').map((e) => e.message),
    };
  }

  @Post('token-refresh')
  async tokenRefresh() {
    const r = await ensureShopifyAccessToken();
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 77, ...r };
  }
}
'''

if 'class PhaseAController' not in text:
    text = text.replace(
        '@Controller(\x27autonomy\x27)\nclass AutonomyController',
        CONTROLLER + '\n\n@Controller(\x27autonomy\x27)\nclass AutonomyController',
        1,
    )

if 'PhaseAController,' not in text and 'PhaseAController' in text:
    text = text.replace(
        'controllers: [AutonomyController,',
        'controllers: [PhaseAController, AutonomyController,',
        1,
    )

# health block bump
text = text.replace('block: 75,', 'block: 81,', 1)
text = text.replace('block-75 (autonomy 67-75)', 'block-81 (phase-A verify)', 1)

MAIN.write_text(text, encoding='utf-8')
print('Patched', MAIN)
print('PhaseAController:', 'PhaseAController' in text)
print('ensureShopifyAccessToken import:', 'ensureShopifyAccessToken' in text)
