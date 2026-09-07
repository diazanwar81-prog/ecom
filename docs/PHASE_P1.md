# ECOM — Fase P1 (post P0)

**Entregado en código (2026-09-07)**

1. **README** actualizado (ya no dice “Bloque 2 / nada real”).
2. **Checklist REAL** → `docs/REAL_CHECKLIST.md`.
3. **Centro de integraciones** → `@ecom/integrations` (catalog, status, test config, gates Canva/AI).
4. **Jobs 24/7** → `packages/jobs/src/stable-jobs.ts` (inventory, tracking, digest, autopilot_tick).
5. **Autopilot constraints** → `packages/autonomy/src/constraints.ts`.

## Tests

```bash
docker compose run --rm workspace pnpm install
docker compose run --rm workspace pnpm --filter @ecom/integrations test
docker compose run --rm workspace pnpm --filter @ecom/autonomy test
docker compose run --rm workspace pnpm --filter @ecom/ops-p0 test
```

## Pendiente de cableado UI/API

- Página panel `/integrations`
- Endpoints `GET /integrations`, `POST /integrations/:id/test`
- Schedulers que llamen `shouldRunJob` + handlers P0
- `ECOM_AUTOPILOT=true` solo tras checklist
