/**
 * ECOM Multi-Agent Orchestrator (Prompt Maestro §3)
 *
 * Agents (deterministic + optional AI):
 * 1. Research   — candidate intake / scoring signals
 * 2. Trends     — opportunity heuristics
 * 3. Supplier   — ranking stub from known suppliers
 * 4. Margin     — @ecom/rules (source of truth)
 * 5. Brand/Copy — @ecom/ai-router product copy
 * 6. PublishGate — auto vs human approval
 *
 * Orchestrator validates rules, records step trace, never processes payments.
 */

import {
  calculateMargin,
  canAutoPublish,
  decideStock,
  requiresHumanApproval,
  RULES,
  type CostBreakdown,
} from '../../rules/src/index';
import { generateProductCopy } from '../../ai-router/src/index';

export type AgentId =
  | 'orchestrator'
  | 'research'
  | 'trends'
  | 'supplier'
  | 'margin'
  | 'brand'
  | 'publish_gate';

export type PipelineStatus =
  | 'RUNNING'
  | 'NEEDS_APPROVAL'
  | 'ELIGIBLE'
  | 'BLOCKED'
  | 'FAILED'
  | 'COMPLETED';

export interface AgentStep {
  agent: AgentId;
  ok: boolean;
  durationMs: number;
  summary: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface CandidateInput {
  title: string;
  salePrice: number;
  productCost: number;
  shippingCost?: number;
  stock?: number | null;
  opportunityScore?: number;
  confidence?: number;
  supplierName?: string;
  supplierVerified?: boolean;
  isFirstPublication?: boolean;
  countryCode?: string;
  currency?: string;
  facts?: string;
  /** Skip AI copy (faster / $0 strict) */
  skipAiCopy?: boolean;
}

export interface PipelineResult {
  status: PipelineStatus;
  productTitle: string;
  steps: AgentStep[];
  marginPercent: number;
  marginBand: string;
  opportunityScore: number;
  confidence: number;
  canPublish: boolean;
  needsHumanApproval: boolean;
  approvalAction?: string;
  suggestedDescription?: string;
  blockedReasons: string[];
  traceId: string;
  mode: string;
}

function env(name: string, fallback = '') {
  return (process.env[name] ?? fallback).replace(/\r/g, '').trim();
}

function mode() {
  const m = env('ECOM_MODE', 'MOCK').toUpperCase();
  return m === 'SANDBOX' || m === 'REAL' ? m : 'MOCK';
}

async function timed<T>(
  agent: AgentId,
  fn: () => Promise<{ ok: boolean; summary: string; data?: Record<string, unknown>; error?: string }>,
): Promise<AgentStep> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { agent, ok: r.ok, durationMs: Date.now() - t0, summary: r.summary, data: r.data, error: r.error };
  } catch (e: any) {
    return {
      agent,
      ok: false,
      durationMs: Date.now() - t0,
      summary: 'error',
      error: e?.message || String(e),
    };
  }
}

/** Research agent: normalize candidate + basic quality gates */
async function agentResearch(input: CandidateInput) {
  return timed('research', async () => {
    const title = (input.title || '').trim();
    if (title.length < 3) {
      return { ok: false, summary: 'Título inválido', error: 'title_too_short' };
    }
    if (!(input.salePrice > 0) || !(input.productCost >= 0)) {
      return { ok: false, summary: 'Precios inválidos', error: 'invalid_prices' };
    }
    return {
      ok: true,
      summary: `Candidato aceptado: ${title.slice(0, 60)}`,
      data: {
        title,
        countryCode: input.countryCode || 'CO',
        currency: input.currency || 'COP',
      },
    };
  });
}

/** Trends agent: heuristic opportunity (real sources later) */
async function agentTrends(input: CandidateInput) {
  return timed('trends', async () => {
    let score = input.opportunityScore ?? 50;
    // Light heuristic boosts when data present
    if ((input.stock ?? 0) > 50) score += 5;
    if (input.supplierVerified) score += 5;
    score = Math.max(0, Math.min(100, score));
    const pass = score >= RULES.MIN_OPPORTUNITY_SCORE;
    return {
      ok: pass,
      summary: pass
        ? `Opportunity score ${score} ≥ ${RULES.MIN_OPPORTUNITY_SCORE}`
        : `Opportunity score ${score} < ${RULES.MIN_OPPORTUNITY_SCORE}`,
      data: { opportunityScore: score, minRequired: RULES.MIN_OPPORTUNITY_SCORE },
      error: pass ? undefined : 'opportunity_below_threshold',
    };
  });
}

