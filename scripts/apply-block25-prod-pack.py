#!/usr/bin/env python3
"""Block 25 — production pack (amplio):
- Kill-switch ECOM_KILL_SWITCH
- Dedupe discovery por cjSku + título normalizado
- Auto sync-tracking a Shopify tras fulfill OK
- Alertas GO_LIVE / PUBLISH_FAILED
"""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "ECOM_KILL_SWITCH" in t and "AUTO_TRACKING_SYNC" in t:
    t = re.sub(r"block:\s*\d+", "block: 25", t, count=1)
    t = t.replace("block: 24 });", "block: 25 });")
    MAIN.write_text(t)
    print("Already patched block 25 features")
    raise SystemExit(0)

# --- 1) Kill switch helper ---
if "function isKillSwitchOn" not in t:
    helper = '''
function isKillSwitchOn() {
  return String(process.env.ECOM_KILL_SWITCH || '').toLowerCase() === 'true';
}

'''
    if "async function maybeAlertStock" in t:
        t = t.replace("async function maybeAlertStock", helper + "async function maybeAlertStock", 1)
    else:
        t = helper + t
    print("added kill switch helper")

# --- 2) Stronger dedupe in ingestCandidate ---
old_dedupe = '''  const existing = await prisma.product.findFirst({
    where: { storeId, title: c.title },
  });
  if (existing) {
    return { productId: existing.id, created: false, pipeline: null as any, skipped: true };
  }'''

new_dedupe = '''  // Dedupe: same cjSku OR same normalized title in store
  if (c.cjSku) {
    const bySku = await prisma.product.findFirst({
      where: { storeId, suppliers: { some: { cjSku: c.cjSku } } },
    });
    if (bySku) {
      return { productId: bySku.id, created: false, pipeline: null as any, skipped: true };
    }
  }
  const normTitle = String(c.title || '')
    .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
    .toLowerCase()
    .trim();
  const existing = await prisma.product.findFirst({
    where: { storeId, title: c.title },
  });
  if (existing) {
    return { productId: existing.id, created: false, pipeline: null as any, skipped: true };
  }
  if (normTitle) {
    const all = await prisma.product.findMany({ where: { storeId }, select: { id: true, title: true }, take: 200 });
    const hit = all.find((p) =>
      String(p.title || '')
        .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
        .toLowerCase()
        .trim() === normTitle,
    );
    if (hit) {
      return { productId: hit.id, created: false, pipeline: null as any, skipped: true };
    }
  }'''

if old_dedupe in t and "bySku" not in t:
    t = t.replace(old_dedupe, new_dedupe, 1)
    print("patched stronger dedupe")
else:
    print("WARN: dedupe pattern missing or already patched")

# --- 3) Auto tracking after manual fulfill OK ---
TRACK_SNIPPET = '''
    // AUTO_TRACKING_SYNC: push tracking to Shopify when externalId is numeric order id
    try {
      const shopifyOrderId = String(updated.externalId || '');
      if (/^\\d+$/.test(shopifyOrderId) && result.trackingNumber && result.trackingNumber !== 'n/a') {
        const tr = await createOrderFulfillment({
          orderId: shopifyOrderId,
          trackingNumber: result.trackingNumber,
          trackingCompany: result.carrier || 'CJPacket Ordinary',
          notifyCustomer: false,
        });
        await writeAudit('AUTO_TRACKING_SYNC', 'Order', id, tr);
        if (!tr.ok) {
          void alertOps('FULFILL_FAILED', {
            orderId: id,
            orderNumber: order.orderNumber,
            error: 'shopify_tracking: ' + (tr.error || 'fail'),
          });
        }
      }
    } catch (e: any) {
      console.warn('auto tracking sync failed', e?.message);
    }
'''

