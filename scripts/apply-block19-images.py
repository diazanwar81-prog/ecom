#!/usr/bin/env python3
"""Block 19: fetch CJ product image and pass imageUrls to publishProduct on go-live."""
from pathlib import Path
import sys

MAIN = Path(__file__).resolve().parents[1] / 'apps/api/src/main.ts'
t = MAIN.read_text()

if 'imageUrls' in t and 'block: 19' in t and 'resolveCjImage' in t:
    print('Already block 19')
    sys.exit(0)

# ensure searchCjProducts import
if 'searchCjProducts' not in t:
    t = t.replace(
        "import { getCjStatus, fulfillOrder } from '../../../packages/cj/src/index';",
        "import { getCjStatus, fulfillOrder, searchCjProducts } from '../../../packages/cj/src/index';",
        1,
    )
    if 'searchCjProducts' not in t:
        t = t.replace(
            "from '../../../packages/cj/src/index';",
            "from '../../../packages/cj/src/index';\n// searchCjProducts used in block 19",
            1,
        )
        # force proper import line
        t = t.replace(
            "fulfillOrder } from '../../../packages/cj/src/index';",
            "fulfillOrder, searchCjProducts } from '../../../packages/cj/src/index';",
            1,
        )

HELPER = r'''
async function resolveCjImageUrls(title: string, sku?: string | null): Promise<string[]> {
  try {
    const keyword =
      (sku && String(sku)) ||
      String(title || '')
        .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 4)
        .join(' ');
    if (!keyword) return [];
    const found = await searchCjProducts({ keyword, pageSize: 3 });
    if (!found.ok) return [];
    const urls = found.items
      .map((p) => p.productImage)
      .filter((u): u is string => Boolean(u && /^https?:\/\//i.test(u)));
    return urls.slice(0, 3);
  } catch {
    return [];
  }
}

'''

if 'async function resolveCjImageUrls' not in t:
    # place before ProductsController / cleanProductTitle
    if 'function cleanProductTitle' in t:
        t = t.replace('function cleanProductTitle', HELPER + 'function cleanProductTitle', 1)
    elif 'class ProductsController' in t:
        t = t.replace('class ProductsController', HELPER + 'class ProductsController', 1)
    else:
        print('WARN: could not insert resolveCjImageUrls helper')

# Patch go-live publishProduct call — find the block with liveTitle
OLD = """    const sku = enriched.cjSku || `ECOM-${id.slice(-8)}`;
    const result = await publishProduct({
      title: liveTitle,
      description: liveDescription || liveTitle,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku,
      inventory: enriched.stock,
    });
"""

NEW = """    const sku = enriched.cjSku || `ECOM-${id.slice(-8)}`;
    // Block 19: attach CJ catalog images when available
    const imageUrls = await resolveCjImageUrls(liveTitle, enriched.cjSku);
    const result = await publishProduct({
      title: liveTitle,
      description: liveDescription || liveTitle,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku,
      inventory: enriched.stock,
      imageUrls,
    });
"""

if OLD not in t:
    # try without liveTitle version (skipAi path might differ)
    OLD2 = """    const result = await publishProduct({
      title: liveTitle,
      description: liveDescription || liveTitle,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku,
      inventory: enriched.stock,
    });
"""
    NEW2 = """    const imageUrls = await resolveCjImageUrls(liveTitle, enriched.cjSku);
    const result = await publishProduct({
      title: liveTitle,
      description: liveDescription || liveTitle,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku,
      inventory: enriched.stock,
      imageUrls,
    });
"""
    if OLD2 in t:
        t = t.replace(OLD2, NEW2, 1)
        print('Patched go-live publish (alt)')
    else:
        print('ERROR: go-live publishProduct block not found')
        sys.exit(1)
else:
    t = t.replace(OLD, NEW, 1)
    print('Patched go-live publish with imageUrls')

# also plain publish if still without images
OLD_P = """    const result = await publishProduct({
      title: enriched.title,
      description: enriched.description,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku: enriched.cjSku || `ECOM-${id.slice(-8)}`,
      inventory: enriched.stock,
    });
"""
NEW_P = """    const imageUrlsPub = await resolveCjImageUrls(enriched.title, enriched.cjSku);
    const result = await publishProduct({
      title: enriched.title,
      description: enriched.description,
      price: enriched.salePrice,
      currency: enriched.currency,
      sku: enriched.cjSku || `ECOM-${id.slice(-8)}`,
      inventory: enriched.stock,
      imageUrls: imageUrlsPub,
    });
"""
if OLD_P in t:
    t = t.replace(OLD_P, NEW_P, 1)
    print('Patched plain publish')

t = t.replace('block: 18,', 'block: 19,', 1)
t = t.replace('ECOM API block-18 (tracking)', 'ECOM API block-19 (images)', 1)

MAIN.write_text(t)
print('Patched block 19')
print('  resolveCjImageUrls:', 'resolveCjImageUrls' in t)
print('  imageUrls:', 'imageUrls' in t)
print('  block 19:', 'block: 19' in t)
