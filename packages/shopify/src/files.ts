/**
 * Shopify Files upload (GraphQL stagedUploadsCreate → PUT → fileCreate)
 * Requires scope: write_files (or write_themes on older apps)
 */

import * as fs from 'fs';
import * as path from 'path';
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

export type UploadFileResult = {
  ok: boolean;
  mock: boolean;
  fileId?: string;
  url?: string;
  adminUrl?: string;
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
  const data = await res.json();
  return { httpOk: res.ok, data };
}

/**
 * Upload a local file (e.g. /tmp/...mp4) to Shopify Files CDN.
 */
export async function uploadLocalFileToShopify(input: {
  filePath: string;
  filename?: string;
  mimeType?: string;
  resource?: 'FILE' | 'VIDEO' | 'IMAGE';
}): Promise<UploadFileResult> {
  const status = getShopifyStatus();
  const filePath = input.filePath;
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, mock: false, error: 'file_not_found' };
  }

  const filename =
    input.filename || path.basename(filePath) || `ecom-${Date.now()}.mp4`;
  const mimeType = input.mimeType || 'video/mp4';
  const resource = input.resource || 'FILE';
  const buf = fs.readFileSync(filePath);
  const fileSize = buf.length;

  if (!status.canPublishLive) {
    return {
      ok: true,
      mock: true,
      fileId: `mock-file-${Date.now()}`,
      url: `https://cdn.shopify.com/s/files/mock/${filename}`,
      adminUrl: 'https://admin.shopify.com/store/mock/content/files',
      raw: { simulated: true, filename, fileSize },
    };
  }

  const tokenRes = await ensureShopifyAccessToken();
  if (!tokenRes.ok || !tokenRes.token) {
    return { ok: false, mock: false, error: tokenRes.error || 'no_token' };
  }
  const token = tokenRes.token;

  try {
    // 1) Stage upload
    const stageMutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }
    `;
    const stageVars = {
      input: [
        {
          filename,
          mimeType,
          httpMethod: 'POST',
          resource,
          fileSize: String(fileSize),
        },
      ],
    };
    const stage = await graphql(token, stageMutation, stageVars);
    const targets = stage.data?.data?.stagedUploadsCreate?.stagedTargets;
    const stageErrors = stage.data?.data?.stagedUploadsCreate?.userErrors;
    if (stageErrors?.length) {
      return {
        ok: false,
        mock: false,
        error: stageErrors.map((e: any) => e.message).join('; '),
        raw: stage.data,
      };
    }
    const target = targets?.[0];
    if (!target?.url || !target?.resourceUrl) {
      return {
        ok: false,
        mock: false,
        error:
          stage.data?.errors?.[0]?.message ||
          'staged_upload_failed — ¿scope write_files?',
        raw: stage.data,
      };
    }

    // 2) Upload binary to staged URL (multipart form)
    const form = new FormData();
    for (const p of target.parameters || []) {
      form.append(p.name, p.value);
    }
    form.append('file', new Blob([buf], { type: mimeType }), filename);

    const uploadRes = await fetch(target.url, { method: 'POST', body: form as any });
    if (!uploadRes.ok && uploadRes.status !== 201 && uploadRes.status !== 204) {
      const t = await uploadRes.text().catch(() => '');
      return {
        ok: false,
        mock: false,
        error: `staged_put_http_${uploadRes.status}: ${t.slice(0, 200)}`,
      };
    }

    // 3) fileCreate
    const fileMutation = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            ... on GenericFile { url }
            ... on MediaImage { image { url } }
            ... on Video { originalSource { url } sources { url } }
          }
          userErrors { field message }
        }
      }
    `;
    const fileVars = {
      files: [
        {
          originalSource: target.resourceUrl,
          contentType: resource === 'VIDEO' ? 'VIDEO' : resource === 'IMAGE' ? 'IMAGE' : 'FILE',
          filename,
        },
      ],
    };
    const created = await graphql(token, fileMutation, fileVars);
    const files = created.data?.data?.fileCreate?.files;
    const fileErrors = created.data?.data?.fileCreate?.userErrors;
    if (fileErrors?.length) {
      return {
        ok: false,
        mock: false,
        error: fileErrors.map((e: any) => e.message).join('; '),
        raw: created.data,
      };
    }
    const f = files?.[0];
    if (!f?.id) {
      return {
        ok: false,
        mock: false,
        error:
          created.data?.errors?.[0]?.message ||
          'file_create_failed — revisa scope write_files',
        raw: created.data,
      };
    }

    const url =
      f.url ||
      f.image?.url ||
      f.originalSource?.url ||
      f.sources?.[0]?.url ||
      target.resourceUrl;

    const host = shopHost();
    return {
      ok: true,
      mock: false,
      fileId: f.id,
      url,
      adminUrl: host ? `https://${host}/admin/content/files` : undefined,
      raw: { file: f, resourceUrl: target.resourceUrl },
    };
  } catch (e: any) {
    return { ok: false, mock: false, error: e?.message || 'upload_exception' };
  }
}
