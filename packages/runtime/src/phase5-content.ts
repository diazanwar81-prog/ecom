/**
 * FASE 5 — Contenido vendible (Canva OFF por defecto)
 */

export const PHASE5 = {
  id: 5,
  name: 'Contenido vendible',
  canvaDefault: false,
  imagePolicy: {
    minCommercial: 4,
    minDescriptive: 1,
    totalTarget: 5,
    rejectPlaceholders: true,
  },
  videoPolicy: {
    commercial: 1,
    informative: 1,
    statusIfMissing: 'ASSET_PENDING',
  },
} as const;

export function phase5CanvaAllowed(env: Record<string, string | undefined> = process.env): boolean {
  const v = String(env.ECOM_ALLOW_CANVA || '').toLowerCase();
  return v === 'true' || v === '1';
}

export type MediaAsset = {
  url: string;
  type: 'image' | 'video';
  role?: 'commercial' | 'descriptive' | 'commercial_video' | 'info_video';
};

export function phase5ValidateImages(urls: string[]): {
  ok: boolean;
  usable: string[];
  rejected: string[];
  reasons: string[];
} {
  const rejected: string[] = [];
  const usable: string[] = [];
  const reasons: string[] = [];
  for (const u of urls) {
    const s = String(u || '').trim();
    if (!/^https:\/\//i.test(s)) {
      rejected.push(s);
      reasons.push('not_https');
      continue;
    }
    if (/placehold|placeholder|dummyimage|picsum/i.test(s)) {
      rejected.push(s);
      reasons.push('placeholder');
      continue;
    }
    usable.push(s);
  }
  const ok = usable.length >= 1; // mínimo 1 real para publish; ideal 5
  if (usable.length < PHASE5.imagePolicy.totalTarget) {
    reasons.push(`below_target_${usable.length}<${PHASE5.imagePolicy.totalTarget}`);
  }
  return { ok, usable: usable.slice(0, 5), rejected, reasons };
}

export function phase5ContentPlan(input: {
  title: string;
  imageUrls?: string[];
  hasVideo?: boolean;
}): {
  canPublishMedia: boolean;
  images: ReturnType<typeof phase5ValidateImages>;
  videoStatus: 'READY' | 'ASSET_PENDING';
  canva: { allowed: boolean; action: 'skip' | 'generate_when_enabled' };
  copyMode: 'template' | 'ai_if_allowed';
} {
  const images = phase5ValidateImages(input.imageUrls || []);
  const canvaAllowed = phase5CanvaAllowed();
  return {
    canPublishMedia: images.ok,
    images,
    videoStatus: input.hasVideo ? 'READY' : 'ASSET_PENDING',
    canva: {
      allowed: canvaAllowed,
      action: canvaAllowed ? 'generate_when_enabled' : 'skip',
    },
    copyMode: String(process.env.ECOM_ALLOW_PAID_AI || '').toLowerCase() === 'true' ? 'ai_if_allowed' : 'template',
  };
}
