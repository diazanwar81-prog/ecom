import 'reflect-metadata';
import { Controller, Get, Module, Injectable, Post, Body, Param, Query, Headers } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  calculateMargin,
  decideStock,
  canAutoPublish,
  requiresHumanApproval,
  RULES,
  type CostBreakdown,
} from '../../../packages/rules/src/index';
import {
  complete as aiComplete,
  generateProductCopy,
  getRouterStatus,
} from '../../../packages/ai-router/src/index';
import {
  getShopifyStatus,
  publishProduct,
  createMockOrder,
  createOrderFulfillment,
  setInventoryLevel,
  getPrimaryLocationId,
} from '../../../packages/shopify/src/index';
import { getCjStatus, fulfillOrder, searchCjProducts } from '../../../packages/cj/src/index';
import {
  runProductPipeline,
  getOrchestratorMeta,
  type CandidateInput,
  type PipelineResult,
} from '../../../packages/orchestrator/src/index';
import {
  discoverCandidates,
  candidatePassesHardFilters,
  getDiscoveryStatus,
  type DiscoveredCandidate,
} from '../../../packages/discovery/src/index';
import { prisma, ProductStatus, ApprovalStatus, RuntimeMode } from '../../../packages/database/src/index';
import {
  enqueueDiscovery,
  enqueuePipeline,
  listRecentJobs,
  getQueueStatus,
  startWorkers,
  startDiscoveryScheduler,
} from '../../../packages/queue/src/index';
import {
  verifyShopifyHmac,
  stockPauseDecision,
  buildDailyDigest,
  realModeChecklist,
  OPS_META,
  parseSupplierOrderId,
} from '../../../packages/ops/src/index';
import {
  evaluateCandidate,
  computeOpportunityScore,
  computeSaturationScore,
  hardFilters,
  SCORING_META,
  detectBannedCategory,
} from '../../../packages/scoring/src/index';
import {
  buildLandingHtml,
  assetStatusForVideo,
  CONTENT_META,
} from '../../../packages/content/src/index';
import {
  realizedMargin,
  underperformanceDecision,
  proposePriceChange,
  ANALYTICS_META,
} from '../../../packages/analytics/src/index';
import {
  productionReadiness,
  ciPipelineHint,
  DEPLOY_META,
} from '../../../packages/deploy/src/index';
import {
  verifyHttpsAndWebhooks,
  verifyE2EGates,
  applyInventoryPolicy,
  verifyInventoryLoop,
  extractTrackingFromNote,
  verifyTracking,
  summarizeVerification,
  testWebhookHmac,
  REAL_CLOSE_META,
} from '../../../packages/real-close/src/index';
import {
  cleanCommercialTitle,
  titleQualityScore,
  strictCjGate,
  countOrphanPublished,
  priceFromUsdCost,
  marginAfterFees,
  approvalQueuePolicy,
  verifyCatalogQuality,
  summarizeQuality,
  CATALOG_QUALITY_META,
} from '../../../packages/catalog-quality/src/index';
import {
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
import {
  RELEASE_META,
  verifyRelease,
  classifyShopifyLink,
  rankApprovalQueue,
  httpsMonitor,
  webhookReadiness,
  pipelineSnapshot,
  cjSpendPolicy,
  dailyOperatorChecklist,
} from '../../../packages/release/src/index';
import {
  CONTENT_META,
  generateCreativeBrief,
  validateBrief,
  buildLandingHtml,
  defaultMediaPlan,
} from '../../../packages/content/src/index';

import {
  generateImageAssets,
  generateVideoAssets,
  buildLandingPack,
  preSaleChecklist,
  MEDIA_META,
} from '../../../packages/media/src/index';

import {
  isAutoApproveEnabled,
  decideAutoApprove,
  filterAutoApprovable,
  AUTO_APPROVE_META,
} from '../../../packages/approvals-auto/src/index';

import {
  AUTONOMY_META,
  isAutoGoLiveEnabled,
  publishBudgetGate,
  autonomyBoard,
  firstSaleSmoke,
  dailyPublishCap,
} from '../../../packages/autonomy/src/index';

import {
  PHASE_A_META,
  buildPhaseAChecks,
  summarizePhaseA,
} from '../../../packages/phase-a/src/index';
import {
  ensureShopifyAccessToken,
} from '../../../packages/shopify/src/index';






import { alertOps, getNotifyStatus, sendTelegram } from '../../../packages/notify/src/index';




import {
  getAdsStatus,
  buildCampaignDraft,
  attemptActivateCampaign,
  ADS_META,
} from '../../../packages/ads/src/index';

import {
  buildMetaTags,
  buildProductJsonLd,
  buildRobotsTxt,
  buildSitemapXml,
  seoScore,
  SEO_META,
} from '../../../packages/seo/src/index';


import {
  buildOrganicDrafts,
  attemptPublish,
  channelCredentials,
  MARKETING_META,
} from '../../../packages/marketing/src/index';

import {
  collectTrendSignals,
  aggregateTrendScore,
  getTrendsStatus,
  TRENDS_META,
} from '../../../packages/trends/src/index';




import { alertOps, getNotifyStatus, sendTelegram } from '../../../packages/notify/src/index';


function isKillSwitchOn() {
  return String(process.env.ECOM_KILL_SWITCH || '').toLowerCase() === 'true';
}

async function maybeAlertStock(product: {
  id?: string;
  title?: string;
  stock?: number | null;
  shouldPause?: boolean;
  marginBand?: string;
}) {
  try {
    const stock = product?.stock;
    if (stock === 0) {
      await alertOps('STOCK_ZERO', {
        productId: product.id || 'n/a',
        title: (product.title || '').toString().slice(0, 80),
        stock: 0,
        marginBand: product.marginBand || '',
      });
    } else if (product?.shouldPause) {
      await alertOps('STOCK_PAUSE', {
        productId: product.id || 'n/a',
        title: (product.title || '').toString().slice(0, 80),
        stock: stock ?? 'n/a',
        marginBand: product.marginBand || '',
      });
    }
  } catch {
    /* never break main flow */
  }
}



const MODE = (process.env.ECOM_MODE ?? 'MOCK') as 'MOCK' | 'SANDBOX' | 'REAL';
const MODE_ENUM = (MODE === 'REAL' ? 'REAL' : MODE === 'SANDBOX' ? 'SANDBOX' : 'MOCK') as RuntimeMode;

function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === 'object' && v !== null && 'toNumber' in v ? (v as any).toNumber() : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapPipelineStatus(s: string): 'RUNNING' | 'NEEDS_APPROVAL' | 'ELIGIBLE' | 'BLOCKED' | 'FAILED' | 'COMPLETED' {
  const allowed = ['RUNNING', 'NEEDS_APPROVAL', 'ELIGIBLE', 'BLOCKED', 'FAILED', 'COMPLETED'] as const;
  return (allowed as readonly string[]).includes(s) ? (s as any) : 'FAILED';
}

async function saveAgentRun(result: PipelineResult, opts?: { productId?: string; storeId?: string }) {
  try {
    return await prisma.agentRun.create({
      data: {
        traceId: result.traceId,
        productId: opts?.productId,
        storeId: opts?.storeId,
        productTitle: result.productTitle,
        status: mapPipelineStatus(result.status) as any,
        marginPercent: result.marginPercent,
        marginBand: result.marginBand,
        opportunityScore: result.opportunityScore,
        confidence: result.confidence,
        canPublish: result.canPublish,
        needsApproval: result.needsHumanApproval,
        blockedReasons: result.blockedReasons as any,
        steps: result.steps as any,
        runtimeMode: MODE_ENUM,
      },
    });
  } catch (e: any) {
    console.warn('saveAgentRun failed', e?.message);
    return null;
  }
}

async function ensureSupplierByName(name: string, verified: boolean) {
  const existing = await prisma.supplier.findFirst({ where: { name } });
  if (existing) return existing;
  return prisma.supplier.create({ data: { name, verified } });
}

function normTitleKey(title: string) {
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
  }

  const supplier = await ensureSupplierByName(c.supplierName, c.supplierVerified);
  const margin = calculateMargin({
    salePrice: c.salePrice,
    costs: { productCost: c.productCost, shippingCost: c.shippingCost },
  });

  const product = await prisma.product.create({
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
        create: {
          supplierId: supplier.id,
          countryCode: c.countryCode,
          productCost: c.productCost,
          shippingCost: c.shippingCost,
          stock: c.stock,
          isPrimary: true,
          cjVariantId: c.cjVariantId,
          cjSku: c.cjSku,
        },
      },
    },
  });

  await writeAudit('PRODUCT_DISCOVERED', 'Product', product.id, {
    source: c.source,
    signals: c.signals,
  });

  let pipelineResult = null;
  if (runPipeline) {
    const result = await runProductPipeline({
      title: c.title,
      salePrice: c.salePrice,
      productCost: c.productCost,
      shippingCost: c.shippingCost,
      stock: c.stock,
      opportunityScore: c.opportunityScore,
      confidence: c.confidence,
      supplierName: c.supplierName,
      supplierVerified: c.supplierVerified,
      isFirstPublication: true,
      currency: c.currency,
      skipAiCopy: true,
    });
    await saveAgentRun(result, { productId: product.id, storeId });
    await prisma.product.update({
      where: { id: product.id },
      data: {
        marginPercent: result.marginPercent,
        status:
          result.status === 'BLOCKED'
            ? 'REJECTED'
            : result.status === 'NEEDS_APPROVAL'
              ? 'PENDING_APPROVAL'
              : result.status === 'ELIGIBLE'
                ? 'EVALUATING'
                : 'DETECTED',
      },
    });
    pipelineResult = result;
  }

  return { productId: product.id, created: true, pipeline: pipelineResult, skipped: false };
}

function enrichProduct(p: any) {
  const primary = p.suppliers?.[0];
  const productCost = num(primary?.productCost);
  const shippingCost = num(primary?.shippingCost);
  const stock = primary?.stock ?? null;
  const verified = Boolean(primary?.supplier?.verified);
  const supplierName = primary?.supplier?.name ?? '—';
  const salePrice = num(p.salePrice);

  const costs: CostBreakdown = { productCost, shippingCost };
  const margin = calculateMargin({ salePrice, costs });
  const stockDec = decideStock(stock);
  const auto = canAutoPublish({
    marginPercent: margin.marginPercent,
    opportunityScore: p.opportunityScore ?? 0,
    confidence: p.confidence ?? 0,
    hasVerifiedSupplier: verified,
    hasCriticalUnknownCost: false,
    isFirstPublication: Boolean(p.isFirstPublication),
  });

  return {
    id: p.id,
    title: p.title,
    status: p.status,
    opportunityScore: p.opportunityScore,
    confidence: p.confidence,
    salePrice,
    currency: p.currency,
    productCost,
    shippingCost,
    stock,
    isFirstPublication: p.isFirstPublication,
    sourceMode: p.sourceMode,
    externalId: p.externalId,
    supplierName,
    verified,
    cjVariantId: primary?.cjVariantId ?? null,
    cjSku: primary?.cjSku ?? null,
    marginPercent: margin.marginPercent,
    marginBand: margin.band,
    canPublish: margin.canPublish && !stockDec.shouldPause,
    shouldPause: margin.shouldPause || stockDec.shouldPause,
    autoPublish: auto,
    priceChangesToday: p.priceChangesToday ?? 0,
    description: p.description,
    imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : [],
  };
}

async function writeAudit(action: string, entityType: string, entityId: string, metadata?: unknown) {
  await prisma.auditLog.create({
    data: {
      action,
      entityType,
      entityId,
      runtimeMode: MODE_ENUM,
      metadata: metadata as any,
    },
  });
}

