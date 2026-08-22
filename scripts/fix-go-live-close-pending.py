#!/usr/bin/env python3
"""On go-live success, mark ALL PENDING approvals for the product as APPROVED."""
from pathlib import Path

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "close all PENDING approvals" in t:
    print("already fixed")
    raise SystemExit(0)

# Insert after PRODUCT_GO_LIVE audit / before return published
marker = "    void alertOps('GO_LIVE', { productId: id, title: String((enriched as any)?.title || '').slice(0, 80) });"

snippet = (
    "    void alertOps('GO_LIVE', { productId: id, title: String((enriched as any)?.title || '').slice(0, 80) });\n"
    "    // close all PENDING approvals for this product so panel clears\n"
    "    try {\n"
    "      await prisma.approval.updateMany({\n"
    "        where: { productId: id, status: 'PENDING' },\n"
    "        data: { status: 'APPROVED', decidedAt: new Date() },\n"
    "      });\n"
    "    } catch (e: any) {\n"
    "      console.warn('close pending approvals failed', e?.message);\n"
    "    }\n"
)

if marker not in t:
    print("WARN: GO_LIVE marker not found")
else:
    t = t.replace(marker, snippet, 1)
    print("patched close PENDING on go-live")

# Also fix early path: if APPROVED already exists, still close remaining PENDING
old = (
    "    if (!approval) {\n"
    "      const pending = await prisma.approval.findFirst({\n"
    "        where: { productId: id, status: 'PENDING' },\n"
    "        orderBy: { createdAt: 'desc' },\n"
    "      });\n"
)
# Keep logic but add updateMany after the whole if (!approval) block is hard;
# the success-path updateMany is enough.

MAIN.write_text(t)
print("done")
