# ECOM — Fase P2

**Paquete:** `@ecom/ops-p2`

| # | Feature | Módulo |
|---|---------|--------|
| 1 | Unificar scoring | `scoreCandidate` / `attachUnifiedScore` → siempre `@ecom/scoring.evaluateCandidate` |
| 2 | Alertas + kill-switch + budget | `gateAction`, `checkBudget`, `formatAlertMessage` |
| 3 | Colas + rate limits | `takeToken`, `withRateLimit`, presets CJ/Shopify/Serper |
| 4 | Caché TTL | `cacheWrap`, `cjSearchCacheKey` |
| 5 | Dedupe fuerte | `productDedupeKey`, `orderDedupeKey`, `claimKey` |

## Tests

```bash
git pull
docker compose run --rm workspace pnpm install
docker compose run --rm workspace pnpm --filter @ecom/ops-p2 test
```

## Cableado API (siguiente)

- Discovery/ingest: reemplazar score suelto por `scoreCandidate`
- Webhook orders: `orderDedupeKey` + claim antes de insert
- CJ search: `cacheWrap(cjSearchCacheKey(...), ...)`
- Antes de publish/AI: `gateAction`