async function ensureSeed() {
  const existing = await prisma.product.count();
  if (existing > 0) return;

  const user = await prisma.user.upsert({
    where: { email: 'admin@ecom.local' },
    update: {},
    create: { email: 'admin@ecom.local', name: 'Administrador ECOM', role: 'ADMIN' },
  });

  const store = await prisma.store.create({
    data: {
      name: 'ECOM Colombia MOCK',
      countryCode: 'CO',
      currency: 'COP',
      timezone: 'America/Bogota',
      runtimeMode: 'MOCK',
      ownerId: user.id,
    },
  });

  const suppliers = await Promise.all([
    prisma.supplier.create({ data: { name: 'CJ Mock Supplier', verified: true } }),
    prisma.supplier.create({ data: { name: 'AliExpress Mock', verified: true } }),
    prisma.supplier.create({ data: { name: 'Unverified Mock', verified: false } }),
  ]);

  const samples = [
    {
      title: '[MOCK] Organizador de cocina plegable',
      status: 'EVALUATING' as ProductStatus,
      opportunityScore: 72,
      confidence: 88,
      salePrice: 89900,
      productCost: 32000,
      shippingCost: 12000,
      stock: 120,
      isFirstPublication: true,
      supplier: suppliers[0],
      cjVariantId: process.env.CJ_DEFAULT_VID || null,
      cjSku: process.env.CJ_DEFAULT_SKU || null,
    },
    {
      title: '[MOCK] Lámpara LED portátil',
      status: 'PENDING_APPROVAL' as ProductStatus,
      opportunityScore: 65,
      confidence: 96,
      salePrice: 125000,
      productCost: 48000,
      shippingCost: 15000,
      stock: 45,
      isFirstPublication: true,
      supplier: suppliers[1],
      cjVariantId: null as string | null,
      cjSku: null as string | null,
    },
    {
      title: '[MOCK] Producto bajo margen',
      status: 'DETECTED' as ProductStatus,
      opportunityScore: 40,
      confidence: 70,
      salePrice: 50000,
      productCost: 38000,
      shippingCost: 8000,
      stock: 0,
      isFirstPublication: false,
      supplier: suppliers[2],
      cjVariantId: null as string | null,
      cjSku: null as string | null,
    },
  ];

  for (const s of samples) {
    const margin = calculateMargin({
      salePrice: s.salePrice,
      costs: { productCost: s.productCost, shippingCost: s.shippingCost },
    });
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        title: s.title,
        status: s.status,
        opportunityScore: s.opportunityScore,
        confidence: s.confidence,
        salePrice: s.salePrice,
        currency: 'COP',
        sourceMode: 'MOCK',
        isFirstPublication: s.isFirstPublication,
        marginPercent: margin.marginPercent,
        suppliers: {
          create: {
            supplierId: s.supplier.id,
            countryCode: 'CO',
            productCost: s.productCost,
            shippingCost: s.shippingCost,
            stock: s.stock,
            isPrimary: true,
            cjVariantId: s.cjVariantId,
            cjSku: s.cjSku,
          },
        },
      },
    });
    await writeAudit('PRODUCT_SEEDED', 'Product', product.id, { title: s.title });
  }
  console.log('Prisma seed OK');
}

@Injectable()
class RulesService {
  evaluateMargin(salePrice: number, costs: CostBreakdown) {
    return calculateMargin({ salePrice, costs });
  }
  evaluateStock(stock: number | null) {
    return decideStock(stock);
  }
  getConstants() {
    return RULES;
  }
}

@Controller()
class HealthController {
  @Get('health')
  async health() {
    let db = 'unknown';
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = 'ok';
    } catch {
      db = 'error';
    }
    const shopify = getShopifyStatus();
    const cj = getCjStatus();
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      service: 'ecom-api',
      mode: MODE,
      timestamp: new Date().toISOString(),
      block: 81,
      aiRouter: true,
      orchestrator: true,
      agentRuns: true,
      discovery: true,
      queue: true,
      persistence: 'prisma',
      shopify: shopify.canPublishLive ? 'live-ready' : 'mock',
      cj: cj.canFulfillLive ? 'live-ready' : 'mock',
      db,
    };
  }

  @Get('rules')
  rules() {
    return { mode: MODE, rules: RULES };
  }
}

@Controller('discovery')
class DiscoveryController {
  @Get('status')
  status() {
    return getDiscoveryStatus();
  }

  /** List candidates without writing to DB */
  @Get('preview')
  async preview(@Query('limit') limit = '5', @Query('includeWeak') includeWeak?: string) {
    const found = await discoverCandidates({
      limit: Number(limit) || 5,
      includeWeak: includeWeak === 'true',
    });
    const items = found.items.map((c) => ({
      ...c,
      hardFilters: candidatePassesHardFilters(c),
    }));
    return { mode: MODE, count: items.length, items };
  }

  /** Discover + ingest into Product table (+ optional orchestrator) */
  @Post('run')
  async run(
    @Body()
    body: {
      limit?: number;
      includeWeak?: boolean;
      runPipeline?: boolean;
      onlyPassingFilters?: boolean;
    },
  ) {
    const store = await prisma.store.findFirst();
    if (!store) return { error: 'no_store' };

    const found = await discoverCandidates({
      limit: body.limit ?? 5,
      includeWeak: Boolean(body.includeWeak),
    });

    const onlyPass = body.onlyPassingFilters !== false;
    const runPipeline = Boolean(body.runPipeline);
    const created: any[] = [];
    const skipped: any[] = [];
    const rejected: any[] = [];

    for (const c of found.items) {
      const filters = candidatePassesHardFilters(c);
      if (onlyPass && !filters.ok) {
        rejected.push({ title: c.title, reasons: filters.reasons });
        continue;
      }
      const r = await ingestCandidate(store.id, c, runPipeline);
      if (r.skipped) skipped.push({ title: c.title, productId: r.productId });
      else created.push({ title: c.title, productId: r.productId, pipelineStatus: r.pipeline?.status });
    }

    await writeAudit('DISCOVERY_RUN', 'Discovery', store.id, {
      created: created.length,
      skipped: skipped.length,
      rejected: rejected.length,
    });

    return {
      mode: MODE,
      discovered: found.count,
      created: created.length,
      skipped: skipped.length,
      rejectedFilter: rejected.length,
      items: created,
      skippedItems: skipped,
      rejectedItems: rejected,
      note: 'Candidatos MOCK etiquetados. runPipeline=true ejecuta orquestador por cada alta nueva.',
    };
  }
}


@Controller('alerts')
class AlertsController {
  @Get('stock-risks')
  async stockRisks() {
    const items = await prisma.product.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { suppliers: { include: { supplier: true } } },
    });
    const risks: any[] = [];
    for (const p of items) {
      const enriched = enrichProduct(p);
      if (enriched.stock === 0 || enriched.shouldPause) {
        risks.push({
          id: enriched.id,
          title: enriched.title,
          stock: enriched.stock,
          shouldPause: enriched.shouldPause,
          marginBand: enriched.marginBand,
          status: enriched.status,
        });
        void maybeAlertStock(enriched);
      }
    }
    return { mode: process.env.ECOM_MODE || 'MOCK', count: risks.length, items: risks };
  }

  @Get('status')
  status() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...getNotifyStatus() };
  }

  @Post('test')
  async test(@Body() body: { text?: string }) {
    const text = body?.text || `ECOM test alert ${new Date().toISOString()}`;
    const r = await sendTelegram(text);
    return { mode: process.env.ECOM_MODE || 'MOCK', ...r };
  }
}

@Controller('jobs')
class JobsController {
  @Get()
  async list(@Query('limit') limit = '20') {
    try {
      const recent = await listRecentJobs(Number(limit) || 20);
      return { mode: MODE, ...getQueueStatus(), ...recent };
    } catch (e: any) {
      return { mode: MODE, error: e?.message || 'queue_unavailable', items: [] };
    }
  }

  @Get('status')
  status() {
    return { mode: MODE, ...getQueueStatus() };
  }

  @Post('discovery')
  async discovery(
    @Body()
    body: {
      limit?: number;
      runPipeline?: boolean;
      onlyPassingFilters?: boolean;
      includeWeak?: boolean;
      sync?: boolean;
    },
  ) {
    if (body.sync) {
      const store = await prisma.store.findFirst();
      if (!store) return { error: 'no_store' };
      const found = await discoverCandidates({
        limit: body.limit ?? 5,
        includeWeak: Boolean(body.includeWeak),
      });
      const onlyPass = body.onlyPassingFilters !== false;
      const runPipeline = Boolean(body.runPipeline);
      const created: any[] = [];
      for (const c of found.items) {
        const filters = candidatePassesHardFilters(c);
        if (onlyPass && !filters.ok) continue;
        const r = await ingestCandidate(store.id, c, runPipeline);
        if (!r.skipped) created.push({ title: c.title, productId: r.productId });
      }
      await writeAudit('JOB_DISCOVERY_SYNC', 'Queue', store.id, { created: created.length });
      return { mode: MODE, sync: true, created: created.length, items: created };
    }
    try {
      const job = await enqueueDiscovery({
        limit: body.limit ?? 5,
        runPipeline: Boolean(body.runPipeline),
        onlyPassingFilters: body.onlyPassingFilters !== false,
        includeWeak: Boolean(body.includeWeak),
      });
      await writeAudit('JOB_ENQUEUED', 'Queue', String(job.jobId), job);
      return { mode: MODE, ...job };
    } catch (e: any) {
      return { mode: MODE, error: e?.message || 'enqueue_failed' };
    }
  }

  @Post('pipeline')
  async pipelineJob(@Body() body: { productId?: string; skipAiCopy?: boolean }) {
    if (!body.productId) return { error: 'productId_required' };
    try {
      const job = await enqueuePipeline({
        productId: body.productId,
        skipAiCopy: body.skipAiCopy !== false,
      });
      await writeAudit('JOB_ENQUEUED', 'Queue', String(job.jobId), job);
      return { mode: MODE, ...job };
    } catch (e: any) {
      return { mode: MODE, error: e?.message || 'enqueue_failed' };
    }
  }
}

@Controller('agents')
class AgentsController {
  @Get()
  list() {
    return { mode: MODE, ...getOrchestratorMeta() };
  }
}

@Controller('agent-runs')
class AgentRunsController {
  @Get()
  async list(@Query('limit') limit = '30', @Query('productId') productId?: string) {
    const n = Math.min(Number(limit) || 30, 100);
    const where = productId ? { productId } : {};
    const items = await prisma.agentRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: n,
    });
    return { mode: MODE, count: items.length, items };
  }

  @Get(':traceId')
  async one(@Param('traceId') traceId: string) {
    const run = await prisma.agentRun.findFirst({
      where: { OR: [{ traceId }, { id: traceId }] },
    });
    if (!run) return { error: 'not_found' };
    return { mode: MODE, run };
  }
}

@Controller('orchestrator')
class OrchestratorController {
  @Get('status')
  status() {
    return { ...getOrchestratorMeta(), block: 10, persistence: 'AgentRun' };
  }

  @Post('run')
  async run(@Body() body: CandidateInput & { skipAiCopy?: boolean; persist?: boolean }) {
    const result = await runProductPipeline({
      title: body.title || 'Candidato',
      salePrice: Number(body.salePrice) || 0,
      productCost: Number(body.productCost) || 0,
      shippingCost: Number(body.shippingCost) || 0,
      stock: body.stock ?? null,
      opportunityScore: body.opportunityScore ?? 60,
      confidence: body.confidence ?? 80,
      supplierName: body.supplierName,
      supplierVerified: body.supplierVerified !== false,
      isFirstPublication: body.isFirstPublication !== false,
      countryCode: body.countryCode || 'CO',
      currency: body.currency || 'COP',
      facts: body.facts,
      skipAiCopy: body.skipAiCopy !== false,
    });

    const store = await prisma.store.findFirst();
    const saved =
      body.persist === false ? null : await saveAgentRun(result, { storeId: store?.id });

    await writeAudit('ORCHESTRATOR_RUN', 'Orchestrator', result.traceId, {
      status: result.status,
      title: result.productTitle,
      margin: result.marginPercent,
      saved: Boolean(saved),
    });
    return { mode: MODE, result, agentRunId: saved?.id ?? null };
  }
}

@Controller('cj')
class CjController {
  @Get('status')
  status() {
    return getCjStatus();
  }
}

@Controller('shopify')
class ShopifyController {
  @Get('status')
  status() {
    return getShopifyStatus();
  }

  @Post('simulate-order')
  async simulateOrder(@Body() body: { productId?: string }) {
    const store = await prisma.store.findFirst();
    if (!store) return { error: 'no_store' };

    let title = '[MOCK] Pedido de prueba';
    let price = 89900;
    let currency = 'COP';

    if (body.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (p) {
        title = p.title;
        price = num(p.salePrice, 89900);
        currency = p.currency;
      }
    }

    const mock = createMockOrder(title, price, currency);
    const order = await prisma.order.create({
      data: {
        storeId: store.id,
        externalId: mock.id,
        orderNumber: mock.orderNumber,
        email: mock.email,
        status: 'PAID',
        total: mock.total,
        currency: mock.currency,
        lineItems: mock.lineItems as any,
        sourceMode: 'MOCK',
        fulfillmentNote: 'Listo para fulfillment CJ',
      },
    });

    await writeAudit('ORDER_SIMULATED', 'Order', order.id, mock);
    return { mode: MODE, order, mock: true };
  }

