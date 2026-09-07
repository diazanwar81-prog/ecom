# ECOM — Fase P3: Dashboard KPIs + Fallbacks

**Paquete:** `@ecom/ops-p3`

## 1. Dashboard KPIs

`buildDashboardKpis(input)` → cards, funnel, orders, capacity, integrations, health.

- **No inventa dinero:** sin `revenueToday`/`costToday` → `UNVERIFIED`
- Health: `healthy` | `degraded` | `critical` (kill-switch, jobs, stock, integraciones)

Cablear en API:

```ts
GET /dashboard/kpis  →  counts from Prisma + buildDashboardKpis(...)
```

Panel: tarjetas desde `cards[]` + `health`.

## 2. Fallbacks

| Pieza | Uso |
|-------|-----|
| `runFallbackChain` | primary → secondary → local → fail_closed |
| `resolveDegradationMode` | full / degraded / read_only / halt |
| `planSupplierFallback` | switch proveedor con/sin aprobación |

Presets: AI copy, fulfill, images, trends.

## Tests

```bash
git pull
docker compose run --rm workspace pnpm install
docker compose run --rm workspace pnpm --filter @ecom/ops-p3 test
```
