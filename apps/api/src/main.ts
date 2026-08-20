import 'reflect-metadata';
import { Controller, Get, Module, Injectable, Post, Body, Param, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  calculateMargin,
  decideStock,
  decidePriceChange,
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

const MODE = (process.env.ECOM_MODE ?? 'MOCK') as 'MOCK' | 'SANDBOX' | 'REAL';

const mockState = {
  products: [] as Array<Record<string, unknown>>,
  approvals: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  users: [
    {
      id: 'user-admin-1',
      email: 'admin@ecom.local',
      name: 'Administrador ECOM',
      role: 'ADMIN',
    },
  ],
};

function seedMockProducts() {
  if (mockState.products.length > 0) return;
  const samples = [
    {
      id: 'mock-prod-1',
      title: '[MOCK] Organizador de cocina plegable',
      status: 'EVALUATING',
      opportunityScore: 72,
      confidence: 88,
      salePrice: 89900,
      currency: 'COP',
      productCost: 32000,
      shippingCost: 12000,
      stock: 120,
      isFirstPublication: true,
      sourceMode: 'MOCK',
      supplierName: 'CJ Mock Supplier',
      verified: true,
    },
    {
      id: 'mock-prod-2',
      title: '[MOCK] Lámpara LED portátil',
      status: 'PENDING_APPROVAL',
      opportunityScore: 65,
      confidence: 96,
      salePrice: 125000,
      currency: 'COP',
      productCost: 48000,
      shippingCost: 15000,
      stock: 45,
      isFirstPublication: true,
      sourceMode: 'MOCK',
      supplierName: 'AliExpress Mock',
      verified: true,
    },
    {
      id: 'mock-prod-3',
      title: '[MOCK] Producto bajo margen',
      status: 'DETECTED',
      opportunityScore: 40,
      confidence: 70,
      salePrice: 50000,
      currency: 'COP',
      productCost: 38000,
      shippingCost: 8000,
      stock: 0,
      isFirstPublication: false,
      sourceMode: 'MOCK',
      supplierName: 'Unverified Mock',
      verified: false,
    },
  ];

  for (const s of samples) {
    const costs: CostBreakdown = {
      productCost: s.productCost,
      shippingCost: s.shippingCost,
    };
    const margin = calculateMargin({ salePrice: s.salePrice, costs });
    const stockDec = decideStock(s.stock);
    const auto = canAutoPublish({
      marginPercent: margin.marginPercent,
      opportunityScore: s.opportunityScore,
      confidence: s.confidence,
      hasVerifiedSupplier: s.verified,
      hasCriticalUnknownCost: false,
      isFirstPublication: s.isFirstPublication,
    });

    mockState.products.push({
      ...s,
      marginPercent: margin.marginPercent,
      marginBand: margin.band,
      canPublish: margin.canPublish && !stockDec.shouldPause,
      shouldPause: margin.shouldPause || stockDec.shouldPause,
      autoPublish: auto,
      priceChangesToday: 0,
    });

    mockState.audits.push({
      id: `audit-${s.id}`,
      action: 'PRODUCT_SEEDED',
      entityType: 'Product',
      entityId: s.id,
      runtimeMode: 'MOCK',
      metadata: { title: s.title },
      createdAt: new Date().toISOString(),
    });
  }
}

@Injectable()
class RulesService {
  evaluateMargin(salePrice: number, costs: CostBreakdown) {
    return calculateMargin({ salePrice, costs });
  }

  evaluateStock(stock: number | null) {
    return decideStock(stock);
  }

  evaluatePriceChange(current: number, proposed: number, changesToday: number, costs: CostBreakdown) {
    return decidePriceChange({ currentPrice: current, proposedPrice: proposed, changesToday, costs });
  }

  getConstants() {
    return RULES;
  }
}

@Controller()
class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'ecom-api',
      mode: MODE,
      timestamp: new Date().toISOString(),
      block: 3,
      aiRouter: true,
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

    mockState.audits.unshift({
      id: `audit-${Date.now()}`,
      action: 'AI_COMPLETE',
      entityType: 'AiRouter',
      entityId: result.provider,
      runtimeMode: MODE,
      metadata: {
        provider: result.provider,
        mock: result.mock,
        pending: result.pending,
        task: body.task,
      },
      createdAt: new Date().toISOString(),
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

    mockState.audits.unshift({
      id: `audit-${Date.now()}`,
      action: 'AI_PRODUCT_COPY',
      entityType: 'AiRouter',
      entityId: result.provider,
      runtimeMode: MODE,
      metadata: { mock: result.mock, title: body.title },
      createdAt: new Date().toISOString(),
    });

    return { mode: MODE, result };
  }
}

@Controller('products')
class ProductsController {
  constructor(private readonly rules: RulesService) {
    seedMockProducts();
  }

  @Get()
  list(@Query('status') status?: string) {
    let items = mockState.products;
    if (status) items = items.filter((p) => p.status === status);
    return {
      mode: MODE,
      count: items.length,
      items,
    };
  }

  @Get(':id')
  one(@Param('id') id: string) {
    const p = mockState.products.find((x) => x.id === id);
    if (!p) return { error: 'not_found', mode: MODE };
    return { mode: MODE, item: p };
  }

  @Post(':id/evaluate')
  evaluate(@Param('id') id: string) {
    const p = mockState.products.find((x) => x.id === id) as any;
    if (!p) return { error: 'not_found' };

    const costs: CostBreakdown = {
      productCost: Number(p.productCost),
      shippingCost: Number(p.shippingCost),
    };
    const margin = this.rules.evaluateMargin(Number(p.salePrice), costs);
    const stock = this.rules.evaluateStock(p.stock as number);
    const auto = canAutoPublish({
      marginPercent: margin.marginPercent,
      opportunityScore: p.opportunityScore as number,
      confidence: p.confidence as number,
      hasVerifiedSupplier: Boolean(p.verified),
      hasCriticalUnknownCost: false,
      isFirstPublication: Boolean(p.isFirstPublication),
    });

    p.marginPercent = margin.marginPercent;
    p.marginBand = margin.band;
    p.canPublish = margin.canPublish && !stock.shouldPause;
    p.shouldPause = margin.shouldPause || stock.shouldPause;
    p.autoPublish = auto;

    mockState.audits.unshift({
      id: `audit-${Date.now()}`,
      action: 'PRODUCT_EVALUATED',
      entityType: 'Product',
      entityId: id,
      runtimeMode: MODE,
      metadata: { margin: margin.marginPercent, band: margin.band },
      createdAt: new Date().toISOString(),
    });

    return { mode: MODE, item: p, evaluation: { margin, stock, auto } };
  }

  @Post(':id/request-approval')
  requestApproval(@Param('id') id: string, @Body() body: { action: string; reason?: string }) {
    const p = mockState.products.find((x) => x.id === id);
    if (!p) return { error: 'not_found' };

    const action = body.action || 'FIRST_PUBLICATION';
    const approval = {
      id: `appr-${Date.now()}`,
      productId: id,
      action,
      reason: body.reason || `Aprobación requerida: ${action}`,
      status: 'PENDING',
      requiresHuman: requiresHumanApproval(action),
      createdAt: new Date().toISOString(),
    };
    mockState.approvals.unshift(approval);
    (p as any).status = 'PENDING_APPROVAL';

    mockState.audits.unshift({
      id: `audit-${Date.now()}`,
      action: 'APPROVAL_REQUESTED',
      entityType: 'Approval',
      entityId: approval.id,
      runtimeMode: MODE,
      metadata: approval,
      createdAt: new Date().toISOString(),
    });

    return { mode: MODE, approval };
  }

  @Post(':id/generate-copy')
  async generateCopy(@Param('id') id: string) {
    const p = mockState.products.find((x) => x.id === id) as any;
    if (!p) return { error: 'not_found' };

    const result = await generateProductCopy({
      title: String(p.title),
      facts: `costo ${p.productCost}, envío ${p.shippingCost}, stock ${p.stock}, proveedor ${p.supplierName}`,
      language: 'es-CO',
    });

    mockState.audits.unshift({
      id: `audit-${Date.now()}`,
      action: 'AI_PRODUCT_COPY',
      entityType: 'Product',
      entityId: id,
      runtimeMode: MODE,
      metadata: { provider: result.provider, mock: result.mock },
      createdAt: new Date().toISOString(),
    });

    return { mode: MODE, productId: id, result };
  }
}

@Controller('approvals')
class ApprovalsController {
  @Get()
  list(@Query('status') status?: string) {
    let items = mockState.approvals;
    if (status) items = items.filter((a) => a.status === status);
    return { mode: MODE, count: items.length, items };
  }

  @Post(':id/decide')
  decide(@Param('id') id: string, @Body() body: { decision: 'APPROVED' | 'REJECTED'; note?: string }) {
    const a = mockState.approvals.find((x) => x.id === id) as any;
    if (!a) return { error: 'not_found' };
    if (a.status !== 'PENDING') return { error: 'already_decided' };

    a.status = body.decision;
    a.decidedAt = new Date().toISOString();
    a.note = body.note;

    const product = mockState.products.find((p) => p.id === a.productId) as any;
    if (product) {
      if (body.decision === 'APPROVED') {
        product.status = 'PUBLISHED';
        product.isFirstPublication = false;
      } else {
        product.status = 'REJECTED';
      }
    }

    mockState.audits.unshift({
      id: `audit-${Date.now()}`,
      action: `APPROVAL_${body.decision}`,
      entityType: 'Approval',
      entityId: id,
      runtimeMode: MODE,
      metadata: { note: body.note, productId: a.productId },
      createdAt: new Date().toISOString(),
    });

    return { mode: MODE, approval: a, product };
  }
}

@Controller('audit')
class AuditController {
  @Get()
  list(@Query('limit') limit = '50') {
    const n = Math.min(Number(limit) || 50, 200);
    return {
      mode: MODE,
      count: mockState.audits.length,
      items: mockState.audits.slice(0, n),
    };
  }
}

@Controller('auth')
class AuthController {
  @Get('me')
  me() {
    return {
      mode: MODE,
      user: mockState.users[0],
      note: 'Autenticación local MOCK — email/password + RBAC preparado; MFA listo para activar',
    };
  }

  @Post('login')
  login(@Body() body: { email?: string; password?: string }) {
    if (MODE !== 'MOCK') {
      return { error: 'Login real no implementado en este bloque; use MOCK' };
    }
    const user = mockState.users.find((u) => u.email === (body.email || 'admin@ecom.local'));
    if (!user) return { error: 'invalid_credentials' };
    mockState.audits.unshift({
      id: `audit-${Date.now()}`,
      action: 'LOGIN_MOCK',
      entityType: 'User',
      entityId: user.id,
      runtimeMode: MODE,
      createdAt: new Date().toISOString(),
    });
    return {
      mode: MODE,
      token: 'mock-session-token',
      user,
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
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.APP_URL ?? 'http://localhost:3000',
  });
  seedMockProducts();
  await app.listen(Number(process.env.API_PORT ?? 4000));
  // eslint-disable-next-line no-console
  console.log(`ECOM API block-3 (AI Router) on ${process.env.API_PORT ?? 4000} mode=${MODE}`);
}

void bootstrap();
