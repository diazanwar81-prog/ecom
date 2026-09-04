/**
 * ECOM Phase Runner — auto-verify Fases 0, 1 y 2
 * No publica en Shopify ni activa REAL. Solo valida readiness de paquetes y reglas.
 */

import {
  evaluatePublishGate,
} from '../../catalog-quality/src/publish-gate';
import {
  verifyShopifyHmac,
  stockPauseDecision,
  buildDailyDigest,
  realModeChecklist,
  OPS_META,
} from '../../ops/src/index';
import {
  computeOpportunityScore,
  computeSaturationScore,
  hardFilters,
  evaluateCandidate,
  MIN_OPPORTUNITY_SCORE,
  SCORING_META,
} from '../../scoring/src/index';
import {
  runLocalSmokeUnits,
  getKillSwitch,
  realModeGate,
  HARDENING_META,
} from '../../hardening/src/index';

export type PhaseId = 0 | 1 | 2;

export type CheckResult = {
  id: string;
  ok: boolean;
  critical: boolean;
  message: string;
  data?: Record<string, unknown>;
};

export type PhaseReport = {
  phase: PhaseId;
  name: string;
  ok: boolean;
  criticalFailed: number;
  score: number;
  checks: CheckResult[];
  nextActions: string[];
};

function scoreOf(checks: CheckResult[]): number {
  if (!checks.length) return 0;
  return Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
}

/** Fase 0 — Estabilización: media gate + smoke local + kill-switch legible */
export function verifyPhase0(): PhaseReport {
  const checks: CheckResult[] = [];

  const gateOk = evaluatePublishGate({
    cjSku: 'TEST-SKU',
    cjVariantId: 'vid-test',
    verified: true,
    stock: 10,
    marginPercent: 40,
    marginBand: 'IDEAL',
    imageUrls: ['https://cdn.example.com/p1.jpg', 'https://cdn.example.com/p2.jpg'],
    description: 'Descripción comercial de prueba con longitud suficiente para el gate de calidad.',
    title: 'Producto test ECOM',
    opportunityScore: 70,
    confidence: 90,
    isFirstPublication: true,
    approvalStatus: 'PENDING',
  });
  checks.push({
    id: 'publish_gate_blocks_first_without_approval_path',
    ok: gateOk.canPublish && gateOk.needsHumanApproval,
    critical: true,
    message: gateOk.canPublish
      ? 'Publish gate: calidad OK + primera publicación requiere humano'
      : `Publish gate bloqueó: ${gateOk.messages.join('; ')}`,
    data: { reasons: gateOk.reasons, needsHuman: gateOk.needsHumanApproval },
  });

  const gateBadMedia = evaluatePublishGate({
    cjSku: 'X',
    verified: true,
    stock: 5,
    marginPercent: 40,
    imageUrls: ['http://placehold.co/1.png'],
    description: 'corta',
    title: 'x',
    opportunityScore: 70,
  });
  checks.push({
    id: 'publish_gate_rejects_placeholder_and_short_copy',
    ok: !gateBadMedia.canPublish,
    critical: true,
    message: !gateBadMedia.canPublish
      ? 'Gate rechaza placeholder/copy corto'
      : 'Gate no rechazó media/copy inválidos',
  });

  const smoke = runLocalSmokeUnits();
  for (const s of smoke) {
    checks.push({
      id: `smoke_${s.id}`,
      ok: s.ok,
      critical: s.severity === 'critical',
      message: s.message,
      data: s.data,
    });
  }

  const ks = getKillSwitch();
  checks.push({
    id: 'kill_switch_readable',
    ok: typeof ks.active === 'boolean',
    critical: true,
    message: ks.active ? `KILL ON: ${ks.reason}` : 'Kill switch legible y OFF por defecto',
  });

  const criticalFailed = checks.filter((c) => c.critical && !c.ok).length;
  return {
    phase: 0,
    name: 'Estabilización',
    ok: criticalFailed === 0,
    criticalFailed,
    score: scoreOf(checks),
    checks,
    nextActions: criticalFailed
      ? ['Corregir checks críticos de Fase 0 antes de Ops 24/7']
      : ['Fase 0 OK — continuar Fase 1 (Ops 24/7)'],
  };
}

