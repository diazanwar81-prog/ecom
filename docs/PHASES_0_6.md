# ECOM — Fases 0→6 (estado operativo)

**Actualizado:** 2026-08-25  
**Bloque código media/gate:** 101 (Phase 1 critical path)

## Fase 0 — Infra (casi lista)
- [x] Docker API/Web/Postgres/Redis
- [x] Shopify publish live + inventario
- [x] CJ fulfill path
- [x] Panel, reglas, colas, discovery
- [ ] Webhook HTTPS estable (túnel nombrado / VPS)

## Fase 1 — Catálogo vendible ← **EN CURSO**
- [x] `resolveCjProductImages` (vid → variantImage + sku/title fallback) en `@ecom/cj`
- [x] `evaluatePublishGate` (media, copy, margen, CJ) en `@ecom/catalog-quality`
- [x] `parseProductCopy` + prompt estricto en `@ecom/ai-router`
- [ ] Aplicar `scripts/apply-phase1-media-gate.py` en `main.ts` (go-live bloquea sin fotos)
- [ ] Verificar sync-media count > 0 con vid real
- [ ] Publish Shopify con `images[]` pobladas

**Comando local:**
```bash
git pull
python3 scripts/apply-phase1-media-gate.py
git add -A && git commit -m "feat: phase1 media vid + publish gate + copy parse" && git push
docker compose --profile app up -d --force-recreate
```

## Fase 2 — Primera venta real
- [ ] HMAC webhook + idempotencia
- [ ] Fulfill con vid del producto vendido
- [ ] Tracking visible
- [ ] Pedido de prueba pagado

## Fase 3 — 24/7
- [ ] URL pública fija
- [ ] Jobs inventario / tracking / digest
- [ ] Alertas Telegram fiables

## Fase 4 — Branding completo + landing
- [ ] 4+1 fotos policy
- [ ] Landing HTML por producto (phase-c)
- [ ] Video opcional

## Fase 5 — Crecimiento
- [ ] Discovery útil (menos MOCK)
- [ ] Auto-approve conservador
- [ ] Ads solo con credenciales

## Fase 6 — Cierre spec
- [ ] Auth real, CI, docs, backups

## Criterio “primera venta”
Fase 1 cerrada (ficha con fotos) + Fase 2 (pedido→fulfill). No requiere Fase 4–6.
