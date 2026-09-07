# ECOM — Bloque P0 (Webhook · Tracking · E2E · Inventario/Delist)

**Commit package:** `@ecom/ops-p0` + `packages/cj/src/tracking.ts`  
**Fecha:** 2026-09-07

## Qué se entregó

### 1. Webhook Shopify
- Path canónico: **`/shopify/webhooks/orders`** (alineado con `registerOrderWebhook`)
- `verifyShopifyHmac` timing-safe
- **Idempotencia** por `externalId` (pedido duplicado → 200, no segunda Order)
- `processShopifyWebhookRequest` listo para el controller (requiere `rawBody: true`)

### 2. Tracking post-fulfill
- `decideTrackingPoll` — no inventa tracking
- `normalizeCjOrderTracking` — trata `n/a` como placeholder
- `getCjOrderTracking(orderId)` → CJ **getOrderDetail** documentado
- En MOCK: `trackingNumber: null` explícito (no falso MOCKTRACK en este path de poll)

### 3. Prueba E2E (lógica)
```bash
docker compose run --rm workspace pnpm --filter @ecom/ops-p0 test
```
`selfTestP0()` valida HMAC, idempotencia, path, delist, stock 0, tracking n/a.

### 4. Inventario / Delist continuo
- `planInventoryPass` — solo PUBLISHED con cjSku/vid
- `inventoryDelistDecision` — `stock_zero` | `cj_delisted`
- `applyInventoryDecision` — combina `isProductListed` + stock local

Intervalos sugeridos (env):
- `ECOM_INVENTORY_INTERVAL_MINUTES=20`
- `ECOM_TRACKING_INTERVAL_MINUTES=30`

## Cableado en API (si aún no está)

1. **Webhook handler**
   - Capturar raw body
   - `processShopifyWebhookRequest({ rawBody, hmacHeader: req.headers['x-shopify-hmac-sha256'], secret: process.env.SHOPIFY_WEBHOOK_SECRET, existingExternalIds })`
   - Si `create` → insert Order + audit; si auto-fulfill → CJ

2. **Job tracking** cada 30 min
   - Orders FULFILLED sin tracking real
   - `decideTrackingPoll` → `getCjOrderTracking` → si hay número, `createOrderFulfillment` update tracking en Shopify

3. **Job inventario** cada 20 min
   - `planInventoryPass(publishedProducts)`
   - por item `isProductListed(cjSku)` → `applyInventoryDecision` → pause product + Shopify si aplica

4. **Verify**
   - `GET /ops/p0/verify` → `selfTestP0()` (endpoint opcional a añadir)

## Runtime real (tu máquina)

1. `APP_URL` o tunnel HTTPS fijo (ngrok static)
2. `POST /shopify/webhooks/register` con base URL pública
3. Confirmar en Shopify Admin que el webhook apunta a `.../shopify/webhooks/orders`
4. Pedido de prueba paid → Order en ECOM
5. Fulfill → esperar tracking CJ (puede tardar horas; poll reintenta)

## Qué NO hace este bloque
- No activa REAL solo
- No inventa números de tracking
- No sustituye deploy VPS
- No es el Integration Manager del panel (siguiente fase)
