# ECOM — Fases 0→6 (estado operativo)

**Actualizado:** 2026-09-04  
**Verificador:** `@ecom/phase-runner` + ver `docs/PHASES_0_2_STATUS.md`

## Fase 0 — Estabilización — **VERIFY PASS**
- [x] Docker API/Web/Postgres/Redis
- [x] Shopify publish + CJ fulfill path
- [x] Publish gate media/copy/margen (`catalog-quality`)
- [x] Kill-switch + smoke (`hardening`)
- [ ] Webhook HTTPS estable en prod (túnel/VPS) — runtime

## Fase 1 — Ops 24/7 — **LOGIC PASS / RUNTIME PARCIAL**
- [x] HMAC Shopify (`ops.verifyShopifyHmac`)
- [x] Pause stock=0 (`stockPauseDecision`)
- [x] Digest diario payload
- [x] Checklist + `realModeGate` (REAL no auto)
- [ ] Job inventario 15–20 min en workers
- [ ] Job tracking poll 30 min
- [ ] Auth sesión real si panel sigue MOCK

## Fase 2 — Scoring — **VERIFY PASS**
- [x] Opportunity Score ponderado (`@ecom/scoring`)
- [x] Saturation Score
- [x] Hard filters + banned categories
- [x] Tests vitest
- [ ] Todas las rutas discovery → `evaluateCandidate`

## Fase 3 — Contenido + Canva
- [ ] Landing HTML por producto
- [ ] Conector Canva (off por defecto)
- [ ] Policy 5 imágenes + video ASSET_PENDING

## Fase 4 — Panel + Autonomía
- [ ] KPIs + módulos completos
- [ ] Autopilot con constraints

## Fase 5 — Infra prod
- [ ] compose.prod + VPS + backups + CI

## Fase 6 — Seguridad & cierre
- [ ] MFA, OpenAPI, E2E, docs instalación

## Verify local
```bash
git pull
docker compose run --rm workspace pnpm --filter @ecom/scoring test
docker compose run --rm workspace pnpm --filter @ecom/phase-runner test
```