/** Fase 1 — Ops 24/7: HMAC, inventario, digest, checklist REAL (sin activar REAL) */
export function verifyPhase1(): PhaseReport {
  const checks: CheckResult[] = [];

  const secret = 'test_webhook_secret_ecom';
  const body = '{"id":1,"name":"order"}';
  const crypto = require('crypto') as typeof import('crypto');
  const goodHmac = crypto.createHmac('sha256', secret).update(body).digest('base64');
  checks.push({
    id: 'shopify_hmac_valid',
    ok: verifyShopifyHmac(body, goodHmac, secret) === true,
    critical: true,
    message: 'HMAC Shopify válido aceptado',
  });
  checks.push({
    id: 'shopify_hmac_invalid_rejected',
    ok: verifyShopifyHmac(body, 'invalid', secret) === false,
    critical: true,
    message: 'HMAC inválido rechazado',
  });
  checks.push({
    id: 'shopify_hmac_missing_rejected',
    ok: verifyShopifyHmac(body, undefined, secret) === false,
    critical: true,
    message: 'HMAC ausente rechazado',
  });

  const pause = stockPauseDecision(0);
  const okStock = stockPauseDecision(12);
  checks.push({
    id: 'inventory_pause_on_zero',
    ok: pause.shouldPause && !okStock.shouldPause,
    critical: true,
    message: 'Inventario: stock 0 → pause; stock >0 → OK',
  });

  const digest = buildDailyDigest({
    mode: 'MOCK',
    published: 3,
    pendingApprovals: 1,
    paidOrders: 2,
    fulfilledOrders: 1,
    pausedProducts: 0,
    stockRisks: 0,
    jobsFailed: 0,
    date: '2026-09-04',
  });
  checks.push({
    id: 'daily_digest_payload',
    ok: Boolean(digest.title && digest.body.includes('Publicados')),
    critical: false,
    message: 'Digest diario genera payload legible',
  });

  const checklist = realModeChecklist({
    SHOPIFY_ACCESS_TOKEN: 'shpat_x',
    SHOPIFY_SHOP_DOMAIN: 'store.myshopify.com',
    SHOPIFY_WEBHOOK_SECRET: 'whsec',
    CJ_API_KEY: 'cjkey',
    ECOM_ALLOW_PAID_AI: 'false',
    TELEGRAM_BOT_TOKEN: 't',
    SESSION_SECRET: '1234567890123456',
  });
  checks.push({
    id: 'real_mode_checklist_pass_when_keys',
    ok: checklist.ok,
    critical: true,
    message: checklist.ok
      ? 'Checklist REAL pasa con keys de prueba'
      : `Checklist falló: ${checklist.items.filter((i) => !i.ok).map((i) => i.key).join(',')}`,
  });

  const gate = realModeGate({
    SHOPIFY_ACCESS_TOKEN: '',
    ECOM_REAL_CONFIRM: '',
  });
  checks.push({
    id: 'real_mode_gate_blocks_without_confirm',
    ok: gate.canEnterReal === false,
    critical: true,
    message: 'realModeGate bloquea entrada a REAL sin confirmación',
    data: { score: gate.score },
  });

  checks.push({
    id: 'ops_meta_features',
    ok: OPS_META.features.includes('webhook_hmac') && OPS_META.features.includes('inventory_job'),
    critical: false,
    message: `OPS_META block ${OPS_META.block}`,
  });

  const criticalFailed = checks.filter((c) => c.critical && !c.ok).length;
  return {
    phase: 1,
    name: 'Ops 24/7 crítico',
    ok: criticalFailed === 0,
    criticalFailed,
    score: scoreOf(checks),
    checks,
    nextActions: criticalFailed
      ? ['Corregir HMAC/inventario/checklist antes de scoring']
      : [
          'Cablear jobs periódicos inventario/tracking en API si aún no corren cada 15–30 min',
          'Registrar webhook Shopify con URL HTTPS estable',
          'Auth sesión real del panel (si sigue MOCK)',
        ],
  };
}

