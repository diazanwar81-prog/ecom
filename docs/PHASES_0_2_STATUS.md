# ECOM — Estado Fases 0 · 1 · 2

**Actualizado:** 2026-09-04  
**Verificador:** `@ecom/phase-runner`

## Resumen

| Fase | Nombre | Paquetes | Verify logic | Cableado API/jobs | Estado global |
|------|--------|----------|--------------|-------------------|---------------|
| **0** | Estabilización | `catalog-quality`, `hardening`, `cj/images` | PASS (phase-runner) | Publish gate + media scripts presentes | **Lógica OK** |
| **1** | Ops 24/7 | `ops`, `jobs`, `notify`, `hardening` | PASS (HMAC, stock pause, digest, checklist) | Jobs periódicos / auth sesión / túnel HTTPS pueden faltar en runtime | **Lógica OK · ops runtime parcial** |
| **2** | Scoring & Discovery | `scoring`, `discovery` | PASS (pesos, saturation, hard filters) | Discovery puede seguir con score simple en algún path | **Lógica OK** |

## Qué está REAL en código (no inventado)

### Fase 0
- `evaluatePublishGate` — bloquea sin imágenes HTTPS reales, copy corto, margen PAUSE, sin CJ id
- Primera publicación → `needsHumanApproval`
- Smoke units + kill-switch en `@ecom/hardening`
- Script `scripts/apply-phase1-media-gate.py`

### Fase 1
- `verifyShopifyHmac` (timing-safe)
- `stockPauseDecision` para inventario
- `buildDailyDigest`
- `realModeChecklist` + `realModeGate` (REAL nunca sin `ECOM_REAL_CONFIRM`)
- BullMQ discovery/pipeline + Telegram notify

### Fase 2
- Opportunity Score ponderado (demanda 40%, margen 20%, …)
- Saturation Score 0–100
- Hard filters: banned keywords, shipping ≤15% PVP, processing ≤3d, margen, stock, supplier
- Tests vitest en `packages/scoring`

## Pendiente de runtime (no bloquea verify de paquetes)

1. Cron/job cada 15–20 min inventario CJ→Shopify sobre PUBLISHED
2. Poll tracking cada 30 min post-fulfill
3. Auth email/password real en panel (si `/auth` sigue MOCK)
4. Webhook HTTPS fijo (ngrok static / VPS) + registro en Shopify
5. Unificar `discoverCandidates` para siempre llamar `evaluateCandidate`

## Cómo verificar

```bash
docker compose run --rm workspace pnpm --filter @ecom/scoring test
docker compose run --rm workspace pnpm --filter @ecom/phase-runner test
# o
cd packages/phase-runner && pnpm exec tsx src/cli-verify.ts
```

## Reglas respetadas

- No se activa REAL automáticamente
- No se publica sin gates / aprobación
- Presupuesto IA de pago sigue `ECOM_ALLOW_PAID_AI=false`
- Phase-runner solo valida; no llama APIs externas de pago