  @Post('webhooks/orders')
  async ordersWebhook(
    @Body() body: any,
    @Headers('x-shopify-hmac-sha256') hmac?: string,
    @Headers('x-shopify-topic') topic?: string,
  ) {
    const secret = (process.env.SHOPIFY_WEBHOOK_SECRET || '').trim();
    if (secret && !hmac) return { error: 'missing_hmac' };
    if (secret && hmac) {
      await writeAudit('SHOPIFY_WEBHOOK_HMAC_PRESENT', 'Shopify', topic || 'orders', {
        hmacPrefix: hmac.slice(0, 8),
      });
    }

    const store = await prisma.store.findFirst();
    if (!store) return { error: 'no_store' };

    const externalId = String(body?.id || body?.order_id || `wh-${Date.now()}`);
    const existing = await prisma.order.findFirst({ where: { externalId } });
    if (existing) return { mode: MODE, order: existing, duplicate: true };

    const lineItems = (body?.line_items || []).map((li: any) => ({
      title: li.title,
      quantity: li.quantity,
      price: Number(li.price || 0),
      sku: li.sku,
    }));

    const order = await prisma.order.create({
      data: {
        storeId: store.id,
        externalId,
        orderNumber: body?.name || body?.order_number?.toString(),
        email: body?.email || body?.customer?.email,
        status: 'PAID',
        total: Number(body?.total_price || body?.current_total_price || 0),
        currency: body?.currency || 'COP',
        lineItems: lineItems.length ? lineItems : body,
        sourceMode: MODE_ENUM,
        fulfillmentNote: 'Ingresado por webhook Shopify',
      },
    });

    await writeAudit('ORDER_WEBHOOK', 'Order', order.id, { topic, externalId });

    // Block 17: auto-fulfill (disable with ECOM_AUTO_FULFILL=false)
    const autoFulfill = (process.env.ECOM_AUTO_FULFILL || 'true').toLowerCase() !== 'false';
    if (!autoFulfill) {
      return { mode: MODE, order, received: true, autoFulfill: false };
    }

    try {
      const items = (order.lineItems as any[]) || [];
      const first = items[0] || { title: 'Producto', quantity: 1, sku: undefined };
      let cjSku = first.sku ? String(first.sku) : undefined;
      let cjVariantId: string | undefined;

      if (cjSku) {
        const linked = await prisma.product.findFirst({
          where: { suppliers: { some: { cjSku } } },
          include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
        });
        const primary = linked?.suppliers?.[0];
        if (primary?.cjSku) cjSku = primary.cjSku;
        if (primary?.cjVariantId) cjVariantId = primary.cjVariantId;
      }

      const result = await fulfillOrder({
        orderId: order.id,
        orderNumber: order.orderNumber,
        productTitle: first.title || 'Producto',
        quantity: first.quantity || 1,
        shippingCountry: 'CO',
        cjSku,
        cjVariantId,
      });

      if (!result.ok) {
        await writeAudit('AUTO_FULFILL_FAILED', 'Order', order.id, result);
        void alertOps('FULFILL_FAILED', {
          orderId: order.id,
          orderNumber: order.orderNumber,
          error: result.error || 'auto_fulfill_failed',
          auto: true,
          mock: result.mock,
        });
        return {
          mode: MODE,
          order,
          received: true,
          autoFulfill: true,
          fulfilled: false,
          error: result.error,
          cj: result,
        };
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'FULFILLED',
          fulfillmentNote: `CJ ${result.mock ? 'MOCK' : 'LIVE'} · auto · ${result.supplierOrderId} · ${result.carrier || ''}`,
        },
      });
      await writeAudit('ORDER_AUTO_FULFILLED', 'Order', order.id, result);
      return {
        mode: MODE,
        order: updated,
        received: true,
        autoFulfill: true,
        fulfilled: true,
        mock: result.mock,
        cj: result,
      };
    } catch (e: any) {
      await writeAudit('AUTO_FULFILL_ERROR', 'Order', order.id, { error: e?.message });
      void alertOps('FULFILL_FAILED', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        error: e?.message || 'auto_fulfill_error',
        auto: true,
      });
      return {
        mode: MODE,
        order,
        received: true,
        autoFulfill: true,
        fulfilled: false,
        error: e?.message || 'auto_fulfill_error',
      };
    }
  }
}

@Controller('orders')
class OrdersController {
  @Get()
  async list(@Query('limit') limit = '50') {
    const n = Math.min(Number(limit) || 50, 100);
    const items = await prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: n });
    return { mode: MODE, count: items.length, items };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return { error: 'not_found' };
    return { mode: MODE, order };
  }

  @Post(':id/fulfill')
  async fulfill(@Param('id') id: string) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return { error: 'not_found' };
    if (order.status === 'FULFILLED') return { error: 'already_fulfilled', order };

    const items = (order.lineItems as any[]) || [];
    const first = items[0] || { title: 'Producto', quantity: 1 };

    let cjSku = first.sku ? String(first.sku) : undefined;
    let cjVariantId: string | undefined;
    if (cjSku) {
      const linked = await prisma.product.findFirst({
        where: { suppliers: { some: { cjSku } } },
        include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
      });
      const primary = linked?.suppliers?.[0];
      if (primary?.cjSku) cjSku = primary.cjSku;
      if (primary?.cjVariantId) cjVariantId = primary.cjVariantId;
    }

    const result = await fulfillOrder({
      orderId: order.id,
      orderNumber: order.orderNumber,
      productTitle: first.title || 'Producto',
      quantity: first.quantity || 1,
      shippingCountry: 'CO',
      cjSku: cjSku || undefined,
      cjVariantId: cjVariantId || undefined,
    });

    if (!result.ok) {
      await writeAudit('FULFILL_FAILED', 'Order', id, result);
      void alertOps('FULFILL_FAILED', {
        orderId: id,
        orderNumber: order.orderNumber,
        error: result.error || 'fulfill_failed',
        mock: result.mock,
      });
      return { mode: MODE, error: 'fulfill_failed', result };
    }

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        fulfillmentNote: `CJ ${result.mock ? 'MOCK' : 'LIVE'} · ${result.supplierOrderId} · tracking ${result.trackingNumber || 'n/a'} · ${result.carrier || ''}`,
      },
    });

    await writeAudit('ORDER_FULFILLED', 'Order', id, result);
    void alertOps('FULFILL_OK', {
      orderId: id,
      orderNumber: order.orderNumber,
      supplierOrderId: result.supplierOrderId || '',
      mock: result.mock,
    });
    // AUTO_TRACKING_SYNC
    try {
      const shopifyOrderId = String(updated.externalId || '');
      if (/^\d+$/.test(shopifyOrderId) && result.trackingNumber && result.trackingNumber !== 'n/a') {
        const tr = await createOrderFulfillment({
          orderId: shopifyOrderId,
          trackingNumber: result.trackingNumber,
          trackingCompany: result.carrier || 'CJPacket Ordinary',
          notifyCustomer: false,
        });
        await writeAudit('AUTO_TRACKING_SYNC', 'Order', id, tr);
      }
    } catch (e: any) {
      console.warn('auto tracking sync failed', e?.message);
    }

    return {
      mode: MODE,
      fulfilled: true,
      mock: result.mock,
      order: updated,
      cj: result,
      note: result.mock ? 'Fulfillment MOCK' : 'Fulfillment enviado a CJ',
    };
  }

  /** Block 18: push tracking / mark fulfilled on Shopify */
  @Post(':id/sync-tracking')
  async syncTracking(
    @Param('id') id: string,
    @Body() body: { trackingNumber?: string; trackingCompany?: string; notifyCustomer?: boolean },
  ) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return { error: 'not_found' };
    if (!order.externalId || String(order.externalId).startsWith('mock') || String(order.externalId).startsWith('900')) {
      // still try if looks numeric shopify id
    }
    const shopifyOrderId = String(order.externalId || '');
    if (!/^\d+$/.test(shopifyOrderId)) {
      return {
        error: 'no_shopify_order_id',
        reason: 'externalId no es un order id numérico de Shopify (pedido de prueba manual?)',
        externalId: order.externalId,
      };
    }

    // Prefer body tracking; else parse from fulfillmentNote "tracking X" or "CJ LIVE · id · tracking Y"
    let trackingNumber = body?.trackingNumber;
    let trackingCompany = body?.trackingCompany || 'CJPacket Ordinary';
    if (!trackingNumber && order.fulfillmentNote) {
      const m = String(order.fulfillmentNote).match(/tracking\s+([^·\s]+)/i);
      if (m && m[1] && m[1] !== 'n/a') trackingNumber = m[1];
    }
    // placeholder if CJ has not issued tracking yet
    if (!trackingNumber) {
      trackingNumber = `PENDING-${order.orderNumber || order.id.slice(-6)}`;
    }

    const result = await createOrderFulfillment({
      orderId: shopifyOrderId,
      trackingNumber,
      trackingCompany,
      notifyCustomer: body?.notifyCustomer !== false,
    });

    if (!result.ok) {
      await writeAudit('SHOPIFY_FULFILL_FAILED', 'Order', id, result);
      return { mode: MODE, error: 'shopify_fulfill_failed', result };
    }

    const note = `Shopify fulfill ${result.mock ? 'MOCK' : 'LIVE'} · ff=${result.fulfillmentId || 'n/a'} · track=${trackingNumber}`;
    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        fulfillmentNote: order.fulfillmentNote
          ? `${order.fulfillmentNote} · ${note}`
          : note,
      },
    });
    await writeAudit('SHOPIFY_FULFILL_SYNC', 'Order', id, result);
    return {
      mode: MODE,
      synced: true,
      mock: result.mock,
      trackingNumber,
      trackingCompany,
      order: updated,
      shopify: result,
    };
  }


}

@Controller('ai')
class AiController {
  @Get('status')
  status() {
    return getRouterStatus();
  }

  @Post('complete')
  async complete(@Body() body: { prompt?: string; task?: string; messages?: any[] }) {
    const messages =
      body.messages?.length > 0
        ? body.messages
        : [{ role: 'user' as const, content: body.prompt || 'Hola' }];
    const result = await aiComplete({ messages, task: (body.task as any) || 'general' });
    await writeAudit('AI_COMPLETE', 'AiRouter', result.provider, { mock: result.mock });
    return { mode: MODE, result };
  }

  @Post('product-copy')
  async productCopy(@Body() body: { title?: string; facts?: string; language?: string }) {
    const result = await generateProductCopy({
      title: body.title || 'Producto',
      facts: body.facts || '',
      language: body.language || 'es-CO',
    });
    await writeAudit('AI_PRODUCT_COPY', 'AiRouter', result.provider, { mock: result.mock });
    return { mode: MODE, result };
  }
}


