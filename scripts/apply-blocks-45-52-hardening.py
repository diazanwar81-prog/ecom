#!/usr/bin/env python3
"""Wire blocks 45-52 HardeningController into apps/api/src/main.ts"""
from pathlib import Path
import re

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

if "class HardeningController" in t and "packages/hardening" in t:
    print("already 45-52")
    raise SystemExit(0)

# Import
if "packages/hardening/src/index" not in t:
    imp = """import {
  HARDENING_META,
  verifyHardening,
  planTitleSync,
  parseFulfillmentNote,
  scoreTrackingQuality,
  telegramConfigured,
  getBudgetLimits,
  budgetGate,
  getKillSwitch,
  assertNotKilled,
  buildOpsBoard,
  realModeGate,
  runLocalSmokeUnits,
  needsShopifyTitleSync,
} from '../../../packages/hardening/src/index';
import { alertOps, getNotifyStatus, sendTelegram } from '../../../packages/notify/src/index';
"""
    for pkg in [
        "packages/catalog-quality/src/index",
        "packages/real-close/src/index",
        "packages/ops/src/index",
    ]:
        needle = f"}} from '../../../{pkg}';"
        if needle in t:
            t = t.replace(needle, needle + "\n" + imp.rstrip() + "\n", 1)
            print("hardening import after", pkg)
            break
    else:
        t = imp + t
        print("hardening import at top")

# Bump block number in health-like places (best effort)
t = t.replace("block: 44", "block: 52")
t = t.replace("block-44", "block-52")

