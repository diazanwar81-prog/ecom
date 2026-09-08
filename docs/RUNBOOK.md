# ECOM Runbook (Fase 6)

## Arranque local

1. Docker Desktop ON
2. `git pull && docker compose up -d postgres redis`
3. `docker compose run --rm workspace pnpm install`
4. `docker compose run --rm workspace pnpm --filter @ecom/database generate`
5. `docker compose run --rm workspace sh -c "cd packages/database && pnpm exec prisma migrate deploy"`
6. `docker compose --profile app up -d`
7. Health: `curl -s http://localhost:4000/health`

## Kill switch (emergencia)

```bash
# en .env
ECOM_KILL_SWITCH=true
ECOM_PAUSE_ALL=true
# reiniciar api o endpoint de kill si existe
```

## Webhook REAL

1. `API_URL=https://TU-DOMINIO`
2. Registrar webhook → path `/shopify/webhooks/orders`
3. Pedido paid de prueba
4. Verificar Order en DB y fulfill CJ

## Jobs

| Job | Intervalo env |
|-----|----------------|
| inventory_delist | ECOM_INVENTORY_INTERVAL_MINUTES=20 |
| tracking_poll | ECOM_TRACKING_INTERVAL_MINUTES=30 |
| discovery | ECOM_DISCOVERY_INTERVAL_MINUTES=30 |

## Rollback

1. Kill switch ON
2. `ECOM_MODE=MOCK`
3. `docker compose --profile app stop`
4. Revisar `AuditLog` / logs api

## Backup (VPS)

```bash
# ejemplo
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
```
