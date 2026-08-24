/**
 * Attach uploaded video (or image) to a Shopify product via GraphQL productCreateMedia.
 */

import {
  ensureShopifyAccessToken,
  getShopifyStatus,
} from './index';

function env(name: string, fallback = '') {
  return (process.env[name] ?? fallback).replace(/\r/g, '').trim();
}

function shopHost() {
  const shop = env('SHOPIFY_SHOP_DOMAIN') || env('SHOPIFY_SHOP');
  if (!shop) return null;
  return shop.includes('.') ? shop : `${shop}.myshopify.com`;
}

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

export type AttachMediaResult = {
  ok: boolean;
  mock: boolean;
  mediaIds?: string[];
  error?: string;
  raw?: unknown;
};

async function graphql(token: string, query: string, variables?: Record<string, unknown>) {
  const host = shopHost();
  if (!host) throw new Error('missing_shop_domain');
  const res = await fetch(`https://${host}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  return { httpOk: res.ok, data: await res.json() };
}

function toProductGid(productId: string | number): string {
  const s = String(productId);
  if (s.startsWith('gid://')) return s;
  const n = s.replace(/\D/g, '') || s;
  return `gid://shopify/Product/${n}`;
}

/**
 * Attach a media source (video/image URL or staged resourceUrl) to a product.
 */
export async function attachMediaToProduct(input: {
  productId: string | number;
  originalSource: string;
  mediaContentType?: 'VIDEO' | 'IMAGE' | 'EXTERNAL_VIDEO' | 'MODEL_3D';
  alt?: string;
}): Promise<AttachMediaResult> {
  const status = getShopifyStatus();
  if (!input.productId || !input.originalSource) {
    return { ok: false, mock: false, error: 'productId_and_originalSource_required' };
  }

  if (!status.canPublishLive) {
    return {
      ok: true,
      mock: true,
      mediaIds: [`mock-media-${Date.now()}`],
      raw: { simulated: true, ...input },
    };
  }

  const tokenRes = await ensureShopifyAccessToken();
  if (!tokenRes.ok || !tokenRes.token) {
    return { ok: false, mock: false, error: tokenRes.error || 'no_token' };
  }

  const productGid = toProductGid(input.productId);
  const mediaContentType = input.mediaContentType || 'VIDEO';

  const mutation = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on Video {
            id
            status
            originalSource { url }
          }
          ... on MediaImage {
            id
            status
            image { url }
          }
          ... on ExternalVideo {
            id
            status
          }
        }
        mediaUserErrors { field message code }
        product { id title }
      }
    }
  `;

  try {
    const result = await graphql(tokenRes.token, mutation, {
      productId: productGid,
      media: [
        {
          originalSource: input.originalSource,
          mediaContentType,
          alt: input.alt || 'ECOM video',
        },
      ],
    });

    const payload = result.data?.data?.productCreateMedia;
    const errors = payload?.mediaUserErrors || result.data?.errors;
    if (errors?.length) {
      return {
        ok: false,
        mock: false,
        error: errors
          .map((e: any) => e.message || JSON.stringify(e))
          .join('; '),
        raw: result.data,
      };
    }

    const media = payload?.media || [];
    const mediaIds = media.map((m: any) => m?.id).filter(Boolean);
    if (!mediaIds.length) {
      return {
        ok: false,
        mock: false,
        error: 'no_media_returned',
        raw: result.data,
      };
    }

    return {
      ok: true,
      mock: false,
      mediaIds,
      raw: result.data,
    };
  } catch (e: any) {
    return { ok: false, mock: false, error: e?.message || 'attach_exception' };
  }
}
