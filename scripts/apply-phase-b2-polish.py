#!/usr/bin/env python3
"""Phase B2: wire polishBrandDescription + filterShopifyOnlyImages into brand + go-live."""
from pathlib import Path
import re

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

# Expand phase-b import
old_imp = """import {
  PHASE_B_META,
  buildPhaseBChecks,
  summarizePhaseB,
  buildBrandMediaSlots,
  validateBrandPack,
  cleanBrandTitle,
  filterHttpsImages,
} from '../../../packages/phase-b/src/index';"""

new_imp = """import {
  PHASE_B_META,
  buildPhaseBChecks,
  summarizePhaseB,
  buildBrandMediaSlots,
  validateBrandPack,
  cleanBrandTitle,
  filterHttpsImages,
  filterShopifyOnlyImages,
  polishBrandDescription,
  isPlaceholderImageUrl,
} from '../../../packages/phase-b/src/index';"""

if 'polishBrandDescription' not in text:
    if old_imp in text:
        text = text.replace(old_imp, new_imp)
    elif "from '../../../packages/phase-b/src/index'" in text:
        text = text.replace(
            "  filterHttpsImages,\n} from '../../../packages/phase-b/src/index';",
            "  filterHttpsImages,\n  filterShopifyOnlyImages,\n  polishBrandDescription,\n  isPlaceholderImageUrl,\n} from '../../../packages/phase-b/src/index';",
        )

# In brand handler: after liveDescription assignment, polish it
marker = "const liveDescription =\n      brief?.description ||\n      p.description ||\n      `${baseTitle}. Selección para Colombia, uso diario, envío con seguimiento.`;"

polish_block = """let liveDescription =
      brief?.description ||
      p.description ||
      `${baseTitle}. Selección para Colombia, uso diario, envío con seguimiento.`;
    liveDescription = polishBrandDescription({
      description: liveDescription,
      productName: brief?.productName,
      title: liveTitle,
      rawSupplierTitle: p.title,
    });"""

if 'polishBrandDescription({' not in text and marker in text:
    text = text.replace(marker, polish_block)

# Alternative single-line patterns
if 'polishBrandDescription({' not in text:
    alt = "const liveDescription =\n      brief?.description ||\n      p.description ||"
    if alt in text:
        text = text.replace(
            "const liveDescription =",
            "let liveDescription =",
            1,
        )
        # insert polish after the assignment block ends with semicolon following baseTitle line
        needle = "`${baseTitle}. Selección para Colombia, uso diario, envío con seguimiento.`;"
        if needle in text:
            text = text.replace(
                needle,
                needle
                + """
    liveDescription = polishBrandDescription({
      description: liveDescription,
      productName: brief?.productName,
      title: liveTitle,
      rawSupplierTitle: p.title,
    });""",
                1,
            )

# imageUrlsForShopify already from buildBrandMediaSlots — ensure response uses filter
# Patch shopifyReady imageUrls line if present
if "imageUrls: slots.imageUrlsForShopify" in text and "filterShopifyOnlyImages(slots" not in text:
    text = text.replace(
        "imageUrls: slots.imageUrlsForShopify",
        "imageUrls: filterShopifyOnlyImages(slots.imageUrlsForShopify || [])",
    )

# go-live: after resolveCjImageUrls, filter placeholders before publishProduct
if 'filterShopifyOnlyImages(imageUrls' not in text:
    # common pattern in go-live
    patterns = [
        (
            "const imageUrls = await resolveCjImageUrls(liveTitle, enriched.cjSku);\n    const result = await publishProduct({",
            "const imageUrlsRaw = await resolveCjImageUrls(liveTitle, enriched.cjSku);\n    const imageUrls = filterShopifyOnlyImages(imageUrlsRaw || []);\n    const result = await publishProduct({",
        ),
        (
            "const imageUrlsPub = await resolveCjImageUrls(enriched.title, enriched.cjSku);\n    const result = await publishProduct({",
            "const imageUrlsPubRaw = await resolveCjImageUrls(enriched.title, enriched.cjSku);\n    const imageUrlsPub = filterShopifyOnlyImages(imageUrlsPubRaw || []);\n    const result = await publishProduct({",
        ),
    ]
    for a, b in patterns:
        if a in text:
            text = text.replace(a, b)

# verify: shopifyFiltersPlaceholders: true
if 'shopifyFiltersPlaceholders' not in text:
    text = text.replace(
        'hasCjImageResolver: typeof resolveCjImageUrls === \'function\',
',
        "hasCjImageResolver: typeof resolveCjImageUrls === 'function',\n      shopifyFiltersPlaceholders: true,\n",
    )
    text = text.replace(
        'hasCjImageResolver: typeof resolveCjImageUrls === "function",
',
        'hasCjImageResolver: typeof resolveCjImageUrls === "function",\n      shopifyFiltersPlaceholders: true,\n',
    )

MAIN.write_text(text, encoding='utf-8')
print('Patched', MAIN)
print('polishBrandDescription:', 'polishBrandDescription' in text)
print('filterShopifyOnlyImages:', 'filterShopifyOnlyImages' in text)