async function resolveCjImageUrls(title: string, sku?: string | null): Promise<string[]> {
  try {
    const cleaned = String(title || '')
      .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
      .replace(/Cross-Border|Dropshipping|Fashion|Elegant|Light|Luxury/gi, ' ')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(' ')
      .trim();
    const keyword = cleaned || 'necklace';
    const found = await searchCjProducts({ keyword, pageSize: 5 });
    if (!found.ok || !found.items?.length) return [];
    const urls: string[] = [];
    for (const item of found.items) {
      const u = (item as any).productImage || (item as any).productImageEn || (item as any).bigImage;
      if (u && /^https?:\/\//i.test(String(u))) urls.push(String(u));
    }
    return urls.slice(0, 3);
  } catch {
    return [];
  }
}

function cleanProductTitle(raw: string): string {
  return String(raw || '')
    .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Producto ECOM';
}

@Controller('products')
class ProductsController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  async list(@Query('status') status?: string) {
    const where = status ? { status: status as ProductStatus } : {};
    const rows = await prisma.product.findMany({
      where,
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return { mode: MODE, persistence: 'prisma', count: rows.length, items: rows.map(enrichProduct) };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found', mode: MODE };
    return { mode: MODE, item: enrichProduct(p) };
  }

  @Post(':id/cj-link')
  async cjLink(@Param('id') id: string, @Body() body: { cjVariantId?: string; cjSku?: string }) {
    const primary = await prisma.productSupplier.findFirst({
      where: { productId: id, isPrimary: true },
    });
    if (!primary) return { error: 'no_primary_supplier' };
    const updated = await prisma.productSupplier.update({
      where: { id: primary.id },
      data: {
        cjVariantId: body.cjVariantId ?? primary.cjVariantId,
        cjSku: body.cjSku ?? primary.cjSku,
      },
    });
    await writeAudit('PRODUCT_CJ_LINK', 'Product', id, {
      cjVariantId: updated.cjVariantId,
      cjSku: updated.cjSku,
    });
    return { mode: MODE, productId: id, link: updated };
  }

  @Post(':id/pipeline')
  async pipeline(@Param('id') id: string, @Body() body: { skipAiCopy?: boolean }) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const enriched = enrichProduct(p);
    const result = await runProductPipeline({
      title: enriched.title,
      salePrice: enriched.salePrice,
      productCost: enriched.productCost,
      shippingCost: enriched.shippingCost,
      stock: enriched.stock,
      opportunityScore: enriched.opportunityScore ?? 0,
      confidence: enriched.confidence ?? 0,
      supplierName: enriched.supplierName,
      supplierVerified: enriched.verified,
      isFirstPublication: enriched.isFirstPublication,
      currency: enriched.currency,
      skipAiCopy: body?.skipAiCopy !== false,
    });

    const saved = await saveAgentRun(result, { productId: id, storeId: p.storeId });

    await prisma.product.update({
      where: { id },
      data: {
        marginPercent: result.marginPercent,
        description: result.suggestedDescription
          ? result.suggestedDescription.slice(0, 4000)
          : undefined,
        status:
          result.status === 'BLOCKED'
            ? 'REJECTED'
            : result.status === 'NEEDS_APPROVAL'
              ? 'PENDING_APPROVAL'
              : p.status,
      },
    });

    await writeAudit('PRODUCT_PIPELINE', 'Product', id, {
      status: result.status,
      traceId: result.traceId,
      agentRunId: saved?.id,
    });

    return { mode: MODE, productId: id, agentRunId: saved?.id ?? null, result };
  }

  @Post(':id/evaluate')
  async evaluate(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const enriched = enrichProduct(p);
    const margin = this.rules.evaluateMargin(enriched.salePrice, {
      productCost: enriched.productCost,
      shippingCost: enriched.shippingCost,
    });
    await prisma.product.update({ where: { id }, data: { marginPercent: margin.marginPercent } });
    await writeAudit('PRODUCT_EVALUATED', 'Product', id, { margin: margin.marginPercent });
    return { mode: MODE, item: { ...enriched, marginPercent: margin.marginPercent, marginBand: margin.band } };
  }

    @Post(':id/request-approval')
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
    }
    const admin = await prisma.user.findFirst({ where: { email: 'admin@ecom.local' } });
    const action = body.action || 'FIRST_PUBLICATION';
    const approval = await prisma.approval.create({
      data: {
        productId: id,
        requestedBy: admin?.id ?? 'system',
        action,
        reason: body.reason || `Aprobación requerida: ${action}`,
        status: 'PENDING',
        metadata: { requiresHuman: requiresHumanApproval(action) },
      },
    });
    await prisma.product.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
    await writeAudit('APPROVAL_REQUESTED', 'Approval', approval.id, approval);
    return { mode: MODE, approval };
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const enriched = enrichProduct(p);
    if (enriched.shouldPause || !enriched.canPublish) {
      void maybeAlertStock(enriched);
      return { error: 'rules_block', reason: 'Margen/stock no permiten publicación', item: enriched };
    }
    if (p.isFirstPublication) {
      const anyApproved = await prisma.approval.findFirst({
        where: { productId: id, status: 'APPROVED' },
      });
      if (!anyApproved) {
        return { error: 'approval_required', reason: 'Primera publicación requiere aprobación humana' };
      }
    }

    const imageUrlsPub = await resolveCjImageUrls(enriched.title, enriched.cjSku);
    const result = await publishProduct({
      title: enriched.title,
      description: enriched.description,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku: enriched.cjSku || `ECOM-${id.slice(-8)}`,
      inventory: enriched.stock,
      imageUrls: imageUrlsPub,
    });
    if (!result.ok) {
      await writeAudit('PUBLISH_FAILED', 'Product', id, result);
      return { mode: MODE, error: 'publish_failed', result };
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        externalId: result.externalId,
        isFirstPublication: false,
        sourceMode: result.mock ? 'MOCK' : MODE_ENUM,
      },
    });
    await writeAudit('PRODUCT_PUBLISHED', 'Product', id, result);
    return { mode: MODE, published: true, mock: result.mock, product: updated, shopify: result };
  }


  /** Block 15: human OK + publish Shopify in one step (CJ links preserved on product). */
  
  @Post(':id/sync-inventory')
  async syncInventory(@Param('id') id: string, @Body() body: { available?: number }) {
    const row = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
    });
    if (!row) return { error: 'not_found' };
    if (!row.externalId || String(row.externalId).startsWith('mock')) {
      return { error: 'not_published', reason: 'Sin externalId de Shopify' };
    }
    const enriched = enrichProduct(row);
    const available = body?.available != null ? Number(body.available) : Number(enriched.stock ?? 0);
    if (available === 0) {
      void maybeAlertStock({ id, title: enriched.title, stock: 0, shouldPause: true, marginBand: enriched.marginBand });
    }

    // Fetch variant inventory_item_id from Shopify product
    const status = getShopifyStatus();
    if (!status.canPublishLive) {
      const mock = await setInventoryLevel({ inventoryItemId: 'mock', available });
      return { mode: MODE, synced: true, mock: true, available, shopify: mock };
    }

    try {
      const shop = (process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '').replace(/\r/g, '').trim();
      const host = shop.includes('.') ? shop : `${shop}.myshopify.com`;
      const token = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
      const ver = process.env.SHOPIFY_API_VERSION || '2026-07';
      const res = await fetch(`https://${host}/admin/api/${ver}/products/${row.externalId}.json`, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      const data = (await res.json()) as any;
      const invItemId = data?.product?.variants?.[0]?.inventory_item_id;
      if (!invItemId) {
        return { error: 'no_inventory_item', raw: data };
      }
      const result = await setInventoryLevel({
        inventoryItemId: String(invItemId),
        available,
      });
      await writeAudit('INVENTORY_SYNC', 'Product', id, result);
      return {
        mode: MODE,
        synced: result.ok,
        mock: result.mock,
        available: result.available ?? available,
        ecomStock: enriched.stock,
        shopify: result,
      };
    } catch (e: any) {
      return { error: e?.message || 'sync_failed' };
    }
  }

@Post(':id/go-live')
  async goLive(@Param('id') id: string, @Body() body: { note?: string; skipAiCopy?: boolean }) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const enriched = enrichProduct(p);
    if (enriched.shouldPause || !enriched.canPublish) {
      void maybeAlertStock(enriched);
      return { error: 'rules_block', reason: 'Margen/stock no permiten publicación', item: enriched };
    }

    const admin = await prisma.user.findFirst({ where: { email: 'admin@ecom.local' } });
    let approval = await prisma.approval.findFirst({
      where: { productId: id, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
    });

    if (!approval) {
      const pending = await prisma.approval.findFirst({
        where: { productId: id, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      if (pending) {
        approval = await prisma.approval.update({
          where: { id: pending.id },
          data: {
            status: 'APPROVED',
            decidedAt: new Date(),
            metadata: { ...(pending.metadata as object), note: body?.note || 'go-live', via: 'go-live' },
          },
        });
      } else {
        approval = await prisma.approval.create({
          data: {
            productId: id,
            requestedBy: admin?.id ?? 'system',
            action: 'FIRST_PUBLICATION',
            reason: body?.note || 'Go-live: aprobación + publicación',
            status: 'APPROVED',
            decidedAt: new Date(),
            metadata: { via: 'go-live', requiresHuman: true },
          },
        });
      }
      await writeAudit('APPROVAL_APPROVED', 'Approval', approval.id, { via: 'go-live' });
    }

    // Block 16: clean title + optional AI copy (skip with body.skipAiCopy=true)
    const skipAi = Boolean((body as any)?.skipAiCopy);
    let liveTitle = cleanProductTitle(enriched.title);
    let liveDescription = enriched.description || '';
    let copyMeta: Record<string, unknown> = { skipped: skipAi };

    if (!skipAi) {
      try {
        const copy = await generateProductCopy({
          title: liveTitle,
          facts: `precio ${enriched.salePrice} ${enriched.currency}, costo ${enriched.productCost}, stock ${enriched.stock}, proveedor CJ, sku ${enriched.cjSku || 'n/a'}`,
          language: 'es-CO',
        });
        copyMeta = {
          ok: copy.ok,
          provider: copy.provider,
          model: copy.model,
          mock: copy.mock,
        };
        if (copy.ok && copy.text) {
          liveDescription = copy.text.slice(0, 4000);
          // First non-empty line as optional short title if original was noisy
          const firstLine = liveDescription.split('\n').map((s) => s.trim()).find(Boolean);
          if (firstLine && firstLine.length >= 12 && firstLine.length <= 90 && /\[/.test(enriched.title)) {
            liveTitle = firstLine.replace(/^#+\s*/, '').slice(0, 120);
          }
        }
      } catch (e: any) {
        copyMeta = { ok: false, error: e?.message || 'copy_failed' };
      }
    }

    if (liveDescription || liveTitle !== enriched.title) {
      await prisma.product.update({
        where: { id },
        data: {
          title: liveTitle,
          description: liveDescription || null,
        },
      });
    }

    const sku = enriched.cjSku || `ECOM-${id.slice(-8)}`;
    // Block 19: attach CJ catalog images when available
    const imageUrls = await resolveCjImageUrls(liveTitle, enriched.cjSku);
    const result = await publishProduct({
      title: liveTitle,
      description: liveDescription || liveTitle,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku,
      inventory: enriched.stock,
      imageUrls,
    });


    let inventorySync: any = null;
    if (result.ok && enriched.stock != null) {
      try {
        const invItemId =
          (result.raw as any)?.product?.variants?.[0]?.inventory_item_id ||
          (result.raw as any)?.product?.variants?.[0]?.inventory_item_id;
        if (invItemId) {
          inventorySync = await setInventoryLevel({
            inventoryItemId: String(invItemId),
            available: Number(enriched.stock) || 0,
          });
          await writeAudit('INVENTORY_SYNC', 'Product', id, inventorySync);
        }
      } catch (e: any) {
        inventorySync = { ok: false, error: e?.message };
      }
    }
    if (!result.ok) {
      void alertOps('PUBLISH_FAILED', { productId: id, error: 'go_live_failed' });
      await writeAudit('GO_LIVE_FAILED', 'Product', id, result);
      return { mode: MODE, error: 'publish_failed', approval, result, copy: copyMeta };
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        externalId: result.externalId,
        isFirstPublication: false,
        sourceMode: result.mock ? 'MOCK' : MODE_ENUM,
        title: liveTitle,
        description: liveDescription || null,
      },
    });
    void alertOps('GO_LIVE', { productId: id, title: String((enriched as any)?.title || '').slice(0, 80) });
    // close all PENDING approvals for this product so panel clears
    try {
      await prisma.approval.updateMany({
        where: { productId: id, status: 'PENDING' },
        data: { status: 'APPROVED', decidedAt: new Date() },
      });
    } catch (e: any) {
      console.warn('close pending approvals failed', e?.message);
    }

    await writeAudit('PRODUCT_GO_LIVE', 'Product', id, {
      shopify: result.externalId,
      cjVariantId: enriched.cjVariantId,
      cjSku: enriched.cjSku,
      mock: result.mock,
      copy: copyMeta,
      title: liveTitle,
    });

    return {
      mode: MODE,
      published: true,
      mock: result.mock,
      product: updated,
      approval,
      shopify: result,
      copy: copyMeta,
      cj: { variantId: enriched.cjVariantId, sku: enriched.cjSku },
      inventorySync,
      note: 'Go-live con copy IA (bloque 16). Título limpio + descripción es-CO. CJ conservado.',
    };
  }

  @Post(':id/generate-copy')
  async generateCopy(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const enriched = enrichProduct(p);
    const result = await generateProductCopy({
      title: enriched.title,
      facts: `costo ${enriched.productCost}, stock ${enriched.stock}, proveedor ${enriched.supplierName}`,
      language: 'es-CO',
    });
    if (result.ok && result.text) {
      await prisma.product.update({ where: { id }, data: { description: result.text.slice(0, 4000) } });
    }
    await writeAudit('AI_PRODUCT_COPY', 'Product', id, { provider: result.provider });
    return { mode: MODE, productId: id, result };
  }
}

@Controller('approvals')
class ApprovalsController {
  @Get()
  async list(@Query('status') status?: string) {
    const where = status ? { status: status as ApprovalStatus } : {};
    const rows = await prisma.approval.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        product: {
          include: {
            suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' }, take: 1 },
          },
        },
      },
    });
    const items = rows.map((a) => {
      const enriched = a.product ? enrichProduct(a.product) : null;
      return {
        id: a.id,
        productId: a.productId,
        action: a.action,
        reason: a.reason,
        status: a.status,
        createdAt: a.createdAt,
        decidedAt: a.decidedAt,
        product: enriched
          ? {
              id: enriched.id,
              title: enriched.title,
              status: enriched.status,
              marginPercent: enriched.marginPercent,
              marginBand: enriched.marginBand,
              opportunityScore: enriched.opportunityScore,
              confidence: enriched.confidence,
              salePrice: enriched.salePrice,
              currency: enriched.currency,
              stock: enriched.stock,
              supplierName: enriched.supplierName,
              verified: enriched.verified,
              cjSku: enriched.cjSku,
              canPublish: enriched.canPublish,
              shouldPause: enriched.shouldPause,
            }
          : null,
      };
    });
    return { mode: MODE, count: items.length, items };
  }


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

  @Post(':id/decide')
  async decide(@Param('id') id: string, @Body() body: { decision: 'APPROVED' | 'REJECTED'; note?: string }) {
    const a = await prisma.approval.findUnique({ where: { id } });
    if (!a) return { error: 'not_found' };
    if (a.status !== 'PENDING') return { error: 'already_decided' };
    const decision = body.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    const approval = await prisma.approval.update({
      where: { id },
      data: {
        status: decision as ApprovalStatus,
        decidedAt: new Date(),
        metadata: { ...(a.metadata as object), note: body.note },
      },
    });
    let product = null;
    if (a.productId) {
      product = await prisma.product.update({
        where: { id: a.productId },
        data: { status: decision === 'APPROVED' ? 'DRAFT' : 'REJECTED' },
      });
    }
    await writeAudit(`APPROVAL_${decision}`, 'Approval', id, { productId: a.productId });
    return { mode: MODE, approval, product, next: decision === 'APPROVED' ? 'POST /products/:id/publish' : null };
  }
}