/** Supplier agent */
async function agentSupplier(input: CandidateInput) {
  return timed('supplier', async () => {
    const verified = Boolean(input.supplierVerified);
    const name = input.supplierName || 'unknown';
    if (!verified) {
      return {
        ok: false,
        summary: `Proveedor no verificado: ${name}`,
        data: { supplierName: name, verified: false },
        error: 'supplier_unverified',
      };
    }
    return {
      ok: true,
      summary: `Proveedor verificado: ${name}`,
      data: { supplierName: name, verified: true, stock: input.stock ?? null },
    };
  });
}

/** Margin agent — always @ecom/rules */
async function agentMargin(input: CandidateInput) {
  return timed('margin', async () => {
    const costs: CostBreakdown = {
      productCost: input.productCost,
      shippingCost: input.shippingCost ?? 0,
    };
    const margin = calculateMargin({ salePrice: input.salePrice, costs });
    const stock = decideStock(input.stock ?? null);
    const blocked =
      margin.shouldPause ||
      stock.shouldPause ||
      !margin.canPublish;
    return {
      ok: !blocked,
      summary: `Margen ${margin.marginPercent}% (${margin.band}) · stock pause=${stock.shouldPause}`,
      data: {
        marginPercent: margin.marginPercent,
        band: margin.band,
        canPublish: margin.canPublish && !stock.shouldPause,
        shouldPause: margin.shouldPause || stock.shouldPause,
        stockDecision: stock,
      },
      error: blocked ? 'margin_or_stock_block' : undefined,
    };
  });
}

/** Brand / copy agent via AI Router (MOCK-safe) */
async function agentBrand(input: CandidateInput) {
  return timed('brand', async () => {
    if (input.skipAiCopy) {
      return {
        ok: true,
        summary: 'Copy omitido (skipAiCopy)',
        data: { skipped: true },
      };
    }
    const result = await generateProductCopy({
      title: input.title,
      facts:
        input.facts ||
        `costo ${input.productCost}, envío ${input.shippingCost ?? 0}, stock ${input.stock ?? 'n/a'}`,
      language: 'es-CO',
    });
    return {
      ok: result.ok,
      summary: result.ok
        ? `Copy generado vía ${result.provider}${result.mock ? ' (MOCK)' : ''}`
        : `Copy falló: ${result.error || 'unknown'}`,
      data: {
        provider: result.provider,
        mock: result.mock,
        textPreview: result.text?.slice(0, 200),
        text: result.text,
      },
      error: result.ok ? undefined : result.error,
    };
  });
}

/** Publish gate — rules + first publication */
async function agentPublishGate(input: CandidateInput, marginPercent: number) {
  return timed('publish_gate', async () => {
    const auto = canAutoPublish({
      marginPercent,
      opportunityScore: input.opportunityScore ?? 0,
      confidence: input.confidence ?? 0,
      hasVerifiedSupplier: Boolean(input.supplierVerified),
      hasCriticalUnknownCost: false,
      isFirstPublication: input.isFirstPublication !== false,
    });
    const needsHuman =
      Boolean(input.isFirstPublication !== false) || requiresHumanApproval('FIRST_PUBLICATION');
    return {
      ok: auto.ok || needsHuman, // pipeline can continue to approval
      summary: auto.ok
        ? 'Elegible para auto-publicación'
        : needsHuman
          ? `Requiere aprobación humana: ${auto.reason}`
          : `Bloqueado: ${auto.reason}`,
      data: {
        autoPublish: auto.ok,
        reason: auto.reason,
        needsHumanApproval: needsHuman && !auto.ok,
        confidence: input.confidence ?? 0,
        minConfidence: RULES.AUTO_PUBLISH_CONFIDENCE,
      },
      error: !auto.ok && !needsHuman ? auto.reason : undefined,
    };
  });
}

/**
 * Run full evaluation pipeline for one candidate.
 * Does NOT publish to Shopify or create CJ orders — only decides + optional copy.
 */
