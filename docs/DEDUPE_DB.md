# Dedupe — constraints Prisma / PostgreSQL

Alineado con `@ecom/ops-p2` (`productDedupeKey`, `orderDedupeKey`).

## Constraints

| Tabla | Constraint | Significado |
|-------|------------|------------|
| `Product` | `@@unique([storeId, dedupeKey])` | No dos productos con la misma clave de dedupe en la misma tienda |
| `Product` | campo `dedupeKey` | Valor de `productDedupeKey()` al crear/ingest |
| `ProductSupplier` | `@@unique([cjVariantId])` | Un mismo VID de CJ solo una vez en el catálogo |
| `Order` | `@@unique([storeId, externalId])` | Idempotencia webhook: un Shopify order id por tienda |

**NULL:** en PostgreSQL varias filas con `dedupeKey` / `externalId` / `cjVariantId` en `NULL` son válidas (filas legacy o sin id externo).

## Migración

```bash
docker compose run --rm workspace pnpm --filter @ecom/database generate
docker compose run --rm workspace pnpm --filter @ecom/database exec prisma migrate deploy
# o, en dev:
docker compose run --rm workspace pnpm --filter @ecom/database exec prisma migrate dev --name dedupe_unique
```

Si falla por **duplicados existentes**, limpia antes:

```sql
-- Ejemplo: pedidos duplicados mismo externalId
SELECT "storeId", "externalId", COUNT(*)
FROM "Order"
WHERE "externalId" IS NOT NULL
GROUP BY 1, 2 HAVING COUNT(*) > 1;
```

## Uso en API (ingest / webhook)

```ts
import { productDedupeKey, orderDedupeKey } from '@ecom/ops-p2';

const dedupeKey = productDedupeKey({ cjVariantId, cjSku, title });
await prisma.product.create({
  data: { storeId, title, dedupeKey, /* ... */ },
});
// P2002 = unique violation → tratar como duplicado

await prisma.order.create({
  data: { storeId, externalId: String(shopifyOrderId), /* ... */ },
});
```
