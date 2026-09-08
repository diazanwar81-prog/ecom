# FINAL-4 — Últimas 4 fases (bloque)

| Fase | Código | Endpoint |
|------|--------|----------|
| F1 E2E pedido | `e2e-order.ts` | `GET /ops/final4/e2e/preflight` · `GET /ops/final4/e2e/logic` |
| F2 Ops 24/7 | `ops247.ts` | `GET /ops/final4/ops247` |
| F3 Autopilot | `autopilot-tick.ts` | `POST /ops/final4/autopilot/tick` |
| F4 Producción | `production.ts` | `GET /ops/final4/production` |
| Todo | `runFinal4SelfCheck` | `GET /ops/final4/check` |

## Aplicar

```bash
cd /Users/usuario/Downloads/ecom-v2
git pull
docker compose run --rm workspace pnpm install
docker compose run --rm workspace pnpm --filter @ecom/final-4 test
docker compose run --rm workspace node scripts/apply-final4-main.cjs
docker compose restart api
sleep 12
curl -s http://localhost:4000/ops/final4/check | head -c 1500
```

## E2E pedido (humano + Shopify)

La lógica de F1 valida gates; el pedido paid real se hace en admin Shopify con webhook HTTPS (ver `docs/E2E_ORDER_CHECKLIST.md`).

## Autopilot

```bash
# solo evalúa; no publica si ECOM_AUTOPILOT no está true
curl -s -X POST http://localhost:4000/ops/final4/autopilot/tick -H 'Content-Type: application/json' -d '{}'
```