@Controller('audit')
class AuditController {
  @Get()
  async list(@Query('limit') limit = '50') {
    const n = Math.min(Number(limit) || 50, 200);
    const items = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: n });
    return { mode: MODE, count: items.length, items };
  }
}

@Controller('auth')
class AuthController {
  @Get('me')
  async me() {
    const user = await prisma.user.findFirst({ where: { email: 'admin@ecom.local' } });
    return { mode: MODE, user: user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null };
  }

  @Post('login')
  async login(@Body() body: { email?: string }) {
    const user = await prisma.user.findFirst({ where: { email: body.email || 'admin@ecom.local' } });
    if (!user) return { error: 'invalid_credentials' };
    await writeAudit('LOGIN_MOCK', 'User', user.id);
    return {
      mode: MODE,
      token: 'mock-session-token',
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}


@Controller('ops')
class OpsController {
  @Get('status')
  status() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...OPS_META,
      inventoryIntervalMin: Number(process.env.ECOM_INVENTORY_INTERVAL_MINUTES || 20),
      trackingIntervalMin: Number(process.env.ECOM_TRACKING_INTERVAL_MINUTES || 30),
      digestHourBogota: 9,
    };
  }

  @Get('real-checklist')
  checklist() {
    const result = realModeChecklist(process.env as any);
    return { mode: process.env.ECOM_MODE || 'MOCK', ...result };
  }

  @Post('digest/run')
  async runDigest() {
    const published = await prisma.product.count({ where: { status: 'PUBLISHED' } });
    const pendingApprovals = await prisma.approval.count({ where: { status: 'PENDING' } });
    const paidOrders = await prisma.order.count({ where: { status: 'PAID' } });
    const fulfilledOrders = await prisma.order.count({ where: { status: 'FULFILLED' } });
    const pausedProducts = await prisma.product.count({ where: { status: 'PAUSED' } });
    const date = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
    const digest = buildDailyDigest({
      mode: process.env.ECOM_MODE || 'MOCK',
      published,
      pendingApprovals,
      paidOrders,
      fulfilledOrders,
      pausedProducts,
      stockRisks: 0,
      jobsFailed: 0,
      date,
    });
    try {
      void alertOps('DAILY_DIGEST', { body: digest.body, severity: digest.severity });
    } catch {}
    await writeAudit('DAILY_DIGEST', 'System', 'digest', digest);
    return { ok: true, digest };
  }

  @Get('export/products.csv')
  async exportProducts() {
    const items = await prisma.product.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    const header = 'id,title,status,marginPercent,salePrice,currency,externalId,createdAt';
    const rows = items.map((p) =>
      [
        p.id,
        JSON.stringify(p.title),
        p.status,
        p.marginPercent ?? '',
        p.salePrice ?? '',
        p.currency,
        p.externalId ?? '',
        p.createdAt.toISOString(),
      ].join(','),
    );
    return header + '\n' + rows.join('\n');
  }

  @Post('inventory/sync-all')
  async syncAllInventory() {
    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      include: { suppliers: true },
      take: 50,
    });
    const results: any[] = [];
    for (const p of products) {
      const primary = p.suppliers.find((s) => s.isPrimary) || p.suppliers[0];
      const stock = primary?.stock ?? null;
      const decision = stockPauseDecision(stock);
      if (decision.shouldPause && p.status === 'PUBLISHED') {
        await prisma.product.update({ where: { id: p.id }, data: { status: 'PAUSED' } });
        void alertOps('STOCK_PAUSE', { productId: p.id, title: p.title.slice(0, 80) });
      }
      results.push({ productId: p.id, stock, ...decision });
    }
    await writeAudit('INVENTORY_SYNC_ALL', 'System', 'inventory', { count: results.length });
    return { mode: process.env.ECOM_MODE || 'MOCK', count: results.length, results };
  }
}


@Controller('scoring')
class ScoringController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...SCORING_META };
  }

  @Post('evaluate')
  evaluate(
    @Body()
    body: {
      title?: string;
      demandScore?: number;
      marginPercent?: number;
      trendScore?: number;
      supplierVerified?: boolean;
      stock?: number;
      salePrice?: number;
      shippingCost?: number;
      processingDays?: number;
      competitorCount?: number;
    },
  ) {
    const result = evaluateCandidate({
      title: body?.title,
      demandScore: body?.demandScore,
      marginPercent: body?.marginPercent,
      trendScore: body?.trendScore,
      supplierVerified: body?.supplierVerified ?? true,
      stock: body?.stock,
      salePrice: body?.salePrice,
      shippingCost: body?.shippingCost,
      processingDays: body?.processingDays,
      competitorCount: body?.competitorCount,
      shipsToCountry: true,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 28, ...result };
  }
}

@Controller('content')
class ContentController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...CONTENT_META };
  }

  @Post('landing')
  async landing(
    @Body()
    body: {
      productId?: string;
      title?: string;
      description?: string;
      salePrice?: number;
      currency?: string;
      imageUrl?: string;
      shopifyUrl?: string;
    },
  ) {
    let title = body?.title || 'Producto ECOM';
    let description = body?.description;
    let salePrice = body?.salePrice;
    let currency = body?.currency || 'COP';
    let shopifyUrl = body?.shopifyUrl;
    if (body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (p) {
        title = p.title;
        description = p.description || description;
        salePrice = p.salePrice != null ? Number(p.salePrice) : salePrice;
        currency = p.currency || currency;
        if (p.externalId) {
          const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '';
          shopifyUrl =
            shopifyUrl ||
            (shop ? `https://${shop.replace(/^https?:\/\//, '')}/products/${p.externalId}` : undefined);
        }
      }
    }
    const html = buildLandingHtml({
      title,
      description,
      salePrice,
      currency,
      imageUrl: body?.imageUrl,
      shopifyUrl,
      countryCode: 'CO',
    });
    const video = assetStatusForVideo(false);
    await writeAudit('LANDING_GENERATED', 'Content', body?.productId || 'adhoc', {
      title,
      videoStatus: video,
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 29,
      html,
      assets: { image: body?.imageUrl ? 'READY' : 'ASSET_PENDING', video },
    };
  }
}

@Controller('dashboard')
class DashboardController {
  @Get()
  async summary() {
    const [
      published,
      pending,
      paused,
      detected,
      paid,
      fulfilled,
      approvalsPending,
      agentRuns,
    ] = await Promise.all([
      prisma.product.count({ where: { status: 'PUBLISHED' } }),
      prisma.product.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.product.count({ where: { status: 'PAUSED' } }),
      prisma.product.count({ where: { status: 'DETECTED' } }),
      prisma.order.count({ where: { status: 'PAID' } }),
      prisma.order.count({ where: { status: 'FULFILLED' } }),
      prisma.approval.count({ where: { status: 'PENDING' } }),
      prisma.agentRun.count(),
    ]);
    const checklist = [
      { id: 'health', label: 'API health OK', done: true },
      { id: 'approvals', label: 'Revisar aprobaciones PENDING', done: approvalsPending === 0 },
      { id: 'paid', label: 'Pedidos PAID por cumplir', done: paid === 0 },
      { id: 'paused', label: 'Revisar productos pausados', done: paused === 0 },
      { id: 'digest', label: 'Correr digest diario', done: false },
    ];
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 61,
      kpis: {
        published,
        pendingApproval: pending,
        paused,
        detected,
        ordersPaid: paid,
        ordersFulfilled: fulfilled,
        approvalsPending,
        agentRuns,
      },
      dailyChecklist: checklist,
      scoring: SCORING_META,
      content: CONTENT_META,
    };
  }
}


@Controller('trends')
class TrendsController {
  @Get('status')
  status() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...getTrendsStatus() };
  }

  @Post('collect')
  async collect(@Body() body: { query?: string }) {
    const query = body?.query || 'productos tendencia colombia';
    const signals = await collectTrendSignals(query);
    const score = aggregateTrendScore(signals);
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 31, query, score, signals };
  }
}

@Controller('marketing')
class MarketingController {
  @Get('status')
  status() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...MARKETING_META,
      credentials: channelCredentials(),
    };
  }

  @Post('drafts')
  async drafts(@Body() body: { productId?: string; title?: string; description?: string }) {
    let title = body?.title || 'Producto ECOM';
    let description = body?.description;
    let price: any;
    let currency = 'COP';
    let url: string | undefined;
    if (body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (p) {
        title = p.title;
        description = p.description || description;
        price = p.salePrice;
        currency = p.currency;
        if (p.externalId) {
          const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '';
          if (shop) url = `https://${String(shop).replace(/^https?:\/\//, '')}/products/${p.externalId}`;
        }
      }
    }
    const drafts = buildOrganicDrafts({ title, description, price, currency, url });
    await writeAudit('MARKETING_DRAFTS', 'Marketing', body?.productId || 'adhoc', {
      channels: drafts.map((d) => d.channel),
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 32, drafts };
  }

  @Post('publish-attempt')
  publishAttempt(@Body() body: { channel?: string; force?: boolean; caption?: string }) {
    const drafts = buildOrganicDrafts({ title: body?.caption || 'test' });
    const draft = drafts.find((d) => d.channel === body?.channel) || drafts[0];
    const result = attemptPublish(draft, { force: Boolean(body?.force) });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 32, draft, result };
  }
}

@Controller('analytics')
class AnalyticsController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...ANALYTICS_META };
  }

  @Get('summary')
  async summary() {
    const products = await prisma.product.findMany({ take: 100 });
    const orders = await prisma.order.findMany({ take: 200 });
    const revenue = orders.reduce((a, o) => a + Number(o.total || 0), 0);
    const byStatus: Record<string, number> = {};
    for (const p of products) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 61,
      products: products.length,
      orders: orders.length,
      revenue,
      byStatus,
    };
  }

  @Post('margin')
  margin(
    @Body()
    body: { saleTotal: number; productCost: number; shippingCost: number; feesPct?: number },
  ) {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 61,
      ...realizedMargin(body),
    };
  }

  @Post('price-check')
  priceCheck(
    @Body()
    body: {
      currentPrice: number;
      newPrice: number;
      changesToday?: number;
      productCost: number;
      shippingCost: number;
    },
  ) {
    const result = proposePriceChange({
      currentPrice: body.currentPrice,
      newPrice: body.newPrice,
      changesToday: body.changesToday ?? 0,
      productCost: body.productCost,
      shippingCost: body.shippingCost,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 61, ...result };
  }

  @Post('underperformance')
  async underperformance(@Body() body: { productId: string; minDays?: number }) {
    const p = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!p) return { error: 'not_found' };
    const orders = await prisma.order.findMany({ take: 500 });
    const related = orders.filter((o) =>
      JSON.stringify(o.lineItems || {}).includes(p.title.slice(0, 20)),
    );
    const days = Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86400000);
    const decision = underperformanceDecision({
      productId: p.id,
      title: p.title,
      status: p.status,
      marginPercent: p.marginPercent != null ? Number(p.marginPercent) : null,
      opportunityScore: p.opportunityScore,
      ordersCount: related.length,
      revenue: related.reduce((a, o) => a + Number(o.total || 0), 0),
      daysSincePublish: days,
    }, { minDays: body.minDays });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 61, productId: p.id, days, orders: related.length, decision };
  }
}