if "AUTO_TRACKING_SYNC" not in t:
    marker = "    void alertOps('FULFILL_OK', {
      orderId: id,
      orderNumber: order.orderNumber,
      supplierOrderId: result.supplierOrderId || '',
      mock: result.mock,
    });"
    if marker in t:
        t = t.replace(marker, marker + TRACK_SNIPPET, 1)
        print("patched auto tracking after manual fulfill")
    else:
        print("WARN: FULFILL_OK marker not found for tracking")

# --- 4) Kill switch on go-live and fulfill ---
if "isKillSwitchOn()" not in t or t.count("isKillSwitchOn()") < 2:
    if "@Post(':id/fulfill')" in t and "if (isKillSwitchOn())" not in t.split("@Post(':id/fulfill')")[1][:400]:
        t = t.replace(
            "  async fulfill(@Param('id') id: string) {
    const order = await prisma.order.findUnique({ where: { id } });",
            "  async fulfill(@Param('id') id: string) {
    if (isKillSwitchOn()) return { error: 'kill_switch', reason: 'ECOM_KILL_SWITCH=true' };
    const order = await prisma.order.findUnique({ where: { id } });",
            1,
        )
        print("kill switch on fulfill")
    if "@Post(':id/go-live')" in t:
        t = t.replace(
            "@Post(':id/go-live')",
            "@Post(':id/go-live')",
            1,
        )
        # inject inside method start — find common pattern
        go = "  async goLive(
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {"
        go2 = "  async goLive(
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    if (isKillSwitchOn()) return { error: 'kill_switch', reason: 'ECOM_KILL_SWITCH=true' };"
        # try single-line variants
        for a, b in [
            ("async goLive(@Param('id') id: string, @Body() body: { note?: string }) {",
             "async goLive(@Param('id') id: string, @Body() body: { note?: string }) {
    if (isKillSwitchOn()) return { error: 'kill_switch', reason: 'ECOM_KILL_SWITCH=true' };"),
        ]:
            if a in t and "kill_switch" not in t[t.find(a):t.find(a)+300]:
                t = t.replace(a, b, 1)
                print("kill switch on go-live")
                break

# --- 5) Publish alerts on go-live success/fail ---
if "alertOps('GO_LIVE'" not in t:
    # success: after published true patterns are varied; hook writeAudit PRODUCT_PUBLISHED if exists
    if "await writeAudit('PRODUCT_PUBLISHED'" in t:
        t = t.replace(
            "await writeAudit('PRODUCT_PUBLISHED'",
            "void alertOps('GO_LIVE', { productId: id, title: (enriched?.title || '').toString().slice(0, 80) });\n    await writeAudit('PRODUCT_PUBLISHED'",
            1,
        )
        print("GO_LIVE alert on PRODUCT_PUBLISHED")
    elif "published: true" in t:
        # fallback near end of go-live return published:true
        t = t.replace(
            "note: 'Publicado tras aprobaci\u00f3n humana (go-live).",
            "note: 'Publicado tras aprobaci\u00f3n humana (go-live).",
            1,
        )

if "alertOps('PUBLISH_FAILED'" not in t:
    for pat in [
        "return { mode: MODE, error: 'publish_failed'",
        "return { mode: MODE, published: false",
        "error: 'publish_failed'",
    ]:
        if pat in t and "PUBLISH_FAILED" not in t:
            t = t.replace(
                pat,
                "void alertOps('PUBLISH_FAILED', { productId: id, error: 'publish_failed' });\n      " + pat,
                1,
            )
            print("PUBLISH_FAILED alert")
            break

# block number
t = re.sub(r"block:\s*\d+", "block: 25", t, count=1)
t = re.sub(r"void alertOps\('BOOT', \{ service: 'ecom-api', block: \d+ \}\)",
           "void alertOps('BOOT', { service: 'ecom-api', block: 25 })", t)

MAIN.write_text(t)
print("Done block 25")
print("  kill switch:", "isKillSwitchOn" in t)
print("  dedupe sku:", "bySku" in t)
print("  auto tracking:", "AUTO_TRACKING_SYNC" in t)
print("  GO_LIVE:", "alertOps('GO_LIVE'" in t)
