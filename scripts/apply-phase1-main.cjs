#!/usr/bin/env node
/**
 * Phase-1 wire for apps/api/src/main.ts — CommonJS (no ESM issues)
 * Run: docker compose run --rm workspace node scripts/apply-phase1-main.cjs
 */
const fs = require('fs');

const path = 'apps/api/src/main.ts';
let t = fs.readFileSync(path, 'utf8');

if (t.includes('phase1-runtime-wire')) {
  console.log('Already wired');
  process.exit(0);
}

const anchor = "from '../../../packages/ops/src/index';";
const insert =
  "from '../../../packages/ops/src/index';\n" +
  'import {\n' +
  '  handleOrdersWebhookPhase1,\n' +
  '  runTrackingPollAll,\n' +
  '  enhanceInventorySyncLoop,\n' +
  '  buildProductDedupeKey,\n' +
  '  phase1VerifyEndpoints,\n' +
  "} from './phase1-runtime-wire';\n";

if (!t.includes(anchor)) {
  console.error('ops import anchor not found');
  process.exit(1);
}
t = t.replace(anchor, insert);

const start = t.indexOf("  @Post('webhooks/orders')");
const marker = "await writeAudit('ORDER_WEBHOOK', 'Order', order.id, { topic, externalId });";
const markerIdx = t.indexOf(marker, start);
if (start < 0 || markerIdx < 0) {
  console.error('webhook block not found');
  process.exit(1);
}
const end = t.indexOf('\n', markerIdx) + 1;

const replacement =
  "  @Post('webhooks/orders')\n" +
  '  async ordersWebhook(\n' +
  '    @Req() req: RawBodyRequest<any>,\n' +
  '    @Body() body: any,\n' +
  "    @Headers('x-shopify-hmac-sha256') hmac?: string,\n" +
  "    @Headers('x-shopify-topic') topic?: string,\n" +
  '  ) {\n' +
  '    const result = await handleOrdersWebhookPhase1({\n' +
  '      rawBody: req.rawBody,\n' +
  '      body,\n' +
  '      hmac,\n' +
  '      topic,\n' +
  '      mode: MODE,\n' +
  '      modeEnum: MODE_ENUM,\n' +
  '      prisma,\n' +
  '      writeAudit,\n' +
  '    });\n' +
  '    if (result.early) return result.payload;\n' +
  '    const order = result.order!;\n';

t = t.slice(0, start) + replacement + t.slice(end);

const schedMarker = '[ops] inventory scheduler ON every';
const sidx = t.indexOf(schedMarker);
if (sidx > 0 && !t.includes('tracking scheduler ON')) {
  const lineEnd = t.indexOf('\n', sidx);
  const close = t.indexOf('\n  }', lineEnd);
  if (close > 0) {
    const insertSched =
      '\n  }\n\n' +
      '  const trackingMin = Number(process.env.ECOM_TRACKING_INTERVAL_MINUTES || 30);\n' +
      '  if (trackingMin > 0) {\n' +
      '    setInterval(() => {\n' +
      '      runTrackingPollAll({ prisma, writeAudit }).catch((e) =>\n' +
      "        console.warn('[ops] tracking poll failed', e?.message),\n" +
      '      );\n' +
      '    }, trackingMin * 60_000);\n' +
      "    console.log('[ops] tracking scheduler ON every ' + trackingMin + ' min');\n";
    t = t.slice(0, close + 4) + insertSched + t.slice(close + 4);
  }
}

const oldInv =
  "  @Post('inventory/sync-all')\n" +
  '  async syncAllInventory() {\n' +
  '    return runInventorySyncAll();\n' +
  '  }\n';

const newInv =
  oldInv +
  '\n' +
  "  @Post('tracking/poll')\n" +
  '  async trackingPoll() {\n' +
  '    return runTrackingPollAll({ prisma, writeAudit });\n' +
  '  }\n\n' +
  "  @Get('p0/verify')\n" +
  '  p0Verify() {\n' +
  '    return phase1VerifyEndpoints();\n' +
  '  }\n';

if (!t.includes("@Post('tracking/poll')")) {
  if (!t.includes(oldInv)) {
    console.error('inventory endpoint not found');
    process.exit(1);
  }
  t = t.replace(oldInv, newInv);
}

const oldP =
  '  const product = await prisma.product.create({\n' +
  '    data: {\n' +
  '      storeId,\n' +
  '      title: c.title,\n' +
  "      status: 'DETECTED',\n" +
  '      opportunityScore: c.opportunityScore,\n' +
  '      confidence: c.confidence,\n' +
  '      salePrice: c.salePrice,\n' +
  '      currency: c.currency,\n' +
  "      sourceMode: 'MOCK',\n" +
  '      isFirstPublication: true,\n' +
  '      marginPercent: margin.marginPercent,\n' +
  '      suppliers: {\n';

const newP =
  '  const dedupeKey = buildProductDedupeKey({\n' +
  '    cjVariantId: c.cjVariantId,\n' +
  '    cjSku: c.cjSku,\n' +
  '    title: c.title,\n' +
  '  });\n' +
  '  let product;\n' +
  '  try {\n' +
  '  product = await prisma.product.create({\n' +
  '    data: {\n' +
  '      storeId,\n' +
  '      title: c.title,\n' +
  "      status: 'DETECTED',\n" +
  '      opportunityScore: c.opportunityScore,\n' +
  '      confidence: c.confidence,\n' +
  '      salePrice: c.salePrice,\n' +
  '      currency: c.currency,\n' +
  "      sourceMode: 'MOCK',\n" +
  '      isFirstPublication: true,\n' +
  '      marginPercent: margin.marginPercent,\n' +
  '      dedupeKey,\n' +
  '      suppliers: {\n';

if (!t.includes('buildProductDedupeKey({')) {
  if (!t.includes(oldP)) {
    console.warn('product create block not found — skip dedupeKey');
  } else {
    t = t.replace(oldP, newP);
    const needle =
      "  await writeAudit('PRODUCT_DISCOVERED', 'Product', product.id, {\n" +
      '    source: c.source,\n' +
      '    signals: c.signals,\n' +
      '  });\n';
    const idx = t.indexOf(needle);
    if (idx > 0) {
      t =
        t.slice(0, idx) +
        '  } catch (e: any) {\n' +
        "    if (e?.code === 'P2002') {\n" +
        '      const hit = await prisma.product.findFirst({ where: { storeId, dedupeKey } });\n' +
        "      if (hit) return { productId: hit.id, created: false, pipeline: null as any, skipped: true, reason: 'dedupe_key' };\n" +
        '    }\n' +
        '    throw e;\n' +
        '  }\n\n' +
        t.slice(idx);
    }
  }
}

fs.writeFileSync(path, t);
console.log('Wired phase-1 into', path);