/** Fase 2 — Scoring & Discovery logic (ponderado + hard filters) */
export function verifyPhase2(): PhaseReport {
  const checks: CheckResult[] = [];

  const banned = hardFilters({ title: 'Airsoft Gun Rifle', marginPercent: 40, stock: 10 });
  checks.push({
    id: 'hard_filter_banned',
    ok: !banned.ok && banned.reasons.some((r) => r.startsWith('banned')),
    critical: true,
    message: 'Hard filter bloquea categoría prohibida',
  });

  const shipping = hardFilters({
    title: 'Organizador',
    salePrice: 10000,
    shippingCost: 3000,
    marginPercent: 40,
    stock: 5,
    supplierVerified: true,
  });
  checks.push({
    id: 'hard_filter_shipping_pct',
    ok: !shipping.ok && shipping.reasons.some((r) => r.includes('shipping')),
    critical: true,
    message: 'Hard filter bloquea envío >15% del PVP',
  });

  const opp = computeOpportunityScore({
    demandScore: 80,
    marginPercent: 42,
    trendScore: 70,
    supplierVerified: true,
    logisticsScore: 75,
    competitionScore: 60,
  });
  checks.push({
    id: 'opportunity_weighted_min55',
    ok: opp.passesMin && opp.score >= MIN_OPPORTUNITY_SCORE,
    critical: true,
    message: `Opportunity Score ponderado = ${opp.score} (min ${MIN_OPPORTUNITY_SCORE})`,
    data: opp.breakdown,
  });

  const sat = computeSaturationScore({
    competitorCount: 50,
    adVolume: 90,
    searchCompetition: 85,
  });
  checks.push({
    id: 'saturation_score',
    ok: sat.saturation >= 0 && ['low', 'medium', 'high'].includes(sat.label),
    critical: true,
    message: `Saturation ${sat.saturation} (${sat.label})`,
  });

  const eligible = evaluateCandidate({
    title: 'Organizador escritorio',
    demandScore: 78,
    marginPercent: 40,
    supplierVerified: true,
    stock: 40,
    salePrice: 50000,
    shippingCost: 6000,
  });
  checks.push({
    id: 'evaluate_candidate_eligible',
    ok: eligible.eligible === true,
    critical: true,
    message: eligible.eligible ? 'Candidato elegible con filtros + score' : 'Candidato debería ser elegible',
  });

  checks.push({
    id: 'scoring_meta_weights',
    ok: Math.abs(SCORING_META.weights.demand - 0.4) < 0.001,
    critical: false,
    message: 'Pesos Opportunity Score alineados a spec (demanda 40%)',
  });

  const criticalFailed = checks.filter((c) => c.critical && !c.ok).length;
  return {
    phase: 2,
    name: 'Scoring & Discovery',
    ok: criticalFailed === 0,
    criticalFailed,
    score: scoreOf(checks),
    checks,
    nextActions: criticalFailed
      ? ['Revisar @ecom/scoring']
      : [
          'Integrar evaluateCandidate en discovery pipeline si aún usa score simple',
          'Conectar fuentes free (Serper/CJ) a demandScore/trendScore reales (sin inventar)',
        ],
  };
}

export function runPhases(phases: PhaseId[] = [0, 1, 2]): {
  ok: boolean;
  reports: PhaseReport[];
  summary: string;
} {
  const runners: Record<PhaseId, () => PhaseReport> = {
    0: verifyPhase0,
    1: verifyPhase1,
    2: verifyPhase2,
  };
  const reports: PhaseReport[] = [];
  for (const p of phases) {
    const report = runners[p]();
    reports.push(report);
    if (!report.ok) break; // stop on first critical phase failure
  }
  const ok = reports.length === phases.length && reports.every((r) => r.ok);
  const summary = reports
    .map((r) => `Fase ${r.phase} ${r.name}: ${r.ok ? 'PASS' : 'FAIL'} (score ${r.score}%, critFail=${r.criticalFailed})`)
    .join(' | ');
  return { ok, reports, summary };
}

export const PHASE_RUNNER_META = {
  package: '@ecom/phase-runner',
  verifies: [0, 1, 2],
  hardening: HARDENING_META,
  note: 'Verificación determinista de paquetes. No activa REAL ni publica.',
};
