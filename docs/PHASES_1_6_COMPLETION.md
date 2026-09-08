# ECOM — Bloque 6 fases (ejecución)

**Paquete orquestador:** `@ecom/runtime`  
**Commit bloque:** lógica + tests + CI + runbook

## Mapa

| Fase | Nombre | Código | Qué falta en tu máquina |
|------|--------|--------|-------------------------|
| 1 | Cableado P0 | `phase1-wire.ts` | Handlers Nest que llamen estas funciones + HTTPS |
| 2 | Ops 24/7 | `phase2-jobs.ts` | Cron/workers en API bootstrap |
| 3 | Panel | `phase3-panel.ts` | Rutas GET + UI Next |
| 4 | Autopilot | `phase4-autopilot.ts` | Job `autopilot_tick` + flags env |
| 5 | Contenido | `phase5-content.ts` | Attach images CJ; Canva solo con flag |
| 6 | Producción | `phase6-prod.ts` + CI + RUNBOOK | VPS, DNS, backups reales |

## Verificación

```bash
git pull
docker compose run --rm workspace pnpm install
docker compose run --rm workspace pnpm --filter @ecom/runtime test
```

## Self-check programático

```ts
import { runSixPhaseSelfCheck } from '@ecom/runtime';
const report = runSixPhaseSelfCheck(process.env);
// report.allLogicOk === true → lógica de las 6 fases OK
```

## Honestidad

Este bloque **completa la arquitectura y contratos** de las 6 fases y las **prueba unitariamente**.  
No sustituye: un pedido REAL en tu tienda, un VPS encendido, ni cero errores de red de CJ/Shopify.
