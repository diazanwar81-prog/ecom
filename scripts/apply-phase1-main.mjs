#!/usr/bin/env node
/**
 * Applies phase-1 call sites to apps/api/src/main.ts if not already wired.
 * Run: docker compose run --rm workspace node scripts/apply-phase1-main.mjs
 */
import fs from 'fs';

const path = 'apps/api/src/main.ts';
let t = fs.readFileSync(path, 'utf8');

if (t.includes('phase1-runtime-wire')) {
  console.log('Already wired');
  process.exit(0);
}

const anchor = "from '../../../packages/ops/src/index';";
const insert = `from '../../../packages/ops/src/index';
import {
  handleOrdersWebhookPhase1,
  runTrackingPollAll,
  enhanceInventorySyncLoop,
  buildProductDedupeKey,
  phase1VerifyEndpoints,
} from './phase1-runtime-wire';
`;

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

const replacement = `  @Post('webhooks/orders')
  async ordersWebhook(
    @Req() req: RawBodyRequest<any>,
    @Body() body: any,
    @Headers('x-shopify-hmac-sha256') hmac?: string,
    @Headers('x-shopify-topic') topic?: string,
  ) {
    const result = await handleOrdersWebhookPhase1({
      rawBody: req.rawBody,
      body,
      hmac,
      topic,
      mode: MODE,
      modeEnum: MODE_ENUM,
      prisma,
      writeAudit,
    });
    if (result.early) return result.payload;
    const order = result.order!;
`;
t = t.slice(0, start) + replacement + t.slice(end);

const schedMarker = '[ops] inventory scheduler ON every';
const sidx = t.indexOf(schedMarker);
if (sidx > 0 && !t.includes('tracking scheduler ON')) {
  const lineEnd = t.indexOf('\n', sidx);
  const close = t.indexOf('\n  }', lineEnd);
  if (close > 0) {
    const insertSched = `
  }

  const trackingMin = Number(process.env.ECOM_TRACKING_INTERVAL_MINUTES || 30);
  if (trackingMin > 0) {
    setInterval(() => {
      runTrackingPollAll({ prisma, writeAudit }).catch((e) =>
        console.warn('[ops] tracking poll failed', e?.message),
      );
    }, trackingMin * 60_000);
    console.log('[ops] tracking scheduler ON every ' + trackingMin + ' min');
`;
    t = t.slice(0, close + 4) + insertSched + t.slice(close + 4);
  }
}

const oldInv = `  @Post('inventory/sync-all')
  async syncAllInventory() {
    return runInventorySyncAll();
  }
`;
const newInv =
  oldInv +
  `
  @Post('tracking/poll')
  async trackingPoll() {
    return runTrackingPollAll({ prisma, writeAudit });
  }

  @Get('p0/verify')
  p0Verify() {
    return phase1VerifyEndpoints();
  }
`;
if (!t.includes("@Post('tracking/poll')")) {
  if (!t.includes(oldInv)) {
    console.error('inventory endpoint not found');
    process.exit(1);
  }
  t = t.replace(oldInv, newInv);
}

const oldP = `  const product = await prisma.product.create({
    data: {
      storeId,
      title: c.title,
      status: 'DETECTED',
      opportunityScore: c.opportunityScore,
      confidence: c.confidence,
      salePrice: c.salePrice,
      currency: c.currency,
      sourceMode: 'MOCK',
      isFirstPublication: true,
      marginPercent: margin.marginPercent,
      suppliers: {
`;
const newP = `  const dedupeKey = buildProductDedupeKey({
    cjVariantId: c.cjVariantId,
    cjSku: c.cjSku,
    title: c.title,
  });
  let product;
  try {
  product = await prisma.product.create({
    data: {
      storeId,
      title: c.title,
      status: 'DETECTED',
      opportunityScore: c.opportunityScore,
      confidence: c.confidence,
      salePrice: c.salePrice,
      currency: c.currency,
      sourceMode: 'MOCK',
      isFirstPublication: true,
      marginPercent: margin.marginPercent,
      dedupeKey,
      suppliers: {
`;
if (!t.includes('buildProductDedupeKey({')) {
  if (!t.includes(oldP)) {
    console.warn('product create block not found — skip dedupeKey');
  } else {
    t = t.replace(oldP, newP);
    const needle = `  await writeAudit('PRODUCT_DISCOVERED', 'Product', product.id, {
    source: c.source,
    signals: c.signals,
  });
`;
    const idx = t.indexOf(needle);
    if (idx > 0) {
      t =
        t.slice(0, idx) +
        `  } catch (e: any) {
    if (e?.code === 'P2002') {
      const hit = await prisma.product.findFirst({ where: { storeId, dedupeKey } });
      if (hit) return { productId: hit.id, created: false, pipeline: null as any, skipped: true, reason: 'dedupe_key' };
    }
    throw e;
  }

` +
        t.slice(idx);
    }
  }
}

fs.writeFileSync(path, t);
console.log('Wired phase-1 into', path);
