# ECOM

Plataforma personal de dropshipping automatizado. Este repositorio inicia en modo seguro para desarrollo y depuración.

## Modos de ejecución

- `MOCK`: usa datos explícitamente simulados; no llama APIs externas ni publica productos.
- `SANDBOX`: permite integraciones de pruebas aprobadas.
- `REAL`: requiere credenciales y validaciones completas; nunca debe activarse por defecto.

## Requisitos locales

- Docker Desktop y Docker Compose.
- Node.js 22+ y pnpm 9+ para ejecutar las aplicaciones fuera de contenedores.

## Arranque de infraestructura local

```bash
cp .env.example .env
docker compose up -d
```

Esto levanta PostgreSQL en `localhost:5432` y Redis en `localhost:6379`.

## Principios de seguridad

- No subir `.env`, tokens, claves, URLs de producción ni secretos.
- `MOCK`, `SANDBOX` y `REAL` deben mostrarse explícitamente en interfaz y auditoría.
- Shopify gestiona pagos, reembolsos y métodos de pago; ECOM no procesa dinero.
- Las operaciones críticas requieren aprobación y registro de auditoría.

## Estado inicial

El primer commit contiene la infraestructura mínima y el esquema de datos base. Los conectores reales de Shopify, CJdropshipping, IA, almacenamiento, correo y Telegram se habilitarán en commits posteriores con variables de entorno vacías por defecto.