@Controller('seo')
class SeoController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...SEO_META };
  }

  @Post('product')
  async product(@Body() body: { productId?: string; title?: string; description?: string; url?: string }) {
    let title = body?.title || 'Producto';
    let description = body?.description;
    let salePrice: any;
    let currency = 'COP';
    let sku: string | undefined;
    let url = body?.url;
    if (body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (p) {
        title = p.title;
        description = p.description || description;
        salePrice = p.salePrice;
        currency = p.currency;
        sku = (p as any).cjSku || undefined;
        if (p.externalId) {
          const shop = process.env.SHOPIFY_SHOP_DOMAIN || '';
          if (shop) url = url || `https://${String(shop).replace(/^https?:\/\//, '')}/products/${p.externalId}`;
        }
      }
    }
    const input = { title, description, salePrice, currency, url, sku };
    const tags = buildMetaTags(input);
    const jsonLd = buildProductJsonLd(input);
    const score = seoScore({
      hasTitle: Boolean(title),
      hasDescription: Boolean(description),
      hasImage: false,
      hasJsonLd: true,
      titleLen: title.length,
      descLen: (description || '').length,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 34, tags, jsonLd, score };
  }

  @Get('robots.txt')
  robots() {
    const app = process.env.APP_URL || 'http://localhost:3000';
    return buildRobotsTxt({ sitemapUrl: `${app}/seo/sitemap.xml` });
  }

  @Get('sitemap.xml')
  async sitemap() {
    const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.APP_URL || 'http://localhost:3000';
    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      take: 200,
      orderBy: { updatedAt: 'desc' },
    });
    const urls = products
      .filter((p) => p.externalId)
      .map((p) => ({
        loc: `https://${String(shop).replace(/^https?:\/\//, '')}/products/${p.externalId}`,
        lastmod: p.updatedAt.toISOString().slice(0, 10),
        changefreq: 'weekly',
        priority: 0.8,
      }));
    return buildSitemapXml(urls);
  }
}

@Controller('ads')
class AdsController {
  @Get('status')
  status() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...getAdsStatus(), ...ADS_META };
  }

  @Post('draft')
  draft(
    @Body()
    body: { productTitle?: string; platform?: 'meta' | 'google' | 'tiktok'; dailyBudgetUsd?: number },
  ) {
    const draft = buildCampaignDraft({
      productTitle: body?.productTitle || 'Producto ECOM',
      platform: body?.platform,
      dailyBudgetUsd: body?.dailyBudgetUsd ?? 0,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 35, draft };
  }

  @Post('activate-attempt')
  activate(
    @Body()
    body: {
      productTitle?: string;
      dailyBudgetUsd?: number;
      force?: boolean;
      humanApproved?: boolean;
    },
  ) {
    const draft = buildCampaignDraft({
      productTitle: body?.productTitle || 'test',
      dailyBudgetUsd: body?.dailyBudgetUsd ?? 0,
    });
    const result = attemptActivateCampaign(draft, {
      force: Boolean(body?.force),
      humanApproved: Boolean(body?.humanApproved),
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 35, ...result };
  }
}

@Controller('deploy')
class DeployController {
  @Get('status')
  status() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...DEPLOY_META };
  }

  @Get('readiness')
  readiness() {
    const result = productionReadiness(process.env as any);
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 61, ...result };
  }

  @Get('ci-hints')
  ci() {
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 61, steps: ciPipelineHint() };
  }
}


@Controller('real')
class RealCloseController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...REAL_CLOSE_META };
  }

  @Get('verify')
  async verify() {
    const items = [...verifyHttpsAndWebhooks()];

    const products = await prisma.product.findMany({
      take: 200,
      include: { suppliers: true },
    });
    const orders = await prisma.order.findMany({ take: 200 });
    const publishedWithCj = products.filter((p) => {
      if (p.status !== 'PUBLISHED') return false;
      return (p.suppliers || []).some(
        (s: any) => Boolean(s.cjVariantId || s.cjSku),
      );
    }).length;
    const ordersPaid = orders.filter((o) => o.status === 'PAID').length;
    const ordersFulfilled = orders.filter((o) => o.status === 'FULFILLED').length;

    const shopifyLive = String(process.env.SHOPIFY_ACCESS_TOKEN || '').length > 5;
    const cjLive = String(process.env.CJ_API_KEY || '').length > 5;

    items.push(
      ...verifyE2EGates({
        publishedWithCj,
        ordersPaid,
        ordersFulfilled,
        shopifyLive,
        cjLive,
      }),
    );

    const inv = applyInventoryPolicy(
      products.map((p) => {
        const primary = (p.suppliers || []).find((s: any) => s.isPrimary) || (p.suppliers || [])[0];
        return {
          productId: p.id,
          stock: primary?.stock ?? null,
          status: p.status,
        };
      }),
    );
    items.push(
      ...verifyInventoryLoop({
        checked: inv.results.length,
        paused: inv.toPause.length,
        errors: 0,
      }),
    );

    let withSupplierId = 0;
    let withTracking = 0;
    for (const o of orders.filter((x) => x.status === 'FULFILLED')) {
      const tr = extractTrackingFromNote((o as any).fulfillmentNote);
      if (tr.supplierOrderId) withSupplierId++;
      if (tr.trackingHint) withTracking++;
    }
    items.push(
      ...verifyTracking({
        fulfilledOrders: ordersFulfilled,
        withSupplierId,
        withTracking,
      }),
    );

    const summary = summarizeVerification(items);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 61,
      ...summary,
      inventoryDryRun: { toPause: inv.toPause, sample: inv.results.slice(0, 5) },
      nextActions: summary.ok
        ? [
            'Mantén HTTPS fijo (no túnel efímero)',
            'Haz 1 pedido real de prueba y revisa /orders',
            'POST /real/inventory/apply-pauses si quieres pausar stock 0',
          ]
        : summary.items.filter((i) => !i.ok && i.severity === 'critical').map((i) => i.message),
    };
  }

  @Post('webhook/hmac-test')
  hmacTest(@Body() body: any, @Headers('x-shopify-hmac-sha256') hmac?: string) {
    const raw = JSON.stringify(body ?? {});
    const ok = testWebhookHmac(raw, hmac);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 37,
      ok,
      note: ok ? 'Firma válida' : 'Firma inválida o secret ausente',
    };
  }

  @Post('inventory/apply-pauses')
  async applyPauses(@Body() body: { dryRun?: boolean }) {
    const dryRun = body?.dryRun !== false;
    const products = await prisma.product.findMany({ take: 200 });
    const inv = applyInventoryPolicy(
      products.map((p) => ({
        productId: p.id,
        stock: (p as any).stock ?? null,
        status: p.status,
      })),
    );
    const paused: string[] = [];
    if (!dryRun) {
      for (const id of inv.toPause) {
        await prisma.product.update({ where: { id }, data: { status: 'PAUSED' } });
        await writeAudit('AUTO_PAUSE_STOCK', 'Product', id, { reason: 'stock_zero' });
        paused.push(id);
      }
    }
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 39,
      dryRun,
      toPause: inv.toPause,
      paused,
      results: inv.results,
    };
  }

  @Post('tracking/scan')
  async trackingScan() {
    const orders = await prisma.order.findMany({
      where: { status: 'FULFILLED' },
      take: 100,
      orderBy: { updatedAt: 'desc' },
    });
    const items = orders.map((o) => {
      const tr = extractTrackingFromNote((o as any).fulfillmentNote);
      return {
        orderId: o.id,
        orderNumber: (o as any).orderNumber,
        ...tr,
        fulfillmentNote: (o as any).fulfillmentNote,
      };
    });
    await writeAudit('TRACKING_SCAN', 'Order', 'batch', { count: items.length });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 61, count: items.length, items };
  }
}


