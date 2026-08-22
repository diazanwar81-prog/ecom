/**
 * ECOM Marketing — block 32
 * Organic drafts per channel. Publish only when credentials exist; never fake.
 */

export type ChannelId =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'youtube'
  | 'pinterest'
  | 'x'
  | 'seo_blog';

export type DraftStatus = 'DRAFT' | 'READY' | 'SCHEDULED' | 'PUBLISHED' | 'BLOCKED';

export type ChannelDraft = {
  channel: ChannelId;
  status: DraftStatus;
  caption: string;
  hashtags: string[];
  canPublishLive: boolean;
  reason: string;
};

function env(k: string): string | undefined {
  return process.env[k]?.trim() || undefined;
}

export function channelCredentials(): Record<ChannelId, boolean> {
  return {
    instagram: Boolean(env('META_PAGE_TOKEN') || env('INSTAGRAM_ACCESS_TOKEN')),
    facebook: Boolean(env('META_PAGE_TOKEN')),
    tiktok: Boolean(env('TIKTOK_ACCESS_TOKEN')),
    youtube: Boolean(env('YOUTUBE_API_KEY')),
    pinterest: Boolean(env('PINTEREST_ACCESS_TOKEN')),
    x: Boolean(env('X_API_KEY') && env('X_API_SECRET')),
    seo_blog: true, // local draft always allowed
  };
}

export function buildOrganicDrafts(input: {
  title: string;
  description?: string | null;
  price?: number | string | null;
  currency?: string;
  url?: string | null;
}): ChannelDraft[] {
  const title = input.title.slice(0, 120);
  const price =
    input.price != null
      ? `${input.currency || 'COP'} ${Number(input.price).toLocaleString('es-CO')}`
      : '';
  const base = `${title}${price ? ` · ${price}` : ''}. ${input.description || ''}`.slice(0, 400);
  const tags = ['#dropshipping', '#colombia', '#oferta', '#ecom'];
  const creds = channelCredentials();

  const mk = (channel: ChannelId, caption: string): ChannelDraft => {
    const live = creds[channel];
    return {
      channel,
      status: live ? 'READY' : 'DRAFT',
      caption,
      hashtags: tags,
      canPublishLive: live && channel !== 'seo_blog',
      reason: live
        ? channel === 'seo_blog'
          ? 'Borrador SEO local (no es publicación externa)'
          : 'Credenciales presentes — publicación live requiere aprobación explícita'
        : 'Sin credenciales de canal — solo borrador (nunca se finge publicación)',
    };
  };

  return [
    mk('instagram', `✨ ${base}\n\nLink en bio${input.url ? ` / ${input.url}` : ''}`),
    mk('facebook', base),
    mk('tiktok', `POV: encontraste esto 🔥\n${title}\n${price}`),
    mk('youtube', `Review rápida: ${title}. ${price}`),
    mk('pinterest', `${title} | ${price}`),
    mk('x', `${title} ${price}`.slice(0, 240)),
    mk(
      'seo_blog',
      `# ${title}\n\n${input.description || 'Descripción pendiente.'}\n\nPrecio: ${price}\n`,
    ),
  ];
}

/** Never marks PUBLISHED without explicit force + credentials */
export function attemptPublish(
  draft: ChannelDraft,
  opts: { force?: boolean } = {},
): { ok: boolean; status: DraftStatus; message: string } {
  if (!draft.canPublishLive) {
    return {
      ok: false,
      status: 'BLOCKED',
      message: draft.reason,
    };
  }
  if (!opts.force) {
    return {
      ok: false,
      status: 'READY',
      message: 'Publicación live requiere force=true + aprobación humana',
    };
  }
  // Live adapters not fully wired — still refuse silent success
  return {
    ok: false,
    status: 'READY',
    message: 'Adapter live del canal aún no implementado; borrador conservado (sin fake publish)',
  };
}

export const MARKETING_META = {
  block: 32,
  policy: 'draft_first_never_fake_publish',
  channels: ['instagram', 'facebook', 'tiktok', 'youtube', 'pinterest', 'x', 'seo_blog'],
};
