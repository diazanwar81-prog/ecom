#!/usr/bin/env python3
"""Wire block 66 auto-approve CJ into apps/api/src/main.ts"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/api/src/main.ts"
text = MAIN.read_text()

IMPORT = """import {
  isAutoApproveEnabled,
  decideAutoApprove,
  filterAutoApprovable,
  AUTO_APPROVE_META,
} from '../../../packages/approvals-auto/src/index';
"""

if "packages/approvals-auto/src/index" not in text:
    anchor = "from '../../../packages/media/src/index';"
    if anchor not in text:
        raise SystemExit("media import not found")
    idx = text.find(anchor) + len(anchor)
    text = text[:idx] + "\n\n" + IMPORT + text[idx:]

# Bump health block 65 -> 66
if "block: 66" not in text.split("class DiscoveryController")[0]:
    text = text.replace("block: 65,", "block: 66,", 1)

METHODS = r'''
  @Get('auto-cj/status')
  autoCjStatus() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...AUTO_APPROVE_META,
      enabled: isAutoApproveEnabled(),
      minConfidence: Number(process.env.ECOM_AUTO_APPROVE_MIN_CONFIDENCE || 80),
      minOpportunity: Number(process.env.ECOM_AUTO_APPROVE_MIN_OPP || 55),
      note: isAutoApproveEnabled()
        ? 'Auto-aprobación CJ ACTIVA (solo approve; publish sigue siendo go-live o publish)'
        : 'Pon ECOM_AUTO_APPROVE_CJ=true en .env y recreate para activar',
    };
  }

  /** Preview which PENDING products would auto-approve (dry-run) */
  @Get('auto-cj/preview')
  async autoCjPreview() {
    const rows = await prisma.product.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'EVALUATING', 'DETECTED', 'DRAFT'] } },
      take: 100,
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    });
    const candidates = rows.map((p) => {
      const e = enrichProduct(p);
      return {
        id: e.id,
        title: e.title,
        status: e.status,
        isFirstPublication: e.isFirstPublication,
        marginPercent: e.marginPercent,
        marginBand: e.marginBand,
        canPublish: e.canPublish,
        shouldPause: e.shouldPause,
        verified: e.verified,
        cjVariantId: e.cjVariantId,
        cjSku: e.cjSku,
        opportunityScore: e.opportunityScore,
        confidence: e.confidence,
      };
    });
    const filtered = filterAutoApprovable(candidates);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 66,
      enabled: isAutoApproveEnabled(),
      approveCount: filtered.approve.length,
      blockedCount: filtered.blocked.length,
      skippedCount: filtered.skipped.length,
      approve: filtered.approve.map((p) => ({
        id: p.id,
        title: p.title?.slice(0, 60),
        cjSku: p.cjSku,
        marginBand: p.marginBand,
      })),
      blocked: filtered.blocked.slice(0, 20),
    };
  }

  /** Apply auto-approval for CJ-linked products that pass gates */
  @Post('auto-cj/run')
  async autoCjRun(@Body() body: { dryRun?: boolean; limit?: number }) {
    const dryRun = body?.dryRun === true;
    if (!isAutoApproveEnabled() && !dryRun) {
      return {
        error: 'disabled',
        message: 'Activa ECOM_AUTO_APPROVE_CJ=true o usa dryRun:true',
        ...AUTO_APPROVE_META,
      };
    }
    const limit = Math.min(Number(body?.limit || 30), 50);
    const rows = await prisma.product.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'EVALUATING', 'DETECTED', 'DRAFT'] } },
      take: limit,
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    });
    const admin = await prisma.user.findFirst({ where: { email: 'admin@ecom.local' } });
    const approved: any[] = [];
    const blocked: any[] = [];

    for (const p of rows) {
      const e = enrichProduct(p);
      const decision = decideAutoApprove({
        id: e.id,
        title: e.title,
        status: e.status,
        isFirstPublication: e.isFirstPublication,
        marginPercent: e.marginPercent,
        marginBand: e.marginBand,
        canPublish: e.canPublish,
        shouldPause: e.shouldPause,
        verified: e.verified,
        cjVariantId: e.cjVariantId,
        cjSku: e.cjSku,
        opportunityScore: e.opportunityScore,
        confidence: e.confidence,
      });

      // dry-run still evaluates as if enabled
      if (!decision.ok && !(dryRun && decision.reasons[0]?.includes('ECOM_AUTO_APPROVE'))) {
        if (decision.action === 'BLOCK') blocked.push(decision);
        continue;
      }
      // If only blocked by flag, for dryRun re-check without flag
      if (!decision.ok && dryRun) {
        const hasCj = Boolean(e.cjVariantId || e.cjSku);
        if (
          !hasCj ||
          e.shouldPause ||
          !e.canPublish ||
          e.verified === false ||
          String(e.marginBand).toUpperCase() === 'PAUSE'
        ) {
          blocked.push(decision);
          continue;
        }
      }

      if (dryRun) {
        approved.push({ productId: e.id, title: e.title?.slice(0, 50), dryRun: true, cjSku: e.cjSku });
        continue;
      }

      let approval = await prisma.approval.findFirst({
        where: { productId: e.id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      if (approval) {
        approval = await prisma.approval.update({
          where: { id: approval.id },
          data: {
            status: 'APPROVED',
            decidedAt: new Date(),
            metadata: { via: 'auto-cj', block: 66 },
          },
        });
      } else {
        approval = await prisma.approval.create({
          data: {
            productId: e.id,
            requestedBy: admin?.id ?? 'system',
            action: 'FIRST_PUBLICATION',
            reason: 'Auto-aprobación CJ (bloque 66)',
            status: 'APPROVED',
            decidedAt: new Date(),
            metadata: { via: 'auto-cj', block: 66, requiresHuman: false },
          },
        });
      }
      await prisma.product.update({
        where: { id: e.id },
        data: { status: 'DRAFT' },
      });
      await writeAudit('AUTO_APPROVE_CJ', 'Product', e.id, {
        approvalId: approval.id,
        cjSku: e.cjSku,
        marginBand: e.marginBand,
      });
      approved.push({
        productId: e.id,
        approvalId: approval.id,
        title: e.title?.slice(0, 50),
        cjSku: e.cjSku,
        next: 'POST /products/:id/publish o /go-live',
      });
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 66,
      dryRun,
      enabled: isAutoApproveEnabled(),
      approved: approved.length,
      blocked: blocked.length,
      items: approved,
      blockedSample: blocked.slice(0, 10),
      note: dryRun
        ? 'Simulación — no se escribió en DB'
        : 'Aprobados como DRAFT. Publicar con go-live/publish (no auto-publish).',
    };
  }

'''

if "auto-cj/run" not in text:
    # Insert into ApprovalsController after class declaration first method area
    marker = "class ApprovalsController {"
    if marker not in text:
        raise SystemExit("ApprovalsController not found")
    # Prefer insert after @Get() list method - find "@Post(':id/decide')"
    decide = "  @Post(':id/decide')"
    if decide not in text:
        raise SystemExit("decide route not found")
    text = text.replace(decide, METHODS + decide, 1)

text = re.sub(
    r"void alertOps\('BOOT', \{ service: 'ecom-api', block: \d+ \}\);",
    "void alertOps('BOOT', { service: 'ecom-api', block: 66 });",
    text,
    count=1,
)
text = re.sub(
    r'ECOM API block-\d+[^"]*',
    'ECOM API block-66 (auto-approve CJ)',
    text,
    count=1,
)
# Keep console.log template intact - only replace block number inside if present
text = text.replace(
    "ECOM API block-65 (media 62-65)",
    "ECOM API block-66 (auto-approve CJ)",
)

MAIN.write_text(text)
out = MAIN.read_text()
print("Patched", MAIN)
print("  import:", "approvals-auto" in out)
print("  auto-cj:", "auto-cj/run" in out)
print("  health 66:", "block: 66" in out.split("class DiscoveryController")[0])
