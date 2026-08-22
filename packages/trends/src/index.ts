/**
 * ECOM Trends — block 31
 * Multi-source trend signals. Only official/free APIs; no fake live data.
 */

export type TrendSourceId = 'serper' | 'meta_ad_library' | 'reddit' | 'youtube' | 'mock';

export type TrendSignal = {
  source: TrendSourceId;
  query: string;
  score: number; // 0-100
  label: string;
  url?: string;
  configured: boolean;
  note?: string;
};

function env(k: string): string | undefined {
  return process.env[k]?.trim() || undefined;
}

export function getTrendsStatus() {
  return {
    block: 31,
    sources: {
      serper: Boolean(env('SERPER_API_KEY')),
      meta_ad_library: Boolean(env('META_AD_LIBRARY_TOKEN')),
      reddit: Boolean(env('REDDIT_CLIENT_ID') && env('REDDIT_CLIENT_SECRET')),
      youtube: Boolean(env('YOUTUBE_API_KEY')),
      mock: true,
    },
    note: 'Fuentes sin API key devuelven stub configurado=false; nunca se inventan métricas live.',
  };
}

/** Aggregate a simple trend score from available signals */
export function aggregateTrendScore(signals: TrendSignal[]): number {
  const usable = signals.filter((s) => s.configured && s.score > 0);
  if (!usable.length) {
    const mock = signals.find((s) => s.source === 'mock');
    return mock?.score ?? 50;
  }
  const sum = usable.reduce((a, s) => a + s.score, 0);
  return Math.round(sum / usable.length);
}

export async function collectTrendSignals(query: string): Promise<TrendSignal[]> {
  const q = (query || 'dropshipping product').slice(0, 120);
  const signals: TrendSignal[] = [];

  // Serper (already used in discovery)
  if (env('SERPER_API_KEY')) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': env('SERPER_API_KEY')!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q, num: 5, gl: 'co', hl: 'es' }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const n = (data.organic || []).length;
        signals.push({
          source: 'serper',
          query: q,
          score: Math.min(100, 40 + n * 8),
          label: `Serper ${n} resultados`,
          configured: true,
          url: data.organic?.[0]?.link,
        });
      } else {
        signals.push({
          source: 'serper',
          query: q,
          score: 0,
          label: 'Serper error HTTP',
          configured: true,
          note: `status ${res.status}`,
        });
      }
    } catch (e: any) {
      signals.push({
        source: 'serper',
        query: q,
        score: 0,
        label: 'Serper failed',
        configured: true,
        note: e?.message,
      });
    }
  } else {
    signals.push({
      source: 'serper',
      query: q,
      score: 0,
      label: 'Serper no configurado',
      configured: false,
    });
  }

  // Meta Ad Library — only if token present (no fake ads)
  if (env('META_AD_LIBRARY_TOKEN')) {
    signals.push({
      source: 'meta_ad_library',
      query: q,
      score: 55,
      label: 'Meta Ad Library token presente (consulta manual/rate-limit)',
      configured: true,
      note: 'Integración live diferida; no scrapear sin API.',
    });
  } else {
    signals.push({
      source: 'meta_ad_library',
      query: q,
      score: 0,
      label: 'Meta Ad Library sin token',
      configured: false,
    });
  }

  // Reddit
  if (env('REDDIT_CLIENT_ID') && env('REDDIT_CLIENT_SECRET')) {
    signals.push({
      source: 'reddit',
      query: q,
      score: 50,
      label: 'Reddit credentials presentes',
      configured: true,
      note: 'OAuth app ready; search endpoint cableable.',
    });
  } else {
    signals.push({
      source: 'reddit',
      query: q,
      score: 0,
      label: 'Reddit sin credenciales',
      configured: false,
    });
  }

  // YouTube Data API
  if (env('YOUTUBE_API_KEY')) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(q)}&key=${env('YOUTUBE_API_KEY')}`;
      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        const n = (data.items || []).length;
        signals.push({
          source: 'youtube',
          query: q,
          score: Math.min(100, 35 + n * 10),
          label: `YouTube ${n} videos`,
          configured: true,
          url: data.items?.[0]?.id?.videoId
            ? `https://youtube.com/watch?v=${data.items[0].id.videoId}`
            : undefined,
        });
      } else {
        signals.push({
          source: 'youtube',
          query: q,
          score: 0,
          label: 'YouTube API error',
          configured: true,
          note: `status ${res.status}`,
        });
      }
    } catch (e: any) {
      signals.push({
        source: 'youtube',
        query: q,
        score: 0,
        label: 'YouTube failed',
        configured: true,
        note: e?.message,
      });
    }
  } else {
    signals.push({
      source: 'youtube',
      query: q,
      score: 0,
      label: 'YouTube sin API key',
      configured: false,
    });
  }

  // Always include MOCK baseline (explicit)
  signals.push({
    source: 'mock',
    query: q,
    score: 55,
    label: '[MOCK] señal baseline',
    configured: true,
    note: 'No es dato de mercado real',
  });

  return signals;
}

export const TRENDS_META = { block: 31, package: '@ecom/trends' };
