# ECOM — Checklist modo REAL

**REAL nunca se activa solo.** Requiere env + verificación humana.

```bash
ECOM_MODE=REAL
ECOM_REAL_CONFIRM=I_UNDERSTAND_REAL_MODE
```

Usar `realModeChecklist` de `@ecom/ops` y/o este documento.

---

## A. Credenciales mínimas

| Item | OK | Notas |
|------|----|-------|
| `SHOPIFY_SHOP_DOMAIN` | ☐ | `*.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` o client_id/secret | ☐ | Admin API |
| `SHOPIFY_WEBHOOK_SECRET` | ☐ | Firma HMAC |
| `CJ_API_KEY` | ☐ | Fulfill + search |
| `SESSION_SECRET` ≥16 chars | ☐ | Auth panel |
| `ECOM_ALLOW_PAID_AI=false` | ☐ | Obligatorio $0 default |
| `TELEGRAM_BOT_TOKEN` + `CHAT_ID` | ☐ | Recomendado alertas |

---

## B. Red / webhooks

| Item | OK |
|------|----|
| URL pública **HTTPS** fija (ngrok static / VPS) | ☐ |
| `API_URL` apunta a esa URL (no localhost en el container) | ☐ |
| Webhook registrado: `…/shopify/webhooks/orders` | ☐ |
| Topic `orders/paid` | ☐ |
| Prueba HMAC: pedido/test no entra sin firma válida | ☐ |
| Idempotencia: mismo order id no duplica Order | ☐ |

---

## C. Seguridad operativa

| Item | OK |
|------|----|
| `ECOM_KILL_SWITCH=false` solo cuando quieras operar | ☐ |
| Caps diarios definidos (`ECOM_MAX_*`) | ☐ |
| `ECOM_AUTO_GO_LIVE=false` salvo decisión consciente | ☐ |
| Primera publicación con aprobación humana (recomendado) | ☐ |
| Backup mental: cómo pausar todo en 10 s | ☐ |

---

## D. Prueba de humo REAL (orden fijo)

1. ☐ Health API OK  
2. ☐ `GET` status Shopify configured  
3. ☐ `GET` status CJ configured  
4. ☐ Ingest o producto con `cjVariantId` real  
5. ☐ Approve + publish **un** producto de prueba  
6. ☐ Imágenes HTTPS visibles en Shopify  
7. ☐ Pedido paid de prueba → webhook → Order en ECOM  
8. ☐ Fulfill CJ (o error real documentado, no silencioso)  
9. ☐ Tracking poll: o número real o `null`/pending **sin inventar**  
10. ☐ Inventario/delist job no tumba productos listados  

Solo si 1–10 son honestos → modo REAL de operación diaria.

---

## E. Comando de verificación lógica (sin gastar API de pago)

```bash
docker compose run --rm workspace pnpm --filter @ecom/ops-p0 test
docker compose run --rm workspace pnpm --filter @ecom/integrations test
docker compose run --rm workspace pnpm --filter @ecom/autonomy test
```

---

## F. Rollback inmediato

```bash
ECOM_KILL_SWITCH=true
ECOM_PAUSE_ALL=true
ECOM_MODE=MOCK
# o docker compose --profile app stop
```
