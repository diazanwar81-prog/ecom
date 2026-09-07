# ECOM — Autonomous Dropshipping Operating System

Plataforma personal de dropshipping automatizado (uso propio, no SaaS multi-tenant en V1).

**Repo:** https://github.com/diazanwar81-prog/ecom  
**Stack:** Turborepo + pnpm · NestJS API · Next.js panel · Prisma + PostgreSQL · Redis + BullMQ · Docker

---

## Modos de ejecución

| Modo | Comportamiento |
|------|----------------|
| `MOCK` | Simulado; no publica ni cumple pedidos reales |
| `SANDBOX` | Integraciones de prueba con gates |
| `REAL` | Live; **nunca** por defecto |

Para REAL hace falta checklist completo +:

```bash
ECOM_MODE=REAL
ECOM_REAL_CONFIRM=I_UNDERSTAND_REAL_MODE
```

Ver: [`docs/REAL_CHECKLIST.md`](docs/REAL_CHECKLIST.md)

---

## Estado actual (honestidad)

| Área | Estado |
|------|--------|
| Núcleo Shopify publish + CJ fulfill | Avanzado |
| Webhook HMAC + path `/shopify/webhooks/orders` | Lógica P0 OK (`@ecom/ops-p0`) |
| Tracking post-fulfill (getOrderDetail) | Paquete listo; cablear jobs en API |
| Inventario / delist continuo | Lógica OK |
| Scoring ponderado | `@ecom/scoring` tests OK |
| Auth password (scrypt + sesión) | En API (no MOCK puro) |
| Centro de integraciones | `@ecom/integrations` (registry + status) |
| Autopilot con constraints | `@ecom/autonomy` |
| Jobs 24/7 registry | `@ecom/jobs` + intervals P0 |
| Canva / landings / marketing | Pendiente (off por defecto) |
| Deploy VPS + CI | Pendiente |

**No** digas “100% terminado”: el núcleo es usable; ops runtime y panel de integraciones se siguen cableando.

---

## Paquetes clave

- `@ecom/rules` — margen, stock, precio
- `@ecom/shopify` / `@ecom/cj` — publish, fulfill, webhooks, tracking
- `@ecom/ops-p0` — HMAC, idempotencia, delist, E2E lógica
- `@ecom/scoring` / `@ecom/discovery` — candidatos
- `@ecom/integrations` — Centro de integraciones (CONNECT/TEST/STATUS)
- `@ecom/autonomy` — autopilot + caps + constraints
- `@ecom/jobs` — colas BullMQ + catálogo de jobs 24/7
- `@ecom/hardening` / `@ecom/ops` — gates, digest, REAL checklist

---

## Desarrollo (Docker obligatorio en Mac)

Node/pnpm **dentro de Docker**. Arranca **Docker Desktop** antes de cualquier comando.

```bash
git pull
cp .env.example .env   # solo la primera vez
docker compose up -d postgres redis
docker compose run --rm workspace pnpm install
docker compose run --rm workspace pnpm --filter @ecom/database generate
docker compose --profile app up -d
```

### Tests recomendados

```bash
docker compose run --rm workspace pnpm --filter @ecom/ops-p0 test
docker compose run --rm workspace pnpm --filter @ecom/scoring test
docker compose run --rm workspace pnpm --filter @ecom/rules test
docker compose run --rm workspace pnpm --filter @ecom/integrations test
docker compose run --rm workspace pnpm --filter @ecom/autonomy test
```

### URLs locales

- Panel: http://localhost:3000
- API health: http://localhost:4000/health
- Postgres: localhost:5432 · Redis: localhost:6379

### Webhooks (pedido real)

1. Túnel HTTPS fijo (`NGROK_AUTHTOKEN` + `NGROK_STATIC_DOMAIN` en `.env`)
2. `API_URL` / `APP_URL` = URL pública https
3. `POST /shopify/webhooks/register`
4. Confirmar address termina en `/shopify/webhooks/orders`
5. Pedido paid de prueba

Docs: [`docs/P0_OPS_BLOCK.md`](docs/P0_OPS_BLOCK.md) · [`docs/REAL_CHECKLIST.md`](docs/REAL_CHECKLIST.md)

---

## Seguridad (no negociable)

- Nunca subir `.env`, tokens ni secretos a Git
- `ECOM_ALLOW_PAID_AI=false` y `ECOM_ALLOW_PAID_ADS=false` por defecto
- Canva / ads de pago **desconectados** hasta autorización explícita
- Shopify procesa dinero; ECOM no guarda tarjetas ni ejecuta cobros
- Primera publicación y acciones críticas: aprobación humana salvo caps de autopilot explícitos
- Kill-switch: `ECOM_KILL_SWITCH=true` / `ECOM_PAUSE_ALL=true`

---

## Autopilot (resumen)

Constraints típicos (env + `@ecom/autonomy`):

- País / moneda
- Margen mínimo
- Caps: productos nuevos, publishes, fulfills, AI calls / día
- `ECOM_AUTO_GO_LIVE` off por defecto
- Modo aprobación: manual | semiauto | auto (con techo diario)

Ver código: `packages/autonomy`

---

## Centro de integraciones

Registry de proveedores: Shopify, CJ, Dropi, Serper/Trends, Telegram, IA, Canva, Pinterest.

Cada uno: `DISCONNECTED | CONNECTED | ERROR | DISABLED` + `testConnection` contract.

Código: `packages/integrations` · UI panel: pendiente de cablear en `/integrations`

---

## Principios

1. No inventar precios, stock, reviews ni tracking
2. Dato externo → `source` + confidence cuando aplique
3. Cost priority MAXIMUM ($0 automático)
4. REAL solo con checklist + confirmación
