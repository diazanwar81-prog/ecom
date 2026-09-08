# Phase-1 cableado API

## Archivos

- `apps/api/src/phase1-runtime-wire.ts` — lógica webhook + tracking + dedupe helpers
- `apps/api/src/main.ts` — puntos de llamada (import + webhook + scheduler + endpoints)

## Endpoints nuevos

| Método | Path | Uso |
|--------|------|-----|
| GET | `/ops/p0/verify` | selfTestP0 |
| POST | `/ops/tracking/poll` | polling CJ tracking |
| POST | `/shopify/webhooks/orders` | HMAC + idempotencia phase1 |

## Scheduler

- inventory (existente)
- **tracking** cada `ECOM_TRACKING_INTERVAL_MINUTES` (default 30)

## Verificar

```bash
git pull
docker compose --profile app up -d --build
curl -s http://localhost:4000/ops/p0/verify | head
curl -s -X POST http://localhost:4000/ops/tracking/poll | head
```
