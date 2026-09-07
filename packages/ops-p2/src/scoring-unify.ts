/**
 * Única puerta de scoring para discovery / ingest / pipeline.
 * Toda ruta de candidato debe llamar scoreCandidate() — no scores ad-hoc.
 */
import {
  evaluateCandidate,
  MIN_OPPORTUNITY_SCORE,
  type ScoreInput,
} from '@ecom/scoring';

export type CandidateScoreInput = ScoreInput & {
  competitorCount?: number;
  adVolume?: number;
  searchCompetition?: number;
  /** Optional external id for audit */
  sourceId?: string;
  source?: string;
};

export type UnifiedScoreResult = ReturnType<typeof evaluateCandidate> & {
  decision: 'ACCEPT' | 'REJECT' | 'OBSERVE';
  reasonCodes: string[];
  sourceId?: string;
  source?: string;
  scoredAt: string;
};

/**
 * Canonical scorer. Maps eligible + bands to ACCEPT / OBSERVE / REJECT.
 * OBSERVE: hard filters ok but score 50–54 (under min) — no auto-publish.
 */
export function scoreCandidate(input: CandidateScoreInput): UnifiedScoreResult {
  const base = evaluateCandidate(input);
  const reasonCodes: string[] = [...base.hardFilters.reasons];
  let decision: UnifiedScoreResult['decision'] = 'REJECT';

  if (!base.hardFilters.ok) {
    decision = 'REJECT';
  } else if (base.eligible && base.opportunity.score >= MIN_OPPORTUNITY_SCORE) {
    decision = 'ACCEPT';
  } else if (base.hardFilters.ok && base.opportunity.score >= 50) {
    decision = 'OBSERVE';
    reasonCodes.push(`score_below_min:${base.opportunity.score}<${MIN_OPPORTUNITY_SCORE}`);
  } else {
    decision = 'REJECT';
    if (!base.opportunity.passesMin) {
      reasonCodes.push(`score_below_min:${base.opportunity.score}<${MIN_OPPORTUNITY_SCORE}`);
    }
  }

  if (base.saturation.label === 'high' && decision === 'ACCEPT') {
    // Soft flag — still accept but annotate
    reasonCodes.push('saturation_high');
  }

  return {
    ...base,
    decision,
    reasonCodes,
    sourceId: input.sourceId,
    source: input.source,
    scoredAt: new Date().toISOString(),
  };
}

/** Apply unified score onto a plain candidate object (discovery shape). */
export function attachUnifiedScore<T extends Record<string, unknown>>(
  candidate: T,
  scoreInput: CandidateScoreInput,
): T & { unifiedScore: UnifiedScoreResult; opportunityScore: number } {
  const unifiedScore = scoreCandidate(scoreInput);
  return {
    ...candidate,
    unifiedScore,
    opportunityScore: unifiedScore.opportunity.score,
  };
}

export const SCORING_UNIFY_META = {
  entry: 'scoreCandidate',
  rule: 'All discovery/ingest paths must use scoreCandidate or attachUnifiedScore',
  minScore: MIN_OPPORTUNITY_SCORE,
};
