# ECOM

Plataforma personal de dropshipping automatizado. Este repositorio comienza en modo seguro para desarrollo y depuración.

## Modos de ejecución

- `MOCK`: datos explícitamente simulados; no llama APIs externas ni publica productos.
- `SANDBOX`: integraciones de prueba aprobadas.
- `REAL`: requiere credenciales y validaciones completas; nunca se activa por defecto.

## Desarrollo en macOS High Sierra

El entorno usa Node 22 y pnpm **dentro de Docker**. No se requiere una instalación local de Node, Corepack o pnpm.

### Primer arranque

```bash
cp .env.example .env
docker compose up -d --build
docker compose run --rm workspace pnpm install
docker compose run --rm workspace pnpm --filter @ecom/database generate
docker compose run --rm workspace pnpm --filter @ecom/database migrate --name init
docker compose --profile app up -d
```

Servicios:

- Panel: `http://localhost:3000`
- API: `http://localhost:4000/health`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

### Comandos de desarrollo

```bash
# Ver estado y logs
docker compose ps
docker compose logs -f api
docker compose logs -f web

# Pruebas, lint y Prisma (siempre dentro de Docker)
docker compose run --rm workspace pnpm test
docker compose run --rm workspace pnpm lint
docker compose run --rm workspace pnpm --filter @ecom/database migrate --name nombre_migracion

# Detener servicios sin borrar datos locales
docker compose --profile app down
```

## Principios de seguridad

- Nunca subir `.env`, tokens, claves, URLs de producción ni secretos.
- `MOCK`, `SANDBOX` y `REAL` deben mostrarse explícitamente en interfaz y auditoría.
- Shopify gestiona pagos, reembolsos y métodos de pago; ECOM no procesa dinero.
- Las operaciones críticas requieren aprobación y registro de auditoría.

## Estado inicial

La base contiene infraestructura local, un esquema de datos base y servicios mínimos. Los conectores reales de Shopify, CJdropshipping, IA, almacenamiento, correo y Telegram se habilitarán después, con variables vacías por defecto.
