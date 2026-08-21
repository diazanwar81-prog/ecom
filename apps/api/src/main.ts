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
} from '../../../packages/shopify/src/index';
import { getCjStatus, fulfillOrder } from '../../../packages/cj/src/index';
import {
  runProductPipeline,
  getOrchestratorMeta,
  listAgents,
  type CandidateInput,
} from '../../../packages/orchestrator/src/index';
import { prisma, ProductStatus, ApprovalStatus, RuntimeMode } from '../../../packages/database/src/index';

const MODE = (process.env.ECOM_MODE ?? 'MOCK') as 'MOCK' | 'SANDBOX' | 'REAL';
const MODE_ENUM = (MODE === 'REAL' ? 'REAL' : MODE === 'SANDBOX' ? 'SANDBOX' : 'MOCK') as RuntimeMode;

function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = typeof v === 'object' && v !== null && 'toNumber' in v ? (v as any).toNumber() : Number(v);
  return Number.isFinite(n) ? n : fallback;
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
    marginPercent: margin.marginPercent,
    marginBand: margin.band,
    canPublish: margin.canPublish && !stockDec.shouldPause,
    shouldPause: margin.shouldPause || stockDec.shouldPause,
    autoPublish: auto,
    priceChangesToday: p.priceChangesToday ?? 0,
    description: p.description,
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
      block: 8,
      aiRouter: true,
      orchestrator: true,
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

@Controller('agents')
class AgentsController {
  @Get()
  list() {
    return { mode: MODE, ...getOrchestratorMeta() };
  }
}

@Controller('orchestrator')
class OrchestratorController {
  @Get('status')
  status() {
    return getOrchestratorMeta();
  }

  /** Evaluate a candidate without persisting (dry-run pipeline) */
  @Post('run')
  async run(@Body() body: CandidateInput & { skipAiCopy?: boolean }) {
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
      skipAiCopy: body.skipAiCopy !== false, // default skip AI for speed unless false
    });
    await writeAudit('ORCHESTRATOR_RUN', 'Orchestrator', result.traceId, {
      status: result.status,
      title: result.productTitle,
      margin: result.marginPercent,
    });
    return { mode: MODE, result };
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
    if (secret && !hmac) {
      return { error: 'missing_hmac' };
    }
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
    return { mode: MODE, order, received: true };
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
    if (order.status === 'FULFILLED') {
      return { error: 'already_fulfilled', order };
    }

    const items = (order.lineItems as any[]) || [];
    const first = items[0] || { title: 'Producto', quantity: 1 };

    const result = await fulfillOrder({
      orderId: order.id,
      orderNumber: order.orderNumber,
      productTitle: first.title || 'Producto',
      quantity: first.quantity || 1,
      shippingCountry: 'CO',
    });

    if (!result.ok) {
      await writeAudit('FULFILL_FAILED', 'Order', id, result);
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

    return {
      mode: MODE,
      fulfilled: true,
      mock: result.mock,
      order: updated,
      cj: result,
      note: result.mock
        ? 'Fulfillment MOCK — sin pedido real a CJ.'
        : 'Fulfillment enviado a CJ',
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

  /** Run multi-agent pipeline on an existing product */
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

    if (result.suggestedDescription) {
      await prisma.product.update({
        where: { id },
        data: {
          description: result.suggestedDescription.slice(0, 4000),
          marginPercent: result.marginPercent,
          status:
            result.status === 'BLOCKED'
              ? 'REJECTED'
              : result.status === 'NEEDS_APPROVAL'
                ? 'PENDING_APPROVAL'
                : p.status,
        },
      });
    } else {
      await prisma.product.update({
        where: { id },
        data: { marginPercent: result.marginPercent },
      });
    }

    await writeAudit('PRODUCT_PIPELINE', 'Product', id, {
      status: result.status,
      traceId: result.traceId,
      margin: result.marginPercent,
    });

    return { mode: MODE, productId: id, result };
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

    const result = await publishProduct({
      title: enriched.title,
      description: enriched.description,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku: `ECOM-${id.slice(-8)}`,
      inventory: enriched.stock,
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
    const items = await prisma.approval.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    return { mode: MODE, count: items.length, items };
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

@Module({
  controllers: [
    HealthController,
    AgentsController,
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
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.APP_URL ?? 'http://localhost:3000' });
  await app.listen(Number(process.env.API_PORT ?? 4000));
  console.log(`ECOM API block-8 (orchestrator) on ${process.env.API_PORT ?? 4000} mode=${MODE}`);
}

void bootstrap();
