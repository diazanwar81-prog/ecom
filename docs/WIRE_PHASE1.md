# Phase-1 cableado API

## Archivos

1. `apps/api/src/phase1-runtime-wire.ts` — webhook + tracking + dedupe (ya en main)
2. `scripts/apply-phase1-main.mjs` — parchea `main.ts` con los call sites

## Aplicar en tu Mac

```bash
cd /Users/usuario/Downloads/ecom-v2
git pull
node scripts/apply-phase1-main.mjs
# debe imprimir: Wired phase-1 into apps/api/src/main.ts
# o: Already wired

docker compose --profile app up -d --build
```

## Endpoints

| Método | Path |
|--------|------|
| GET | `/ops/p0/verify` |
| POST | `/ops/tracking/poll` |
| POST | `/shopify/webhooks/orders` (HMAC + idempotencia phase1) |

## Scheduler

- inventory (ya existía)
- tracking cada `ECOM_TRACKING_INTERVAL_MINUTES` (30)

## Probar

```bash
curl -s http://localhost:4000/ops/p0/verify
curl -s -X POST http://localhost:4000/ops/tracking/poll
```