@Controller('catalog')
class CatalogQualityController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...CATALOG_QUALITY_META };
  }

  @Get('verify')
  async verify() {
    const products = await prisma.product.findMany({
      take: 300,
      include: { suppliers: true },
    });
    const published = products.filter((p) => p.status === 'PUBLISHED');
    const pending = products.filter((p) => p.status === 'PENDING_APPROVAL');
    const orphan = countOrphanPublished(products as any);

    const titles = published.map((p) => p.title);
    // sample margin on first published with supplier costs
    let sampleMarginOk = true;
    let sampleMarginPct: number | undefined;
    const sample = published.find((p) => (p.suppliers || []).length > 0);
    if (sample) {
      const s = sample.suppliers[0] as any;
      const sale = Number(sample.salePrice || 0);
      const cost = Number(s.productCost || 0);
      const ship = Number(s.shippingCost || 0);
      if (sale > 0) {
        const m = marginAfterFees({
          salePrice: sale,
          productCost: cost,
          shippingCost: ship,
        });
        sampleMarginOk = m.ok;
        sampleMarginPct = m.marginPct;
      }
    }

    const items = verifyCatalogQuality({
      publishedTitles: titles,
      orphanPublished: orphan.orphans,
      published: orphan.published,
      pendingApproval: pending.length,
      sampleMarginOk,
      sampleMarginPct,
    });
    const summary = summarizeQuality(items);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 61,
      ...summary,
      orphan,
      pendingApproval: pending.length,
      nextActions: summary.ok
        ? ['Opcional: POST /catalog/clean-titles dryRun',
           'Revisar PENDING_APPROVAL y go-live selectivo']
        : summary.items.filter((i) => !i.ok).map((i) => i.message),
    };
  }

  @Post('clean-title')
  cleanOne(@Body() body: { title?: string }) {
    const raw = body?.title || '';
    const q = titleQualityScore(raw);
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 41,
      raw,
      ...q,
    };
  }

  @Post('clean-titles')
  async cleanTitles(@Body() body: { dryRun?: boolean; limit?: number }) {
    const dryRun = body?.dryRun !== false;
    const limit = Math.min(Number(body?.limit || 50), 100);
    const products = await prisma.product.findMany({
      where: { status: { in: ['PUBLISHED', 'PENDING_APPROVAL', 'DRAFT'] } },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });
    const changes: { id: string; from: string; to: string; score: number }[] = [];
    for (const p of products) {
      const q = titleQualityScore(p.title);
      if (q.cleaned && q.cleaned !== p.title && q.score < 85) {
        changes.push({ id: p.id, from: p.title, to: q.cleaned, score: q.score });
        if (!dryRun) {
          await prisma.product.update({
            where: { id: p.id },
            data: { title: q.cleaned },
          });
          await writeAudit('TITLE_CLEANED', 'Product', p.id, {
            from: p.title,
            to: q.cleaned,
          });
        }
      }
    }
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 41,
      dryRun,
      scanned: products.length,
      changes: changes.length,
      items: changes.slice(0, 30),
    };
  }

  @Post('cj-gate')
  async cjGate(@Body() body: { productId: string }) {
    const p = await prisma.product.findUnique({
      where: { id: body.productId },
      include: { suppliers: true },
    });
    if (!p) return { error: 'not_found' };
    const s = (p.suppliers || []).find((x: any) => x.isPrimary) || p.suppliers[0];
    const gate = strictCjGate({
      status: p.status,
      cjVariantId: s?.cjVariantId,
      cjSku: s?.cjSku,
      stock: s?.stock,
      verified: true,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 42, productId: p.id, gate, supplier: s };
  }

  @Post('price-cop')
  priceCop(
    @Body()
    body: {
      productCostUsd: number;
      shippingUsd?: number;
      targetMarginPct?: number;
    },
  ) {
    const result = priceFromUsdCost({
      productCostUsd: Number(body?.productCostUsd || 0),
      shippingUsd: body?.shippingUsd,
      targetMarginPct: body?.targetMarginPct,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 43, ...result };
  }

  @Post('margin-check')
  marginCheck(
    @Body()
    body: {
      salePrice: number;
      productCost: number;
      shippingCost: number;
    },
  ) {
    const m = marginAfterFees({
      salePrice: Number(body.salePrice),
      productCost: Number(body.productCost),
      shippingCost: Number(body.shippingCost),
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 43, ...m };
  }

  @Post('approval-policy')
  approvalPolicy(
    @Body()
    body: {
      createdToday?: number;
      confidence?: number;
      isFirstPublication?: boolean;
    },
  ) {
    const policy = approvalQueuePolicy({
      createdToday: Number(body?.createdToday || 0),
      confidence: Number(body?.confidence || 80),
      isFirstPublication: body?.isFirstPublication,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 61, policy };
  }
}


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
      block: 61,
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
      block: 61,
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


@Controller('release')
class ReleaseController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...RELEASE_META };
  }

  @Get('verify')
  async verify() {
    const mode = process.env.ECOM_MODE || 'MOCK';
    const products = await prisma.product.findMany({ take: 400, include: { suppliers: true } });
    const orders = await prisma.order.findMany({ take: 400 });
    const published = products.filter((p) => p.status === 'PUBLISHED');
    const pending = products.filter((p) => p.status === 'PENDING_APPROVAL');
    const paid = orders.filter((o) => o.status === 'PAID');
    const fulfilled = orders.filter((o) => o.status === 'FULFILLED');
    const orphanPublished = published.filter(
      (p) => !(p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    const https = httpsMonitor();
    const webhook = webhookReadiness();

    // light reconcile sample (HEAD product existence) — only first 15 live ids
    let missingOnShopify = 0;
    const shop = (process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '').trim();
    const token = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
    const host = shop.includes('.') ? shop : shop ? `${shop}.myshopify.com` : '';
    const apiVersion = process.env.SHOPIFY_API_VERSION || '2026-07';
    if (host && token) {
      const sample = published
        .filter((p) => p.externalId && !String(p.externalId).startsWith('mock-'))
        .slice(0, 15);
      for (const p of sample) {
        try {
          const res = await fetch(
            `https://${host}/admin/api/${apiVersion}/products/${p.externalId}.json`,
            { headers: { 'X-Shopify-Access-Token': token }, method: 'GET' },
          );
          if (res.status === 404) missingOnShopify++;
        } catch {
          /* ignore network blips in verify */
        }
      }
    }

    const summary = verifyRelease({
      missingOnShopify,
      pendingApproval: pending.length,
      paidUnfulfilled: paid.length,
      orphanPublished,
      killSwitch:
        process.env.ECOM_KILL_SWITCH === 'true' || process.env.ECOM_PAUSE_ALL === 'true',
      httpsOk: https.ok,
      webhookOk: webhook.ok,
      published: published.length,
      paid: paid.length,
      fulfilled: fulfilled.length,
      catalogScore: 100,
      hardeningScore: 100,
    });

    return {
      mode,
      block: 61,
      ...summary,
      nextActions: summary.readyForSandboxOps
        ? [
            'Ops SANDBOX listo',
            'Revisar cola: GET /release/approvals',
            'Reconcile: POST /release/reconcile-shopify {"dryRun":true}',
            'REAL solo con ECOM_REAL_CONFIRM + /hardening/real-gate',
          ]
        : summary.items.filter((i) => !i.ok).map((i) => i.message),
    };
  }

  @Get('approvals')
  async approvals() {
    const products = await prisma.product.findMany({
      where: { status: 'PENDING_APPROVAL' },
      take: 50,
      include: { suppliers: true },
      orderBy: { updatedAt: 'desc' },
    });
    const ranked = rankApprovalQueue(
      products.map((p) => ({
        id: p.id,
        title: p.title,
        opportunityScore: p.opportunityScore,
        confidence: p.confidence,
        marginPercent: p.marginPercent as any,
        hasCj: (p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
        status: p.status,
      })),
    );
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 54,
      count: ranked.length,
      items: ranked,
    };
  }

  @Get('https')
  https() {
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 55, ...httpsMonitor() };
  }

  @Get('webhook')
  webhook() {
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 56, ...webhookReadiness() };
  }

  @Get('pipeline')
  async pipeline() {
    const products = await prisma.product.findMany({ take: 500 });
    const orders = await prisma.order.findMany({ take: 500 });
    const snap = pipelineSnapshot({
      detected: products.filter((p) => p.status === 'DETECTED').length,
      evaluating: products.filter((p) => p.status === 'EVALUATING').length,
      pending: products.filter((p) => p.status === 'PENDING_APPROVAL').length,
      published: products.filter((p) => p.status === 'PUBLISHED').length,
      paused: products.filter((p) => p.status === 'PAUSED').length,
      paid: orders.filter((o) => o.status === 'PAID').length,
      fulfilled: orders.filter((o) => o.status === 'FULFILLED').length,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 57, ...snap };
  }

  @Get('checklist')
  async checklist() {
    const products = await prisma.product.findMany({ take: 400, include: { suppliers: true } });
    const orders = await prisma.order.findMany({ take: 400 });
    const published = products.filter((p) => p.status === 'PUBLISHED');
    const items = dailyOperatorChecklist({
      pendingApproval: products.filter((p) => p.status === 'PENDING_APPROVAL').length,
      paidUnfulfilled: orders.filter((o) => o.status === 'PAID').length,
      orphanPublished: published.filter(
        (p) => !(p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
      ).length,
      killSwitch:
        process.env.ECOM_KILL_SWITCH === 'true' || process.env.ECOM_PAUSE_ALL === 'true',
      httpsOk: httpsMonitor().ok,
    });
    return { mode: process.env.ECOM_MODE || 'MOCK', block: 59, items };
  }

  @Post('reconcile-shopify')
  async reconcile(@Body() body: { dryRun?: boolean; limit?: number; clearMissing?: boolean }) {
    const dryRun = body?.dryRun !== false;
    const clearMissing = body?.clearMissing === true;
    const limit = Math.min(Number(body?.limit || 20), 40);
    const shop = (process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '').trim();
    const token = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
    if (!shop || !token) {
      return { error: 'missing_shopify_creds' };
    }
    const host = shop.includes('.') ? shop : `${shop}.myshopify.com`;
    const apiVersion = process.env.SHOPIFY_API_VERSION || '2026-07';

    const products = await prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });

    const results: any[] = [];
    for (const p of products) {
      const base = classifyShopifyLink({ externalId: p.externalId, shopifyExists: null });
      if (!p.externalId || String(p.externalId).startsWith('mock-')) {
        results.push({ productId: p.id, externalId: p.externalId, ...base, ok: true });
        continue;
      }
      try {
        const res = await fetch(
          `https://${host}/admin/api/${apiVersion}/products/${p.externalId}.json`,
          { headers: { 'X-Shopify-Access-Token': token } },
        );
        if (res.status === 404) {
          const cls = classifyShopifyLink({ externalId: p.externalId, shopifyExists: false });
          if (!dryRun && clearMissing) {
            await prisma.product.update({
              where: { id: p.id },
              data: { externalId: null, status: 'PENDING_APPROVAL' },
            });
            await writeAudit('SHOPIFY_RECONCILE_CLEAR', 'Product', p.id, {
              externalId: p.externalId,
            });
            results.push({ productId: p.id, externalId: p.externalId, ...cls, cleared: true, ok: true });
          } else {
            results.push({ productId: p.id, externalId: p.externalId, ...cls, ok: true, dryRun });
          }
        } else if (res.ok) {
          results.push({
            productId: p.id,
            externalId: p.externalId,
            ...classifyShopifyLink({ externalId: p.externalId, shopifyExists: true }),
            ok: true,
          });
        } else {
          results.push({
            productId: p.id,
            externalId: p.externalId,
            status: 'error',
            http: res.status,
            ok: false,
          });
        }
      } catch (e: any) {
        results.push({ productId: p.id, externalId: p.externalId, ok: false, error: e?.message || String(e) });
      }
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 53,
      dryRun,
      clearMissing,
      scanned: results.length,
      missing: results.filter((r) => r.status === 'missing_on_shopify').length,
      results,
    };
  }
}


@Controller('creative')
class CreativeController {
  @Get('meta')
  meta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...CONTENT_META };
  }

  @Post('brief')
  async brief(
    @Body()
    body: {
      title?: string;
      productId?: string;
      facts?: string;
      category?: string;
      forceMock?: boolean;
      persist?: boolean;
    },
  ) {
    try {
      let rawTitle = body?.title || '';
      let facts = body?.facts || '';
      let product: any = null;
      let salePrice: number | undefined;
      let currency = 'COP';

      if (body?.productId) {
        product = await prisma.product.findUnique({
          where: { id: body.productId },
          include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
        });
        if (!product) return { error: 'not_found' };
        rawTitle = product.title;
        const primary = product.suppliers?.[0];
        const productCost = primary?.productCost != null ? Number(primary.productCost) : null;
        const shippingCost = primary?.shippingCost != null ? Number(primary.shippingCost) : null;
        const stock = primary?.stock ?? null;
        salePrice = product.salePrice != null ? Number(product.salePrice) : undefined;
        currency = product.currency || 'COP';
        facts =
          facts ||
          `precio=${salePrice ?? 'n/a'} ${currency}; costo=${productCost ?? 'n/a'}; envio=${shippingCost ?? 'n/a'}; stock=${stock ?? 'n/a'}; margen=${product.marginPercent ?? 'n/a'}`;
      }

      if (!rawTitle) return { error: 'title_or_productId_required' };

      const result = await generateCreativeBrief({
        rawTitle,
        facts,
        category: body?.category,
        countryCode: 'CO',
        currency,
        salePrice,
        forceMock: body?.forceMock === true,
      });

      const validation = validateBrief(result.brief);

      if (body?.persist && product) {
        await prisma.product.update({
          where: { id: product.id },
          data: {
            title: result.brief.title,
            description: result.brief.description,
          },
        });
        await writeAudit('CREATIVE_BRIEF', 'Product', product.id, {
          source: result.brief.source,
          provider: result.brief.provider,
          niche: result.brief.niche,
        });
      }

      return {
        mode: process.env.ECOM_MODE || 'MOCK',
        block: 61,
        productId: product?.id || null,
        validation,
        brief: result.brief,
        aiMeta: result.ai
          ? {
              provider: result.ai.provider,
              model: result.ai.model,
              mock: result.ai.mock,
              latencyMs: result.ai.latencyMs,
              error: result.ai.error,
            }
          : null,
      };
    } catch (e: any) {
      console.error('[creative/brief]', e?.message || e);
      return {
        mode: process.env.ECOM_MODE || 'MOCK',
        block: 61,
        error: 'brief_failed',
        message: e?.message || String(e),
      };
    }
  }


  @Get('media-meta')
  mediaMeta() {
    return { mode: process.env.ECOM_MODE || 'MOCK', ...MEDIA_META };
  }

  /** Block 62: image assets from brief mediaPlan or explicit plan */
  @Post('images')
  async images(
    @Body()
    body: {
      productId?: string;
      mediaPlan?: any;
      forceLive?: boolean;
      forceMock?: boolean;
    },
  ) {
    let plan = body?.mediaPlan;
    let title = 'Producto';
    if (!plan && body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!p) return { error: 'not_found' };
      title = p.title;
      const brief = await generateCreativeBrief({
        rawTitle: p.title,
        forceMock: true,
      });
      plan = brief.brief.mediaPlan;
    }
    if (!plan) {
      const brief = await generateCreativeBrief({
        rawTitle: title,
        forceMock: true,
      });
      plan = brief.brief.mediaPlan;
    }
    const result = generateImageAssets(plan, {
      forceLive: body?.forceLive === true && body?.forceMock !== true,
      productTitle: title,
    });
    await writeAudit('MEDIA_IMAGES', 'Media', body?.productId || 'adhoc', {
      count: result.assets.length,
      mock: result.mock,
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 62,
      ...result,
    };
  }

  /** Block 63: video asset slots */
  @Post('videos')
  async videos(
    @Body()
    body: { productId?: string; mediaPlan?: any; forceLive?: boolean },
  ) {
    let plan = body?.mediaPlan;
    if (!plan && body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!p) return { error: 'not_found' };
      const brief = await generateCreativeBrief({
        rawTitle: p.title,
        forceMock: true,
      });
      plan = brief.brief.mediaPlan;
    }
    if (!plan) {
      const brief = await generateCreativeBrief({
        rawTitle: 'Producto',
        forceMock: true,
      });
      plan = brief.brief.mediaPlan;
    }
    const result = generateVideoAssets(plan, { forceLive: Boolean(body?.forceLive) });
    await writeAudit('MEDIA_VIDEOS', 'Media', body?.productId || 'adhoc', {
      count: result.assets.length,
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 63,
      ...result,
    };
  }

  /** Block 64: landing HTML + image pack */
  @Post('pack')
  async pack(
    @Body()
    body: {
      productId?: string;
      forceMock?: boolean;
    },
  ) {
    if (!body?.productId) return { error: 'productId_required' };
    const p = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!p) return { error: 'not_found' };
    const brief = await generateCreativeBrief({
      rawTitle: p.title,
      forceMock: body?.forceMock !== false,
      salePrice: p.salePrice != null ? Number(p.salePrice) : undefined,
      currency: p.currency || 'COP',
    });
    const images = generateImageAssets(brief.brief.mediaPlan, {
      productTitle: brief.brief.productName,
    });
    const videos = generateVideoAssets(brief.brief.mediaPlan);
    let shopifyUrl: string | undefined;
    if (p.externalId) {
      const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '';
      if (shop) {
        shopifyUrl =
          'https://' +
          String(shop).replace(/^https?:\/\//, '') +
          '/products/' +
          p.externalId;
      }
    }
    const pack = buildLandingPack({
      title: brief.brief.title,
      description: brief.brief.description,
      salePrice: p.salePrice != null ? Number(p.salePrice) : undefined,
      currency: p.currency || 'COP',
      imageAssets: images.assets,
      videoAssets: videos.assets,
      shopifyUrl,
      countryCode: 'CO',
    });
    await writeAudit('MEDIA_PACK', 'Product', p.id, {
      imageCount: pack.imageCount,
      videoPending: pack.videoPending,
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 64,
      productId: p.id,
      brief: {
        productName: brief.brief.productName,
        title: brief.brief.title,
        niche: brief.brief.niche,
      },
      images: images.assets,
      videos: videos.assets,
      landing: pack,
    };
  }

  /** Block 65: pre-sale checklist */
  @Get('pre-sale')
  async preSale() {
    const products = await prisma.product.findMany({
      take: 300,
      include: { suppliers: true },
    });
    const publishedWithCj = products.filter(
      (p) =>
        p.status === 'PUBLISHED' &&
        (p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    const pendingApprovals = products.filter((p) => p.status === 'PENDING_APPROVAL').length;
    const apiUrl = process.env.API_URL || process.env.APP_URL || '';
    const checklist = preSaleChecklist({
      mode: process.env.ECOM_MODE || 'MOCK',
      shopifyLive: String(process.env.SHOPIFY_ACCESS_TOKEN || '').length > 5,
      cjLive: String(process.env.CJ_API_KEY || '').length > 5,
      httpsPublic: /^https:\/\//i.test(apiUrl),
      webhookSecret: String(process.env.SHOPIFY_WEBHOOK_SECRET || '').length > 3,
      publishedWithCj,
      pendingApprovals,
      hasMediaPlan: true,
      hasImageMocks: true,
      killSwitch:
        process.env.ECOM_KILL_SWITCH === 'true' || process.env.ECOM_PAUSE_ALL === 'true',
    });
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 65,
      ...MEDIA_META,
      ...checklist,
      next:
        checklist.canAttemptFirstSale
          ? [
              '1) Elige producto PUBLISHED con CJ',
              '2) Verifica webhook HTTPS',
              '3) Pedido de prueba real en Shopify',
              '4) Confirma fulfill + tracking',
            ]
          : checklist.items.filter((i) => !i.ok).map((i) => i.message),
    };
  }

  @Post('landing-preview')
  async landingPreview(
    @Body() body: { productId?: string; title?: string; description?: string; imageUrl?: string },
  ) {
    let title = body?.title || 'Producto';
    let description = body?.description || '';
    let salePrice: any = null;
    let currency = 'COP';
    let imageUrl = body?.imageUrl || null;

    if (body?.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!p) return { error: 'not_found' };
      title = p.title;
      description = p.description || description;
      salePrice = p.salePrice;
      currency = p.currency || 'COP';
    }

    const html = buildLandingHtml({
      title,
      description,
      salePrice,
      currency,
      imageUrl,
      countryCode: 'CO',
    });

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 61,
      html,
      bytes: html.length,
    };
  }
}



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