export async function runProductPipeline(input: CandidateInput): Promise<PipelineResult> {
  const traceId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const steps: AgentStep[] = [];
  const blockedReasons: string[] = [];

  const research = await agentResearch(input);
  steps.push(research);
  if (!research.ok) {
    return finish('BLOCKED', input, steps, blockedReasons.concat(research.error || 'research_failed'), traceId);
  }

  const trends = await agentTrends(input);
  steps.push(trends);
  if (!trends.ok) blockedReasons.push(trends.error || 'trends_failed');

  const supplier = await agentSupplier(input);
  steps.push(supplier);
  if (!supplier.ok) blockedReasons.push(supplier.error || 'supplier_failed');

  const marginStep = await agentMargin(input);
  steps.push(marginStep);
  const marginPercent = Number(marginStep.data?.marginPercent ?? 0);
  const marginBand = String(marginStep.data?.band ?? 'UNKNOWN');
  if (!marginStep.ok) blockedReasons.push(marginStep.error || 'margin_failed');

  const brand = await agentBrand(input);
  steps.push(brand);
  // Brand failure does not hard-block in MOCK; soft flag
  if (!brand.ok) blockedReasons.push(brand.error || 'brand_failed');

  const opportunityScore = Number(trends.data?.opportunityScore ?? input.opportunityScore ?? 0);
  const confidence = input.confidence ?? 0;

  const gate = await agentPublishGate(
    { ...input, opportunityScore, confidence },
    marginPercent,
  );
  steps.push(gate);

  const hardBlock = !research.ok || !marginStep.ok || !supplier.ok || (!trends.ok && opportunityScore < RULES.MIN_OPPORTUNITY_SCORE);
  const needsHuman = Boolean(gate.data?.needsHumanApproval);
  const canPublish = Boolean(marginStep.data?.canPublish) && supplier.ok && trends.ok;

  let status: PipelineStatus;
  if (hardBlock || (!canPublish && !needsHuman)) status = 'BLOCKED';
  else if (needsHuman) status = 'NEEDS_APPROVAL';
  else if (canPublish && gate.data?.autoPublish) status = 'ELIGIBLE';
  else if (canPublish) status = 'NEEDS_APPROVAL';
  else status = 'BLOCKED';

  return {
    status,
    productTitle: input.title,
    steps,
    marginPercent,
    marginBand,
    opportunityScore,
    confidence,
    canPublish,
    needsHumanApproval: needsHuman || status === 'NEEDS_APPROVAL',
    approvalAction: needsHuman ? 'FIRST_PUBLICATION' : undefined,
    suggestedDescription: brand.data?.text as string | undefined,
    blockedReasons: [...new Set(blockedReasons)],
    traceId,
    mode: mode(),
  };
}

function finish(
  status: PipelineStatus,
  input: CandidateInput,
  steps: AgentStep[],
  blockedReasons: string[],
  traceId: string,
): PipelineResult {
  return {
    status,
    productTitle: input.title,
    steps,
    marginPercent: 0,
    marginBand: 'UNKNOWN',
    opportunityScore: input.opportunityScore ?? 0,
    confidence: input.confidence ?? 0,
    canPublish: false,
    needsHumanApproval: false,
    blockedReasons,
    traceId,
    mode: mode(),
  };
}

export function listAgents() {
  return [
    { id: 'orchestrator', role: 'Coordina pipeline, reglas y trazas' },
    { id: 'research', role: 'Ingesta y validación básica del candidato' },
    { id: 'trends', role: 'Opportunity score / señales de demanda (heurística V1)' },
    { id: 'supplier', role: 'Verificación de proveedor' },
    { id: 'margin', role: 'Rentabilidad vía @ecom/rules' },
    { id: 'brand', role: 'Copy/branding vía AI Router' },
    { id: 'publish_gate', role: 'Auto-publish vs aprobación humana' },
  ];
}

export function getOrchestratorMeta() {
  return {
    block: 8,
    package: '@ecom/orchestrator',
    mode: mode(),
    agents: listAgents(),
    rules: {
      marginMin: RULES.MARGIN_MIN,
      marginIdeal: RULES.MARGIN_IDEAL,
      minOpportunity: RULES.MIN_OPPORTUNITY_SCORE,
      autoConfidence: RULES.AUTO_PUBLISH_CONFIDENCE,
    },
    note: 'Pipeline de evaluación; no publica en Shopify ni cumple en CJ por sí solo.',
  };
}
