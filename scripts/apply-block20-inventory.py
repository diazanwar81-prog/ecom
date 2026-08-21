#!/usr/bin/env python3
"""Block 20: Shopify inventory sync — set levels on publish + endpoint."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SHOP = ROOT / 'packages/shopify/src/index.ts'
MAIN = ROOT / 'apps/api/src/main.ts'

# --- shopify package ---
s = SHOP.read_text()
if 'setInventoryLevel' not in s:
    append = r'''

export interface InventorySetInput {
  inventoryItemId: string;
  available: number;
  locationId?: string;
}

export interface InventorySetResult {
  ok: boolean;
  mock: boolean;
  available?: number;
  locationId?: string;
  error?: string;
  raw?: unknown;
}

export async function getPrimaryLocationId(): Promise<{ ok: boolean; locationId?: string; error?: string; mock?: boolean }> {
  const status = getShopifyStatus();
  if (!status.canPublishLive) {
    return { ok: true, locationId: 'mock-location', mock: true };
  }
  const token = accessToken();
  const host = shopHost();
  try {
    const res = await fetch(`https://${host}/admin/api/${API_VERSION}/locations.json`, {
      headers: { 'X-Shopify-Access-Token': token! },
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      return { ok: false, error: data?.errors ? JSON.stringify(data.errors) : `locations HTTP ${res.status}` };
    }
    const locs = data?.locations || [];
    const active = locs.find((l: any) => l.active && l.legacy === false) || locs.find((l: any) => l.active) || locs[0];
    if (!active?.id) return { ok: false, error: 'no_location' };
    return { ok: true, locationId: String(active.id) };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'locations network error' };
  }
}

export async function setInventoryLevel(input: InventorySetInput): Promise<InventorySetResult> {
  const status = getShopifyStatus();
  const available = Math.max(0, Math.floor(Number(input.available) || 0));
  if (!input.inventoryItemId) {
    return { ok: false, mock: false, error: 'inventoryItemId required' };
  }

  if (!status.canPublishLive) {
    return {
      ok: true,
      mock: true,
      available,
      locationId: input.locationId || 'mock-location',
      raw: { simulated: true },
    };
  }

  const token = accessToken();
  const host = shopHost();
  let locationId = input.locationId;
  if (!locationId) {
    const loc = await getPrimaryLocationId();
    if (!loc.ok || !loc.locationId) {
      return { ok: false, mock: false, error: loc.error || 'no location' };
    }
    locationId = loc.locationId;
  }

  try {
    const res = await fetch(`https://${host}/admin/api/${API_VERSION}/inventory_levels/set.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token!,
      },
      body: JSON.stringify({
        location_id: Number(locationId),
        inventory_item_id: Number(input.inventoryItemId),
        available,
      }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      return {
        ok: false,
        mock: false,
        error: data?.errors ? JSON.stringify(data.errors) : `inventory set HTTP ${res.status}`,
        raw: data,
      };
    }
    return {
      ok: true,
      mock: false,
      available: data?.inventory_level?.available ?? available,
      locationId,
      raw: data,
    };
  } catch (e: any) {
    return { ok: false, mock: false, error: e?.message || 'inventory network error' };
  }
}
'''
    SHOP.write_text(s + append)
    print('Patched packages/shopify setInventoryLevel')
else:
    print('shopify inventory already present')

# --- main.ts imports ---
t = MAIN.read_text()
if 'setInventoryLevel' not in t:
    t = t.replace(
        'createOrderFulfillment,\n} from \'../../../packages/shopify/src/index\';',
        'createOrderFulfillment,\n  setInventoryLevel,\n  getPrimaryLocationId,\n} from \'../../../packages/shopify/src/index\';',
        1,
    )
    if 'setInventoryLevel' not in t:
        t = t.replace(
            "createOrderFulfillment,\n} from '../../../packages/shopify/src/index';",
            "createOrderFulfillment,\n  setInventoryLevel,\n  getPrimaryLocationId,\n} from '../../../packages/shopify/src/index';",
            1,
        )
    print('import:', 'setInventoryLevel' in t)

# helper after publish in go-live — inject inventory sync after successful publishProduct
SNIP = '''
    let inventorySync: any = null;
    if (result.ok && enriched.stock != null) {
      try {
        const invItemId =
          (result.raw as any)?.product?.variants?.[0]?.inventory_item_id ||
          (result.raw as any)?.product?.variants?.[0]?.inventory_item_id;
        if (invItemId) {
          inventorySync = await setInventoryLevel({
            inventoryItemId: String(invItemId),
            available: Number(enriched.stock) || 0,
          });
          await writeAudit('INVENTORY_SYNC', 'Product', id, inventorySync);
        }
      } catch (e: any) {
        inventorySync = { ok: false, error: e?.message };
      }
    }
'''

# Find go-live return and inject inventorySync into response; after publishProduct result
if "inventorySync" not in t:
    marker = "    if (!result.ok) {\n      await writeAudit('PRODUCT_PUBLISH_FAILED'"
    # more generic: after "const result = await publishProduct" blocks that use imageUrls
    # inject after each successful pattern: "if (!result.ok)" related to publish in goLive

    # After go-live publishProduct call's result handling - look for note Go-live con copy
    old_ret = """      cj: { variantId: enriched.cjVariantId, sku: enriched.cjSku },
      note: "Go-live con copy IA (bloque 16). Título limpio + descripción es-CO. CJ conservado.",
    };
