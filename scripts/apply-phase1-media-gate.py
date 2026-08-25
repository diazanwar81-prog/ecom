#!/usr/bin/env python3
"""Phase 1: media CJ by vid, publish gate, copy parse. Run: python3 scripts/apply-phase1-media-gate.py"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1] if Path(__file__).parent.name == 'scripts' else Path.cwd()
MAIN = ROOT / 'apps' / 'api' / 'src' / 'main.ts'
text = MAIN.read_text()
orig = text

if 'resolveCjProductImages' not in text:
    text = text.replace('matchCjByKeyword,', 'matchCjByKeyword,\n  resolveCjProductImages,\n  getCjVariantByVid,', 1)

if 'evaluatePublishGate' not in text and 'catalog-quality' not in text:
    inj = "import { evaluatePublishGate, cleanCommercialTitle } from '../../../packages/catalog-quality/src/index';\n"
    pos = text.find("\n", text.find("from '@nestjs"))
    if pos < 0:
        pos = text.find('\n')
    text = text[: pos + 1] + inj + text[pos + 1 :]

if 'parseProductCopy' not in text and 'generateProductCopy' in text:
    text = text.replace('generateProductCopy,', 'generateProductCopy,\n  parseProductCopy,', 1)

NEW_RESOLVE = '''async function resolveCjImageUrls(\n  title: string,\n  sku?: string | null,\n  vid?: string | null,\n): Promise<string[]> {\n  try {\n    if (typeof resolveCjProductImages === 'function') {\n      const r = await resolveCjProductImages({ vid: vid || undefined, sku: sku || undefined, title, limit: 6 });\n      if (r.urls?.length) return r.urls;\n    }\n  } catch {}\n  const urls: string[] = [];\n  const push = (u: unknown) => {\n    const s = String(u || '').trim();\n    if (s && /^https?:\\/\\//i.test(s) && !urls.includes(s)) urls.push(s);\n  };\n  try {\n    if (sku) {\n      const bySku = await searchCjProducts({ keyword: String(sku).trim(), pageSize: 5 });\n      for (const item of bySku.items || []) push(item.productImage);\n    }\n  } catch {}\n  return urls.slice(0, 6);\n}\n'''

pat = re.compile(r'async function resolveCjImageUrls\([\s\S]*?\n\}\n\nfunction cleanProductTitle', re.M)
if pat.search(text):
    text = pat.sub(NEW_RESOLVE.strip() + '\n\nfunction cleanProductTitle', text)
    print('resolveCjImageUrls replaced')
else:
    print('WARN: resolveCjImageUrls pattern not found')

old_sync = 'const urls = await resolveCjImageUrls(p.title, primary ? primary.cjSku : null);'
new_sync = 'const urls = await resolveCjImageUrls(p.title, primary ? primary.cjSku : null, primary ? primary.cjVariantId : null);'
if old_sync in text:
    text = text.replace(old_sync, new_sync)
    print('syncMedia vid wired')

old_img = 'const imageUrls = await resolveCjImageUrls(liveTitle, enriched.cjSku);'
new_img = 'const imageUrls = await resolveCjImageUrls(liveTitle, enriched.cjSku, enriched.cjVariantId);'
text = text.replace(old_img, new_img)

GATE = '''\n    const gateImages = (Array.isArray(enriched.imageUrls) && enriched.imageUrls.length)\n      ? enriched.imageUrls\n      : await resolveCjImageUrls(liveTitle, enriched.cjSku, enriched.cjVariantId);\n    const gate = evaluatePublishGate({\n      cjSku: enriched.cjSku,\n      cjVariantId: enriched.cjVariantId,\n      verified: enriched.verified,\n      stock: enriched.stock,\n      marginPercent: enriched.marginPercent,\n      marginBand: enriched.marginBand,\n      imageUrls: gateImages,\n      description: liveDescription || enriched.description,\n      title: liveTitle,\n      opportunityScore: enriched.opportunityScore,\n      confidence: enriched.confidence,\n      isFirstPublication: false,\n      approvalStatus: 'APPROVED',\n      strictBranding: String(process.env.ECOM_STRICT_BRANDING || '').toLowerCase() === 'true',\n    });\n    if (!gate.canPublish) {\n      await writeAudit('GO_LIVE_BLOCKED', 'Product', id, gate);\n      return { mode: MODE, error: 'quality_gate_blocked', reasons: gate.reasons, messages: gate.messages, checks: gate.checks, snapshot: gate.snapshot };\n    }\n'''

marker = '    const sku = enriched.cjSku || `ECOM-${id.slice(-8)}`;\n    // Block 19: attach CJ catalog images when available'
if marker in text and 'quality_gate_blocked' not in text:
    text = text.replace(marker, GATE + '\n' + marker, 1)
    print('go-live gate injected')

text = re.sub(r'block:\s*\d+', 'block: 101', text, count=1)

if text == orig:
    print('No changes applied')
    raise SystemExit(1)
MAIN.write_text(text)
print(f'Patched {MAIN}')
print('OK phase1 media+gate')
