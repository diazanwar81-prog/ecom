#!/usr/bin/env python3
"""Prevent published products from re-entering discovery/approval queues."""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "already_published_or_linked" in t and "normTitleKey" in t:
    print("already patched")
    raise SystemExit(0)

# --- Stronger ingestCandidate dedupe ---
old = '''async function ingestCandidate(storeId: string, c: DiscoveredCandidate, runPipeline: boolean) {
  // Dedupe by cjSku or exact title
  if (c.cjSku) {
    const bySku = await prisma.product.findFirst({
      where: { storeId, suppliers: { some: { cjSku: c.cjSku } } },
    });
    if (bySku) {
      return { productId: bySku.id, created: false, pipeline: null as any, skipped: true };
    }
  }
  const existing = await prisma.product.findFirst({
    where: { storeId, title: c.title },
  });
  if (existing) {
    return { productId: existing.id, created: false, pipeline: null as any, skipped: true };
  }'''

new = '''function normTitleKey(title: string) {
  return String(title || '')
    .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function ingestCandidate(storeId: string, c: DiscoveredCandidate, runPipeline: boolean) {
  // Never recreate if SKU / variant already linked (any status, incl. PUBLISHED)
  if (c.cjSku) {
    const bySku = await prisma.product.findFirst({
      where: { storeId, suppliers: { some: { cjSku: c.cjSku } } },
    });
    if (bySku) {
      return { productId: bySku.id, created: false, pipeline: null as any, skipped: true, reason: 'sku_exists' };
    }
  }
  if (c.cjVariantId) {
    const byVid = await prisma.product.findFirst({
      where: { storeId, suppliers: { some: { cjVariantId: c.cjVariantId } } },
    });
    if (byVid) {
      return { productId: byVid.id, created: false, pipeline: null as any, skipped: true, reason: 'vid_exists' };
    }
  }
  const existingExact = await prisma.product.findFirst({
    where: { storeId, title: c.title },
  });
  if (existingExact) {
    return { productId: existingExact.id, created: false, pipeline: null as any, skipped: true, reason: 'title_exact' };
  }
  // Fuzzy: same normalized title (covers cleaned publish titles vs discovery titles)
  const key = normTitleKey(c.title);
  if (key) {
    const recent = await prisma.product.findMany({
      where: { storeId },
      select: { id: true, title: true, status: true, externalId: true },
      orderBy: { createdAt: 'desc' },
      take: 400,
    });
    const hit = recent.find((p) => normTitleKey(p.title) === key);
    if (hit) {
      return { productId: hit.id, created: false, pipeline: null as any, skipped: true, reason: 'title_norm' };
    }
  }'''

if old in t:
    t = t.replace(old, new, 1)
    print("ingestCandidate dedupe strengthened")
else:
    print("WARN: ingestCandidate block not found")

# --- request-approval guards ---
old_req = '''  @Post(':id/request-approval')
  async requestApproval(@Param('id') id: string, @Body() body: { action: string; reason?: string }) {'''

# Need full method - read pattern after
m = re.search(
    r"@Post\(':id/request-approval'\)\s*async requestApproval\([\s\S]*?return \{ mode: MODE, approval[^}]*\};",
    t,
)
if m and "already_published_or_linked" not in m.group(0):
    body = m.group(0)
    # inject after finding product
    inject = '''  @Post(':id/request-approval')
  async requestApproval(@Param('id') id: string, @Body() body: { action: string; reason?: string }) {
    const p = await prisma.product.findUnique({ where: { id } });
    if (!p) return { error: 'not_found' };
    // Do not re-queue published / already live products
    if (p.status === 'PUBLISHED' || p.externalId || p.isFirstPublication === false) {
      return {
        error: 'already_published_or_linked',
        reason: 'Producto ya publicado o vinculado a Shopify; no requiere nueva aprobación',
        productId: id,
        status: p.status,
        externalId: p.externalId,
      };
    }
    const pending = await prisma.approval.findFirst({
      where: { productId: id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      return { mode: MODE, approval: pending, duplicate: true, note: 'Ya hay solicitud PENDING' };
    }'''
    # Replace start of method until we would duplicate findUnique - careful
    # Simpler: replace just the opening + first lines of method
    old_start = re.search(
        r"@Post\(':id/request-approval'\)\s*async requestApproval\(@Param\('id'\) id: string, @Body\(\) body: \{ action: string; reason\?: string \}\) \{\s*const p = await prisma\.product\.findUnique\(\{ where: \{ id \} \}\);\s*if \(!p\) return \{ error: 'not_found' \};",
        t,
    )
    if old_start:
        t = t[: old_start.start()] + inject + t[old_start.end() :]
        print("request-approval guards added")
    else:
        print("WARN: request-approval start pattern mismatch")
elif "already_published_or_linked" in t:
    print("request-approval already guarded")
else:
    print("WARN: request-approval method not found")

# --- go-live: refuse if already published with externalId (optional soft) ---
if "already_live" not in t:
    for sig in [
        "async goLive(@Param('id') id: string, @Body() body: { note?: string }) {",
    ]:
        if sig in t:
            t = t.replace(
                sig,
                sig
                + "\n"
                + "    const liveCheck = await prisma.product.findUnique({ where: { id } });\n"
                + "    if (liveCheck?.status === 'PUBLISHED' && liveCheck.externalId && !String(liveCheck.externalId).startsWith('mock')) {\n"
                + "      return { error: 'already_live', externalId: liveCheck.externalId, note: 'Ya publicado en Shopify' };\n"
                + "    }",
                1,
            )
            print("go-live already_live guard")
            break

MAIN.write_text(t)
print("done")
