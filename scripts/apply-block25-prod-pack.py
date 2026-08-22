#!/usr/bin/env python3
"""Block 25 production pack: kill-switch, dedupe, auto-tracking, publish alerts."""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "ECOM_KILL_SWITCH" in t and "AUTO_TRACKING_SYNC" in t and "isKillSwitchOn" in t:
    t = re.sub(r"block:\s*\d+", "block: 25", t, count=1)
    t = re.sub(
        r"void alertOps\('BOOT', \{ service: 'ecom-api', block: \d+ \}\)",
        "void alertOps('BOOT', { service: 'ecom-api', block: 25 })",
        t,
    )
    MAIN.write_text(t)
    print("Already patched block 25")
    raise SystemExit(0)

# 1) Kill switch helper
if "function isKillSwitchOn" not in t:
    helper = (
        "\nfunction isKillSwitchOn() {\n"
        "  return String(process.env.ECOM_KILL_SWITCH || '').toLowerCase() === 'true';\n"
        "}\n\n"
    )
    if "async function maybeAlertStock" in t:
        t = t.replace("async function maybeAlertStock", helper + "async function maybeAlertStock", 1)
    elif "from '../../../packages/notify/src/index';" in t:
        t = t.replace(
            "from '../../../packages/notify/src/index';",
            "from '../../../packages/notify/src/index';\n" + helper,
            1,
        )
    else:
        t = helper + t
    print("added kill switch helper")

# 2) Stronger dedupe
old_dedupe = (
    "  const existing = await prisma.product.findFirst({\n"
    "    where: { storeId, title: c.title },\n"
    "  });\n"
    "  if (existing) {\n"
    "    return { productId: existing.id, created: false, pipeline: null as any, skipped: true };\n"
    "  }"
)

new_dedupe = (
    "  // Dedupe by cjSku or exact title\n"
    "  if (c.cjSku) {\n"
    "    const bySku = await prisma.product.findFirst({\n"
    "      where: { storeId, suppliers: { some: { cjSku: c.cjSku } } },\n"
    "    });\n"
    "    if (bySku) {\n"
    "      return { productId: bySku.id, created: false, pipeline: null as any, skipped: true };\n"
    "    }\n"
    "  }\n"
    "  const existing = await prisma.product.findFirst({\n"
    "    where: { storeId, title: c.title },\n"
    "  });\n"
    "  if (existing) {\n"
    "    return { productId: existing.id, created: false, pipeline: null as any, skipped: true };\n"
    "  }"
)

if old_dedupe in t and "bySku" not in t:
    t = t.replace(old_dedupe, new_dedupe, 1)
    print("patched stronger dedupe")
else:
    print("WARN: dedupe pattern missing or already patched")

# 3) Auto tracking after FULFILL_OK
if "AUTO_TRACKING_SYNC" not in t:
    marker = (
        "    void alertOps('FULFILL_OK', {\n"
        "      orderId: id,\n"
        "      orderNumber: order.orderNumber,\n"
        "      supplierOrderId: result.supplierOrderId || '',\n"
        "      mock: result.mock,\n"
        "    });"
    )
    track = (
        "\n    // AUTO_TRACKING_SYNC\n"
        "    try {\n"
        "      const shopifyOrderId = String(updated.externalId || '');\n"
        "      if (/^\\d+$/.test(shopifyOrderId) && result.trackingNumber && result.trackingNumber !== 'n/a') {\n"
        "        const tr = await createOrderFulfillment({\n"
        "          orderId: shopifyOrderId,\n"
        "          trackingNumber: result.trackingNumber,\n"
        "          trackingCompany: result.carrier || 'CJPacket Ordinary',\n"
        "          notifyCustomer: false,\n"
        "        });\n"
        "        await writeAudit('AUTO_TRACKING_SYNC', 'Order', id, tr);\n"
        "      }\n"
        "    } catch (e: any) {\n"
        "      console.warn('auto tracking sync failed', e?.message);\n"
        "    }\n"
    )
    if marker in t:
        t = t.replace(marker, marker + track, 1)
        print("patched auto tracking")
    else:
        print("WARN: FULFILL_OK marker not found")

# 4) Kill switch on fulfill
if "async fulfill(@Param('id') id: string)" in t and t.count("isKillSwitchOn()") < 1:
    t = t.replace(
        "async fulfill(@Param('id') id: string) {\n    const order = await prisma.order.findUnique({ where: { id } });",
        "async fulfill(@Param('id') id: string) {\n"
        "    if (isKillSwitchOn()) return { error: 'kill_switch', reason: 'ECOM_KILL_SWITCH=true' };\n"
        "    const order = await prisma.order.findUnique({ where: { id } });",
        1,
    )
    print("kill switch on fulfill")

# go-live kill switch
for sig in [
    "async goLive(@Param('id') id: string, @Body() body: { note?: string }) {",
    "async goLive(\n    @Param('id') id: string,\n    @Body() body: { note?: string },\n  ) {",
]:
    if sig in t and "kill_switch" not in t[t.find(sig) : t.find(sig) + 350]:
        t = t.replace(
            sig,
            sig + "\n    if (isKillSwitchOn()) return { error: 'kill_switch', reason: 'ECOM_KILL_SWITCH=true' };",
            1,
        )
        print("kill switch on go-live")
        break

# 5) GO_LIVE alert
if "alertOps('GO_LIVE'" not in t and "PRODUCT_GO_LIVE" in t:
    t = t.replace(
        "await writeAudit('PRODUCT_GO_LIVE'",
        "void alertOps('GO_LIVE', { productId: id, title: String((enriched as any)?.title || '').slice(0, 80) });\n    await writeAudit('PRODUCT_GO_LIVE'",
        1,
    )
    print("GO_LIVE alert")

if "alertOps('PUBLISH_FAILED'" not in t and "GO_LIVE_FAILED" in t:
    t = t.replace(
        "await writeAudit('GO_LIVE_FAILED'",
        "void alertOps('PUBLISH_FAILED', { productId: id, error: 'go_live_failed' });\n      await writeAudit('GO_LIVE_FAILED'",
        1,
    )
    print("PUBLISH_FAILED alert")

t = re.sub(r"block:\s*\d+", "block: 25", t, count=1)
t = re.sub(
    r"void alertOps\('BOOT', \{ service: 'ecom-api', block: \d+ \}\)",
    "void alertOps('BOOT', { service: 'ecom-api', block: 25 })",
    t,
)

MAIN.write_text(t)
print("Done block 25")
print("  kill:", "isKillSwitchOn" in t)
print("  bySku:", "bySku" in t)
print("  tracking:", "AUTO_TRACKING_SYNC" in t)
print("  GO_LIVE:", "alertOps('GO_LIVE'" in t)
print("  block25:", "block: 25" in t)
