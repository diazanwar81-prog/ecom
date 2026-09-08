# E2E — Pedido paid real / sandbox

Prerrequisitos (tu Mac ya tiene docker + ngrok container a menudo):

1. `ECOM_MODE=SANDBOX` o `REAL` solo con checklist
2. `API_URL=https://TU_NGROK` (sin slash final)
3. `SHOPIFY_WEBHOOK_SECRET` configurado
4. CJ + Shopify tokens válidos

## Pasos

```bash
# 1) Ver URL pública ngrok (si usas el servicio del compose)
curl -s http://localhost:4040/api/tunnels | head -c 800

# 2) Registrar webhook (path canónico phase1)
curl -s -X POST http://localhost:4000/shopify/webhooks/register \
  -H 'Content-Type: application/json' \
  -d '{"callbackUrl":"https://TU_DOMINIO_NGROK"}'

# 3) Verificar lógica P0
curl -s http://localhost:4000/ops/p0/verify

# 4) Crear pedido paid de prueba en Shopify (admin)
# 5) Confirmar Order en ECOM y auto-fulfill
curl -s http://localhost:4000/ops/tracking/poll
```

## KPIs (tras phase-3 wire)

```bash
curl -s http://localhost:4000/dashboard/kpis
curl -s http://localhost:4000/ops/runtime/six-phase
curl -s http://localhost:4000/dashboard/integrations
```

## Señales de éxito

- Webhook → Order creada (no duplicate en reenvío)
- Auto-fulfill CJ o nota de error real (nunca tracking inventado)
- `tracking/poll` → skip | poll_empty | polled
- KPIs `health` coherente con kill-switch / integraciones
