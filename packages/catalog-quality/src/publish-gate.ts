/** Phase-1 publish gate: media + identity + margin + copy minimum */

export type PublishGateInput = {
  cjSku?: string | null;
  cjVariantId?: string | null;
  verified?: boolean;
  stock?: number | null;
  marginPercent?: number | null;
  marginBand?: string | null;
  imageUrls?: string[] | null;
  description?: string | null;
  title?: string | null;
  opportunityScore?: number | null;
  confidence?: number | null;
  isFirstPublication?: boolean;
  approvalStatus?: string | null;
  strictBranding?: boolean;
  minDescriptionLen?: number;
  minImages?: number;
};

export type PublishGateCheck = {
  id: string;
  ok: boolean;
  level: 'critical' | 'warning';
  message: string;
};

export type PublishGateResult = {
  ok: boolean;
  canPublish: boolean;
  canAutoPublish: boolean;
  needsHumanApproval: boolean;
  reasons: string[];
  messages: string[];
  checks: PublishGateCheck[];
  snapshot: {
    imageCount: number;
    hasDescription: boolean;
    marginPercent: number | null;
    cjSku: string | null;
  };
};

function isHttpsImage(u: string): boolean {
  return /^https?:\/\//i.test(u) && !/placehold\.co|via\.placeholder|dummyimage|picsum\.photos/i.test(u);
}

export function evaluatePublishGate(input: PublishGateInput): PublishGateResult {
  const checks: PublishGateCheck[] = [];
  const minImages = input.minImages ?? (input.strictBranding ? 4 : 1);
  const minDesc = input.minDescriptionLen ?? 40;
  const imgs = (input.imageUrls || []).map(String).filter(isHttpsImage);
  const desc = String(input.description || '').trim();
  const title = String(input.title || '').trim();

  const push = (id: string, ok: boolean, level: 'critical' | 'warning', message: string) => {
    checks.push({ id, ok, level, message });
  };

  push(
    'cj_identity',
    Boolean(input.cjSku || input.cjVariantId),
    'critical',
    input.cjSku || input.cjVariantId ? 'Identidad CJ presente' : 'Falta cjSku/cjVariantId',
  );
  if (input.verified === false) {
    push('supplier_verified', false, 'critical', 'Proveedor no verificado');
  }

  const margin = input.marginPercent != null ? Number(input.marginPercent) : null;
  const band = String(input.marginBand || '');
  const marginBad = band === 'PAUSE' || (margin != null && margin < 30);
  push('margin', !marginBad, 'critical', marginBad ? `Margen bloquea (${margin}% ${band})` : `Margen OK`);

  const stock = input.stock != null ? Number(input.stock) : null;
  push('stock', !(stock != null && stock <= 0), 'critical', stock != null && stock <= 0 ? 'Stock 0' : `Stock ${stock ?? 'n/a'}`);

  push(
    'media',
    imgs.length >= minImages,
    'critical',
    imgs.length >= minImages
      ? `${imgs.length} imagen(es) HTTPS`
      : `Faltan imágenes (${imgs.length}/${minImages}). Ejecuta sync-media.`,
  );

  const descOk = desc.length >= minDesc && !/\*\*Título:\*\*|Style\)\*\*/i.test(desc);
  push(
    'description',
    descOk,
    'critical',
    descOk ? `Descripción ${desc.length} chars` : `Descripción inválida o corta (${desc.length})`,
  );

  const score = input.opportunityScore != null ? Number(input.opportunityScore) : 100;
  push('score', score >= 55, 'critical', score >= 55 ? `Score ${score}` : `Score bajo ${score}`);

  const criticalFailed = checks.some((c) => !c.ok && c.level === 'critical');
  const first = input.isFirstPublication !== false;
  const approved = String(input.approvalStatus || '').toUpperCase() === 'APPROVED';
  const conf = input.confidence != null ? Number(input.confidence) : 0;

  return {
    ok: !criticalFailed,
    canPublish: !criticalFailed,
    canAutoPublish: !criticalFailed && !first && conf >= 95,
    needsHumanApproval: first && !approved,
    reasons: checks.filter((c) => !c.ok && c.level === 'critical').map((c) => c.id),
    messages: checks.filter((c) => !c.ok).map((c) => c.message),
    checks,
    snapshot: {
      imageCount: imgs.length,
      hasDescription: desc.length >= minDesc,
      marginPercent: margin,
      cjSku: input.cjSku ? String(input.cjSku) : null,
    },
  };
}