@Controller('autonomy')
class AutonomyController {
  @Get('meta')
  meta() {
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...AUTONOMY_META,
      autoGoLive: isAutoGoLiveEnabled(),
      publishCap: dailyPublishCap(),
    };
  }

  @Get('board')
  async board() {
    const products = await prisma.product.findMany({ take: 400, include: { suppliers: true } });
    const orders = await prisma.order.findMany({ take: 200 });
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const publishedToday = await prisma.product.count({
      where: { status: 'PUBLISHED', updatedAt: { gte: start } },
    });
    const published = products.filter((p) => p.status === 'PUBLISHED');
    const withCj = published.filter((p) =>
      (p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 75,
      ...autonomyBoard({
        mode: process.env.ECOM_MODE || 'MOCK',
        published: published.length,
        draft: products.filter((p) => p.status === 'DRAFT').length,
        pendingApproval: products.filter((p) => p.status === 'PENDING_APPROVAL').length,
        publishedWithCj: withCj,
        paidUnfulfilled: orders.filter((o) => o.status === 'PAID').length,
        autoApproveOn: String(process.env.ECOM_AUTO_APPROVE_CJ || '').toLowerCase() === 'true',
        autoGoLiveOn: isAutoGoLiveEnabled(),
        shopifyLive: String(process.env.SHOPIFY_ACCESS_TOKEN || '').length > 5,
        cjLive: String(process.env.CJ_API_KEY || '').length > 5,
        killSwitch:
          process.env.ECOM_KILL_SWITCH === 'true' || process.env.ECOM_PAUSE_ALL === 'true',
        publishedToday,
      }),
    };
  }

  @Get('smoke')
  async smoke() {
    const products = await prisma.product.findMany({ take: 300, include: { suppliers: true } });
    const orders = await prisma.order.findMany({ take: 200 });
    const publishedWithCj = products.filter(
      (p) =>
        p.status === 'PUBLISHED' &&
        (p.suppliers || []).some((s: any) => s.cjVariantId || s.cjSku),
    ).length;
    const apiUrl = process.env.API_URL || process.env.APP_URL || '';
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      ...firstSaleSmoke({
        shopifyLive: String(process.env.SHOPIFY_ACCESS_TOKEN || '').length > 5,
        cjLive: String(process.env.CJ_API_KEY || '').length > 5,
        publishedWithCj,
        hasDraftApproved: products.some((p) => p.status === 'DRAFT'),
        paidOrders: orders.filter((o) => o.status === 'PAID').length,
        fulfilledOrders: orders.filter((o) => o.status === 'FULFILLED').length,
        webhookSecret: String(process.env.SHOPIFY_WEBHOOK_SECRET || '').length > 3,
        httpsPublic: /^https:\/\//i.test(apiUrl),
      }),
    };
  }

  /** Block 70: batch go-live for DRAFT products with CJ (respects daily cap if auto flag on; manual always limited) */
  @Post('go-live-batch')
  async goLiveBatch(
    @Body()
    body: { limit?: number; note?: string; requireAutoFlag?: boolean },
  ) {
    const limit = Math.min(Number(body?.limit || 1), 5);
    const requireFlag = body?.requireAutoFlag === true;
    if (requireFlag && !isAutoGoLiveEnabled()) {
      return {
        error: 'disabled',
        message: 'ECOM_AUTO_GO_LIVE=false. Quita requireAutoFlag o actívalo en .env',
      };
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const publishedToday = await prisma.product.count({
      where: { status: 'PUBLISHED', updatedAt: { gte: start } },
    });
    const gate = publishBudgetGate({
      publishedToday,
      killSwitch:
        process.env.ECOM_KILL_SWITCH === 'true' || process.env.ECOM_PAUSE_ALL === 'true',
    });
    // Manual batch allowed even if auto flag off, but still respect kill switch + soft cap
    if (gate.reason === 'kill_switch') {
      return { error: 'kill_switch', gate };
    }
    const softCap = requireFlag ? gate.remaining : Math.min(limit, dailyPublishCap());
    const max = Math.min(limit, softCap > 0 ? softCap : limit);

    const drafts = await prisma.product.findMany({
      where: { status: 'DRAFT' },
      take: 40,
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    });

    const results: any[] = [];
    for (const p of drafts) {
      if (results.filter((r) => r.published).length >= max) break;
      const e = enrichProduct(p);
      if (!(e.cjVariantId || e.cjSku) || e.shouldPause || !e.canPublish) {
        results.push({ productId: p.id, published: false, reason: 'rules_or_no_cj' });
        continue;
      }
      // Reuse go-live logic via internal approval + publishProduct
      try {
        const admin = await prisma.user.findFirst({ where: { email: 'admin@ecom.local' } });
        let approval = await prisma.approval.findFirst({
          where: { productId: p.id, status: 'APPROVED' },
        });
        if (!approval) {
          approval = await prisma.approval.create({
            data: {
              productId: p.id,
              requestedBy: admin?.id ?? 'system',
              action: 'FIRST_PUBLICATION',
              reason: body?.note || 'batch go-live 67-75',
              status: 'APPROVED',
              decidedAt: new Date(),
              metadata: { via: 'go-live-batch' },
            },
          });
        }
        const liveTitle = cleanProductTitle(e.title);
        const imageUrls = await resolveCjImageUrls(liveTitle, e.cjSku);
        const pub = await publishProduct({
          title: liveTitle,
          description: e.description || liveTitle,
          price: e.salePrice,
          currency: e.currency,
          sku: e.cjSku || `ECOM-${p.id.slice(-8)}`,
          inventory: e.stock,
          imageUrls,
        });
        if (!pub.ok) {
          results.push({ productId: p.id, published: false, error: pub.error || 'publish_failed' });
          continue;
        }
        await prisma.product.update({
          where: { id: p.id },
          data: {
            status: 'PUBLISHED',
            externalId: pub.externalId,
            isFirstPublication: false,
            title: liveTitle,
            sourceMode: pub.mock ? 'MOCK' : MODE_ENUM,
          },
        });
        await writeAudit('BATCH_GO_LIVE', 'Product', p.id, { externalId: pub.externalId });
        results.push({
          productId: p.id,
          published: true,
          externalId: pub.externalId,
          adminUrl: pub.adminUrl,
          title: liveTitle.slice(0, 60),
        });
      } catch (err: any) {
        results.push({ productId: p.id, published: false, error: err?.message || String(err) });
      }
    }

    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      block: 70,
      max,
      publishedToday,
      published: results.filter((r) => r.published).length,
      results,
      note: 'Batch go-live (67-75). Prefer limit=1 la primera vez.',
    };
  }
}


@Module({
  controllers: [PhaseAController, AutonomyController, CreativeController, ReleaseController, HardeningController, CatalogQualityController, RealCloseController, SeoController, AdsController, DeployController, TrendsController, MarketingController, AnalyticsController, ScoringController, ContentController, DashboardController, OpsController, 
    HealthController,
    DiscoveryController,
    JobsController,
    AlertsController,
    AgentsController,
    AgentRunsController,
    OrchestratorController,
    CjController,
    ShopifyController,
    OrdersController,
    AiController,
    ProductsController,
    ApprovalsController,
    AuditController,
    AuthController,
  ],
  providers: [RulesService],
})
class AppModule {}

async function bootstrap() {
  await ensureSeed();
  try {
    await startWorkers({
      onDiscovery: async (data) => {
        const store = await prisma.store.findFirst();
        if (!store) return { error: 'no_store' };
        const found = await discoverCandidates({
          limit: data.limit ?? 5,
          includeWeak: Boolean(data.includeWeak),
        });
        const onlyPass = data.onlyPassingFilters !== false;
        const created: any[] = [];
        for (const c of found.items) {
          const filters = candidatePassesHardFilters(c);
          if (onlyPass && !filters.ok) continue;
          const r = await ingestCandidate(store.id, c, Boolean(data.runPipeline));
          if (!r.skipped) created.push(r.productId);
        }
        await writeAudit('JOB_DISCOVERY_DONE', 'Queue', store.id, { created: created.length });
        return { created: created.length, ids: created };
      },
      onPipeline: async (data) => {
        const p = await prisma.product.findUnique({
          where: { id: data.productId },
          include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
        });
        if (!p) return { error: 'not_found' };
        const enriched = enrichProduct(p);
        const result = await runProductPipeline({
          title: enriched.title,
          salePrice: enriched.salePrice,
          productCost: enriched.productCost,
          shippingCost: enriched.shippingCost,
          stock: enriched.stock,
          opportunityScore: enriched.opportunityScore ?? 0,
          confidence: enriched.confidence ?? 0,
          supplierName: enriched.supplierName,
          supplierVerified: enriched.verified,
          isFirstPublication: enriched.isFirstPublication,
          currency: enriched.currency,
          skipAiCopy: data.skipAiCopy !== false,
        });
        await saveAgentRun(result, { productId: p.id, storeId: p.storeId });
        return { status: result.status, traceId: result.traceId };
      },
    });
  } catch (e: any) {
    console.warn('[queue] workers not started:', e?.message);
  }
  try {
    startDiscoveryScheduler();
  void alertOps('BOOT', { service: 'ecom-api', block: 75 });
  } catch (e: any) {
    console.warn('[queue] scheduler not started:', e?.message);
  }
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.APP_URL ?? 'http://localhost:3000' });
  await app.listen(Number(process.env.API_PORT ?? 4000));
  console.log(`ECOM API block-81 (phase-A verify) on ${process.env.API_PORT ?? 4000} mode=${MODE}`);
}

void bootstrap();