CTRL = r'''
@Controller('hardening')
class HardeningController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...HARDENING_META };
  }

  @Get('verify')
  async verify() {
    const mode = process.env.ECOM_MODE || 'MOCK';
    const products = await prisma.product.findMany({
      take: 300,
      include: { suppliers: true },
    });
    const orders = await prisma.order.findMany({ take: 300 });
    const published = products.filter((p) => p.status === 'PUBLISHED');
    const pending = products.filter((p) => p.status === 'PENDING_APPROVAL');
    const paused = products.filter((p) => p.status === 'PAUSED');
    const publishedWithExternal = published.filter(
      (p) => p.externalId && !String(p.externalId).startsWith('mock-'),
    ).length;
    const orphanPublished = published.filter(
      (p) => !(p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    const paid = orders.filter((o) => o.status === 'PAID').length;
    const fulfilled = orders.filter((o) => o.status === 'FULFILLED').length;
    const notes = orders.map((o) => o.fulfillmentNote);
    const apiUrl = process.env.API_URL || process.env.APP_URL || '';
    const httpsPublic = /^https:\/\//i.test(apiUrl);

    const summary = verifyHardening({
      publishedWithExternal,
      trackingNotes: notes,
      telegram: telegramConfigured(),
      httpsPublic,
      pendingApproval: pending.length,
      published: published.length,
      paid,
      fulfilled,
      paused: paused.length,
      orphanPublished,
      mode,
    });

    return {
      mode,
      block: 52,
      ...summary,
      nextActions: summary.ok
        ? [
            'Opcional: POST /hardening/title-sync {"dryRun":true}',
            'Opcional: POST /hardening/telegram-test',
            'REAL solo si GET /hardening/real-gate canEnterReal=true + ECOM_REAL_CONFIRM',
          ]
        : summary.items.filter((i) => !i.ok).map((i) => i.message),
    };
  }

  @Get('kill-switch')
  killSwitch() {
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 49, ...getKillSwitch() };
  }

  @Get('budget')
  budget() {
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 48, limits: getBudgetLimits() };
  }

  @Post('budget-check')
  budgetCheck(@Body() body: { kind?: 'create' | 'publish' | 'fulfill' | 'ai'; usedToday?: number }) {
    const kind = body?.kind || 'publish';
    const used = Number(body?.usedToday || 0);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 48,
      kind,
      ...budgetGate(kind, used),
    };
  }

  @Get('ops-board')
  async opsBoard() {
    const mode = process.env.ECOM_MODE || 'MOCK';
    const products = await prisma.product.findMany({ take: 300, include: { suppliers: true } });
    const orders = await prisma.order.findMany({ take: 300 });
    const published = products.filter((p) => p.status === 'PUBLISHED');
    const board = buildOpsBoard({
      mode,
      published: published.length,
      pendingApproval: products.filter((p) => p.status === 'PENDING_APPROVAL').length,
      paid: orders.filter((o) => o.status === 'PAID').length,
      fulfilled: orders.filter((o) => o.status === 'FULFILLED').length,
      paused: products.filter((p) => p.status === 'PAUSED').length,
      orphanPublished: published.filter(
        (p) => !(p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
      ).length,
      killSwitch: getKillSwitch().active,
      telegramConfigured: telegramConfigured().configured,
      httpsPublic: /^https:\/\//i.test(process.env.API_URL || process.env.APP_URL || ''),
    });
    return { mode, block: 50, ...board };
  }

  @Get('real-gate')
  realGate() {
    const gate = realModeGate();
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 52,
      ...gate,
      instruction:
        'Para entrar a REAL: completar criticals, set ECOM_REAL_CONFIRM=I_UNDERSTAND_REAL_MODE, luego ECOM_MODE=REAL y recreate. Kill switch debe estar OFF.',
    };
  }

  @Get('smoke')
  async smoke() {
    const local = runLocalSmokeUnits();
    const healthOk = true;
    const items = [
      {
        id: 'health',
        block: 51,
        ok: healthOk,
        severity: 'critical' as const,
        message: 'API process alive',
      },
      ...local,
    ];
    // light DB ping
    try {
      await prisma.product.count({ take: 1 });
      items.push({
        id: 'db',
        block: 51,
        ok: true,
        severity: 'critical',
        message: 'Prisma product count OK',
      });
    } catch (e: any) {
      items.push({
        id: 'db',
        block: 51,
        ok: false,
        severity: 'critical',
        message: e?.message || 'db error',
      });
    }
    const criticalFailed = items.filter((i) => i.severity === 'critical' && !i.ok).length;
    const passed = items.filter((i) => i.ok).length;
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 51,
      ok: criticalFailed === 0,
      criticalFailed,
      score: Math.round((passed / items.length) * 100),
      items,
    };
  }

  @Post('parse-tracking')
  parseTracking(@Body() body: { note?: string }) {
    const parsed = parseFulfillmentNote(body?.note || '');
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 46, parsed };
  }

  @Post('telegram-test')
  async telegramTest(@Body() body: { text?: string }) {
    const status = getNotifyStatus();
    if (!status.configured) {
      return {
        mode: process.env.ECOM_MODE || 'MOCK',
        block: 47,
        ok: false,
        status,
        error: 'Configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en .env',
      };
    }
    const text =
      body?.text ||
      `ECOM test · hardening bloque 47 · modo ${process.env.ECOM_MODE || 'MOCK'} · ${new Date().toISOString()}`;
    const result = await sendTelegram(text);
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 47, status, result };
  }

  @Post('title-sync')
  async titleSync(@Body() body: { dryRun?: boolean; limit?: number }) {
    const killed = assertNotKilled('title-sync');
    if (!killed.ok) return { error: 'kill_switch', message: killed.error };

    const dryRun = body?.dryRun !== false;
    const limit = Math.min(Number(body?.limit || 20), 50);
    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });
    const plan = planTitleSync(products as any);
    const results: any[] = [];

    for (const item of plan) {
      if (dryRun) {
        results.push({ ...item, action: 'dry-run', ok: true });
        continue;
      }
      // Live Shopify title update (Admin API)
      const shop = (process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '').replace(/\r/g, '').trim();
      const token = (process.env.SHOPIFY_ACCESS_TOKEN || '').replace(/\r/g, '').trim();
      const host = shop.includes('.') ? shop : `${shop}.myshopify.com`;
      const apiVersion = process.env.SHOPIFY_API_VERSION || '2026-07';
      if (!shop || !token) {
        results.push({ ...item, ok: false, error: 'missing_shopify_creds' });
        continue;
      }
      try {
        const res = await fetch(
          `https://${host}/admin/api/${apiVersion}/products/${item.externalId}.json`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': token,
            },
            body: JSON.stringify({ product: { id: Number(item.externalId), title: item.localTitle } }),
          },
        );
        const data = await res.json().catch(() => ({}));
        const ok = res.ok;
        results.push({ ...item, ok, action: 'updated', status: res.status, error: ok ? undefined : JSON.stringify(data?.errors || data) });
        if (ok) {
          await writeAudit('SHOPIFY_TITLE_SYNC', 'Product', item.productId, {
            externalId: item.externalId,
            title: item.localTitle,
          });
        }
      } catch (e: any) {
        results.push({ ...item, ok: false, error: e?.message || String(e) });
      }
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 45,
      dryRun,
      planned: plan.length,
      updated: results.filter((r) => r.ok && r.action === 'updated').length,
      results: results.slice(0, 30),
    };
  }

  @Get('tracking-scan')
  async trackingScan() {
    const orders = await prisma.order.findMany({
      where: { status: 'FULFILLED' },
      take: 100,
      orderBy: { updatedAt: 'desc' },
    });
    const items = orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      note: o.fulfillmentNote,
      parsed: parseFulfillmentNote(o.fulfillmentNote),
    }));
    const quality = scoreTrackingQuality(orders.map((o) => o.fulfillmentNote));
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 46, quality, items: items.slice(0, 40) };
  }
}
'''

if "class HardeningController" not in t:
    m = re.search(r"@Module\(\{\s*controllers:", t)
    if m:
        t = t[: m.start()] + CTRL + "\n" + t[m.start() :]
        print("HardeningController inserted")
    else:
        t = t + "\n" + CTRL
        print("HardeningController appended")

section = t.split("controllers:")[1][:900] if "controllers:" in t else ""
if "HardeningController" not in section:
    t = re.sub(r"(controllers:\s*\[)", r"\1HardeningController, ", t, count=1)
    print("registered HardeningController")

MAIN.write_text(t)
print("done 45-52")
print("lines", len(t.splitlines()))
