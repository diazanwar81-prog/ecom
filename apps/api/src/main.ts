import 'reflect-metadata';
import { Controller, Get, Module, Injectable, Post, Body, Param, Query } from '@nestjs/common';
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
    create: {
      email: 'admin@ecom.local',
      name: 'Administrador ECOM',
      role: 'ADMIN',
    },
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
    prisma.supplier.create({
      data: { name: 'CJ Mock Supplier', verified: true, apiEnabled: false },
    }),
    prisma.supplier.create({
      data: { name: 'AliExpress Mock', verified: true, apiEnabled: false },
    }),
    prisma.supplier.create({
      data: { name: 'Unverified Mock', verified: false, apiEnabled: false },
    }),
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

  // eslint-disable-next-line no-console
  console.log('Prisma seed: admin + store + 3 MOCK products');
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
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      service: 'ecom-api',
      mode: MODE,
      timestamp: new Date().toISOString(),
      block: 4,
      aiRouter: true,
      persistence: 'prisma',
      db,
    };
  }

  @Get('rules')
  rules() {
    return {
      mode: MODE,
      rules: RULES,
      description: {
        marginIdeal: '≥40%',
        marginMin: '≥35% para publicar',
        marginAlert: '30–34.99% alerta',
        pause: '<30% o stock=0',
        maxPriceChangesPerDay: 2,
        maxPriceVariationPercent: 10,
      },
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
  async complete(
    @Body()
    body: {
      prompt?: string;
      task?: string;
      messages?: Array<{ role: string; content: string }>;
    },
  ) {
    const messages =
      body.messages && body.messages.length > 0
        ? body.messages.map((m) => ({
            role: (m.role as 'system' | 'user' | 'assistant') || 'user',
            content: m.content,
          }))
        : [{ role: 'user' as const, content: body.prompt || 'Hola' }];

    const result = await aiComplete({
      messages,
      task: (body.task as any) || 'general',
    });

    await writeAudit('AI_COMPLETE', 'AiRouter', result.provider, {
      provider: result.provider,
      mock: result.mock,
      pending: result.pending,
      task: body.task,
    });

    return { mode: MODE, result };
  }

  @Post('product-copy')
  async productCopy(@Body() body: { title?: string; facts?: string; language?: string }) {
    const result = await generateProductCopy({
      title: body.title || 'Producto',
      facts: body.facts || '',
      language: body.language || 'es-CO',
    });

    await writeAudit('AI_PRODUCT_COPY', 'AiRouter', result.provider, {
      mock: result.mock,
      title: body.title,
    });

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
    const items = rows.map(enrichProduct);
    return { mode: MODE, persistence: 'prisma', count: items.length, items };
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

  @Post(':id/evaluate')
  async evaluate(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };

    const enriched = enrichProduct(p);
    const costs: CostBreakdown = {
      productCost: enriched.productCost,
      shippingCost: enriched.shippingCost,
    };
    const margin = this.rules.evaluateMargin(enriched.salePrice, costs);
    const stock = this.rules.evaluateStock(enriched.stock);

    await prisma.product.update({
      where: { id },
      data: { marginPercent: margin.marginPercent },
    });

    await writeAudit('PRODUCT_EVALUATED', 'Product', id, {
      margin: margin.marginPercent,
      band: margin.band,
    });

    const item = { ...enriched, marginPercent: margin.marginPercent, marginBand: margin.band };
    return {
      mode: MODE,
      item,
      evaluation: { margin, stock, auto: enriched.autoPublish },
    };
  }

  @Post(':id/request-approval')
  async requestApproval(
    @Param('id') id: string,
    @Body() body: { action: string; reason?: string },
  ) {
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

    await prisma.product.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });

    await writeAudit('APPROVAL_REQUESTED', 'Approval', approval.id, approval);

    return { mode: MODE, approval };
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
      facts: `costo ${enriched.productCost}, envío ${enriched.shippingCost}, stock ${enriched.stock}, proveedor ${enriched.supplierName}`,
      language: 'es-CO',
    });

    if (result.ok && result.text) {
      await prisma.product.update({
        where: { id },
        data: { description: result.text.slice(0, 4000) },
      });
    }

    await writeAudit('AI_PRODUCT_COPY', 'Product', id, {
      provider: result.provider,
      mock: result.mock,
    });

    return { mode: MODE, productId: id, result };
  }
}

@Controller('approvals')
class ApprovalsController {
  @Get()
  async list(@Query('status') status?: string) {
    const where = status ? { status: status as ApprovalStatus } : {};
    const items = await prisma.approval.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { mode: MODE, persistence: 'prisma', count: items.length, items };
  }

  @Post(':id/decide')
  async decide(
    @Param('id') id: string,
    @Body() body: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  ) {
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
        data: {
          status: decision === 'APPROVED' ? 'PUBLISHED' : 'REJECTED',
          isFirstPublication: decision === 'APPROVED' ? false : undefined,
        },
      });
    }

    await writeAudit(`APPROVAL_${decision}`, 'Approval', id, {
      note: body.note,
      productId: a.productId,
    });

    return { mode: MODE, approval, product };
  }
}

@Controller('audit')
class AuditController {
  @Get()
  async list(@Query('limit') limit = '50') {
    const n = Math.min(Number(limit) || 50, 200);
    const items = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: n,
    });
    return { mode: MODE, persistence: 'prisma', count: items.length, items };
  }
}

@Controller('auth')
class AuthController {
  @Get('me')
  async me() {
    const user = await prisma.user.findFirst({ where: { email: 'admin@ecom.local' } });
    return {
      mode: MODE,
      user: user
        ? { id: user.id, email: user.email, name: user.name, role: user.role }
        : null,
      note: 'Auth MOCK persistido en Prisma — password/RBAC en bloque siguiente',
    };
  }

  @Post('login')
  async login(@Body() body: { email?: string; password?: string }) {
    const email = body.email || 'admin@ecom.local';
    const user = await prisma.user.findFirst({ where: { email } });
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
  app.enableCors({
    origin: process.env.APP_URL ?? 'http://localhost:3000',
  });
  await app.listen(Number(process.env.API_PORT ?? 4000));
  // eslint-disable-next-line no-console
  console.log(`ECOM API block-4 (Prisma) on ${process.env.API_PORT ?? 4000} mode=${MODE}`);
}

void bootstrap();