"""
    # flexible search
    idx = t.find('note: "Go-live con copy IA')
    if idx < 0:
        idx = t.find("note: 'Go-live con copy IA")
    if idx < 0:
        idx = t.find('Go-live con copy IA')

    # Inject after `const result = await publishProduct({...});` that includes imageUrls in goLive
    needle = '      imageUrls,\n    });\n'
    positions = []
    start = 0
    while True:
        p = t.find(needle, start)
        if p < 0:
            break
        positions.append(p + len(needle))
        start = p + 1

    if not positions:
        # without trailing comma style
        needle2 = '      imageUrls,\n    });'
        p = t.find(needle2)
        if p >= 0:
            positions = [p + len(needle2)]

    if positions:
        # insert after last publishProduct with imageUrls (go-live)
        pos = positions[-1]
        # skip if next chars already inventorySync
        if 'inventorySync' not in t[pos:pos+200]:
            t = t[:pos] + '\n' + SNIP + t[pos:]
            print('Inserted inventory sync after publishProduct')
    else:
        print('WARN: publishProduct imageUrls block not found')

    # Add inventorySync to go-live return object
    if 'inventorySync,' not in t and 'inventorySync }' not in t:
        t = t.replace(
            'cj: { variantId: enriched.cjVariantId, sku: enriched.cjSku },',
            'cj: { variantId: enriched.cjVariantId, sku: enriched.cjSku },\n      inventorySync,',
            1,
        )
        print('Added inventorySync to go-live return')

# Endpoint sync-inventory on ProductsController
if "sync-inventory" not in t:
    METHOD = r'''
  @Post(':id/sync-inventory')
  async syncInventory(@Param('id') id: string, @Body() body: { available?: number }) {
    const row = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { orderBy: { isPrimary: 'desc' }, take: 1 } },
    });
    if (!row) return { error: 'not_found' };
    if (!row.externalId || String(row.externalId).startsWith('mock')) {
      return { error: 'not_published', reason: 'Sin externalId de Shopify' };
    }
    const enriched = enrichProduct(row);
    const available = body?.available != null ? Number(body.available) : Number(enriched.stock ?? 0);

    // Fetch variant inventory_item_id from Shopify product
    const status = getShopifyStatus();
    if (!status.canPublishLive) {
      const mock = await setInventoryLevel({ inventoryItemId: 'mock', available });
      return { mode: MODE, synced: true, mock: true, available, shopify: mock };
    }

    try {
      const shop = (process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOPIFY_SHOP || '').replace(/\r/g, '').trim();
      const host = shop.includes('.') ? shop : `${shop}.myshopify.com`;
      const token = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
      const ver = process.env.SHOPIFY_API_VERSION || '2026-07';
      const res = await fetch(`https://${host}/admin/api/${ver}/products/${row.externalId}.json`, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      const data = (await res.json()) as any;
      const invItemId = data?.product?.variants?.[0]?.inventory_item_id;
      if (!invItemId) {
        return { error: 'no_inventory_item', raw: data };
      }
      const result = await setInventoryLevel({
        inventoryItemId: String(invItemId),
        available,
      });
      await writeAudit('INVENTORY_SYNC', 'Product', id, result);
      return {
        mode: MODE,
        synced: result.ok,
        mock: result.mock,
        available: result.available ?? available,
        ecomStock: enriched.stock,
        shopify: result,
      };
    } catch (e: any) {
      return { error: e?.message || 'sync_failed' };
    }
  }

'''
    # insert before go-live method if exists
    gl = t.find("@Post(':id/go-live')")
    if gl > 0:
        t = t[:gl] + METHOD + t[gl:]
        print('Inserted sync-inventory endpoint')
    else:
        print('WARN: go-live not found for endpoint insert')

t = t.replace('block: 19,', 'block: 20,', 1)
t = t.replace('ECOM API block-19 (images)', 'ECOM API block-20 (inventory)', 1)

MAIN.write_text(t)
print('Done block 20')
print('  setInventoryLevel import:', 'setInventoryLevel' in t)
print('  sync-inventory:', 'sync-inventory' in t)
print('  block 20:', 'block: 20' in t)
