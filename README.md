# ECOM

Plataforma personal de dropshipping automatizado. Repositorio en modo seguro para desarrollo y depuración.

## Modos de ejecución

- `MOCK`: datos explícitamente simulados; no llama APIs externas ni publica productos.
- `SANDBOX`: integraciones de prueba aprobadas.
- `REAL`: requiere credenciales y validaciones completas; nunca se activa por defecto.

## Bloque 2 (actual)

Incluye:

- Motor de reglas (`@ecom/rules`): margen ideal 40%, mínimo 35%, alerta 30–34.99%, pausa <30% o stock = 0, máx. 2 cambios de precio/día, ±10% por cambio.
- API NestJS: health, rules, products MOCK, approvals, audit, auth MOCK.
- Panel Next.js: listado de candidatos, re-evaluación, solicitudes de aprobación, decisiones y auditoría.
- Esquema Prisma ampliado: roles, passwordHash, price history, confidence, isFirstPublication.
- Pruebas unitarias del motor de reglas.

**Ninguna** integración real (Shopify, CJ, Gemini, pagos) está activa.

## Desarrollo en macOS High Sierra

Node 22 y pnpm **dentro de Docker**. No se requiere Node local.

### Primer arranque / actualizar tras pull

```bash
cd /ruta/a/ecom
git pull
cp .env.example .env   # solo si aún no existe
docker compose down
docker compose up -d --build
docker compose run --rm workspace pnpm install
docker compose run --rm workspace pnpm --filter @ecom/database generate
docker compose run --rm workspace pnpm --filter @ecom/database migrate --name block2
docker compose --profile app up -d
```

### Probar reglas

```bash
docker compose run --rm workspace pnpm --filter @ecom/rules test
```

Servicios:

- Panel: http://localhost:3000
- API health: http://localhost:4000/health
- Productos MOCK: http://localhost:4000/products
- Reglas: http://localhost:4000/rules
- PostgreSQL: localhost:5432
- Redis: localhost:6379

### Comandos útiles

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
docker compose run --rm workspace pnpm test
docker compose --profile app down
```

## Principios de seguridad

- Nunca subir `.env`, tokens, claves ni secretos.
- `MOCK` / `SANDBOX` / `REAL` visibles en UI y auditoría.
- Shopify gestiona pagos, reembolsos y métodos de pago; ECOM no procesa dinero.
- Acciones críticas (primera publicación, nuevo proveedor, eliminación, etc.) requieren aprobación humana.

## Próximos bloques

- Persistencia real con Prisma en API (sustituir store en memoria).
- Auth email/password + sesión + RBAC completo.
- Conectores SANDBOX de Shopify y CJdropshipping.
- AI Router (Gemini + fallbacks) sin cobros automáticos.
- Marketing orgánico y landing pages.
