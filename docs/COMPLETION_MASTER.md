# ECOM — Plan de cierre al 100%

**Fecha:** 2026-08-22  
**Estado actual del código:** bloque ~26 (SANDBOX operativo)  
**Fuentes de verdad:** `ecom respuestas 1.docx`, `respuestas 2.docx`, Prompt Maestro ECOM IA  
**Criterio de “terminado” (docs):** flujo extremo a extremo real + seguridad + pruebas + docs + recuperación + presupuesto $0 automático.

---

## 0. Resumen ejecutivo

| Capa | Completitud | Notas |
|------|-------------|-------|
| Núcleo producto→Shopify→CJ | **~80%** | Publish + fulfill live-ready; tracking parcial |
| Discovery + reglas + orquestador | **~75%** | Falta scoring ponderado completo y multi-fuente |
| Operación 24/7 (webhooks, jobs, inventario) | **~45%** | Túnel temporal; jobs incompletos |
| Seguridad / auth / REAL | **~25%** | Auth MOCK; MFA/RBAC no operativos |
| Contenido (landing, video, multi-canal) | **~15%** | Copy IA básico; sin landing ni redes |
| Marketing / analytics / A/B | **~5%** | No implementado |
| Infra prod + CI/CD + backups | **~10%** | Solo Docker local |
| Documentación completa | **~10%** | README desactualizado |
| **GLOBAL vs especificación completa** | **~40–45%** | |

El software **ya sirve para depurar el núcleo**. No está “completo” según tus 3 archivos.

---

## 1. Lo que YA existe (no rehacer)

- Monorepo Turborepo + pnpm + Docker Compose
- NestJS API monolítica + Next.js panel
- Prisma: User, Store, Product, Supplier, Order, Approval, AgentRun, AuditLog
- `@ecom/rules`: margen 40/35/30, stock, precio ±10%, max 2 cambios/día, auto-publish gates
- `@ecom/ai-router`: Gemini + HF + mock, presupuesto auto $0
- `@ecom/discovery`: MOCK + Serper + match CJ
- `@ecom/orchestrator`: pipeline multiagente
- `@ecom/cj` + `@ecom/shopify`: publish, fulfill, inventory, tracking hooks
- BullMQ: discovery + pipeline + scheduler 30 min
- Panel: productos, pedidos, aprobaciones (React Query optimista), jobs, audit
- Telegram alerts, kill-switch flags, dedupe anti-republicar
- Go-live 1-click con copy IA

---

## 2. Gaps críticos (bloquean “primera venta real 24/7”)

### G1 — Webhook Shopify estable
**Spec:** pedidos reales automáticos; URL HTTPS fija; firma webhook.  
**Hoy:** endpoint existe; depende de `trycloudflare` efímero.  
**Falta:**
- Cloudflare Tunnel **nombrado** o deploy con dominio
- Validación HMAC `X-Shopify-Hmac-Sha256` + `SHOPIFY_WEBHOOK_SECRET`
- Idempotencia por `externalId` (no duplicar pedidos)
- Registro de webhooks en Shopify Admin vía API
- Reintentos / dead-letter

### G2 — Inventario continuo CJ → Shopify
**Spec:** vigilar inventario; pausar stock=0.  
**Hoy:** sync manual por producto.  
**Falta:** job periódico (15–30 min) sobre `PUBLISHED` con `cjSku`/`cjVariantId`; pausar producto si stock=0; alerta Telegram.

### G3 — Tracking fiable post-fulfill
**Spec:** pedido → CJ → tracking → Shopify.  
**Hoy:** fulfill OK; tracking a menudo `n/a`.  
**Falta:** polling CJ por `supplierOrderId`; actualizar Order + Shopify Fulfillment; reintentos 3× backoff; escalar si 24h sin tracking.

### G4 — Auth real del panel
**Spec:** email/password + Google + MFA + RBAC.  
**Hoy:** `/auth/login` MOCK.  
**Falta:** hash bcrypt, sesión/JWT httpOnly, middleware en API y panel, MFA TOTP (fase 2), roles ADMIN/OPERATOR.

### G5 — Modo REAL con checklist
**Spec:** MOCK / SANDBOX / REAL visibles; REAL nunca por defecto.  
**Falta:** endpoint `POST /ops/enable-real` con checklist (keys, webhook, kill-switch, budget=0); audit; confirmación humana.

### G6 — Deploy fuera del Mac
**Spec:** staging/prod VPS (Oracle→Hetzner→DO); $0.  
**Falta:** docker-compose.prod.yml, scripts deploy, backups pg_dump diarios, health externo.

---

## 3. Gaps de producto (spec completa)

### Scoring y discovery
| Requisito docs | Estado |
|----------------|--------|
| Opportunity Score ponderado (demanda 40%, margen 20%, tendencia 12%, proveedor 10%, logística 7%, competencia 6%, estacionalidad 3%, riesgo 2%) | **Parcial** (score simple) |
| Saturation Score 0–100 | **No** |
| Mínimo 55 para continuar | **Sí** (configurable) |
| Google Trends, Meta Ad Library, TikTok Creative Center, Reddit, Pinterest APIs | **No** (solo Serper + MOCK + CJ) |
| Multi-proveedor (AliExpress, Alibaba, Spocket…) | **No** (CJ only por decisión operativa) |
| Descarte 21 reglas (IP, fraude, envío país, etc.) | **Parcial** |
| Tiempo max envío por país / processing ≤3 días | **No automatizado** |
| Envío ≤15% precio venta | **No** |
| Ranking proveedor por producto+país | **Parcial** |
| Productos estacionales con anticipación | **No** |

### Contenido y branding
| Requisito | Estado |
|-----------|--------|
| Nombre + descripción IA | **Sí** |
| Imágenes profesionales / CJ | **Parcial** |
| Vídeos demostrativos | **No** (ASSET_PENDING) |
| Landing page por producto + SEO | **No** |
| UGC / variantes creativas | **No** |
| Branding adaptado por país | **No** |

### Marketing y canales
| Requisito | Estado |
|-----------|--------|
| Instagram / Facebook / TikTok / YouTube / Pinterest / WhatsApp | **No** |
| Marketing orgánico automatizado | **No** |
| A/B testing ≥72h post-publish | **No** |
| UTM + atribución | **No** |
| Google Merchant Center | **No** |

### Pedidos y soporte
| Requisito | Estado |
|-----------|--------|
| Webhook orders | **Parcial** |
| Fulfill CJ | **Sí** |
| Tracking | **Parcial** |
| Soporte rutinario / clasificación incidencias | **No** |
| Devoluciones / casos problemáticos → humano | **Solo diseño** |

### Panel (módulos spec)
Dashboard, Decisiones, Discovery, Product Lab, Proveedores, Precios, Branding, Shopify, Marketing, Analítica, Pedidos, Soporte, IA, Alertas, Auditoría, Config, Monitoreo → **solo un subconjunto operativo**.

### Seguridad y compliance
| Requisito | Estado |
|-----------|--------|
| MFA | Schema sí, runtime no |
| Cifrado secretos | .env local |
| License SBOM checker CI | **No** |
| Categorías prohibidas (armas, drogas, etc.) | **No en rules** |
| No inventar datos faltantes | **Parcial** |

### Ops / entrega
| Requisito | Estado |
|-----------|--------|
| CI/CD GitHub Actions | **No** |
| Playwright E2E | **No** |
| Pruebas carga/seguridad | **No** |
| Docs instalación/arquitectura/API/runbook | **No** |
| Backup/restore probado | **No** |
| Resumen diario 9:00 America/Bogota | **No** |
| Export Excel/CSV historial | **No** |
| OpenAPI/Swagger | **No** |
| R2 object storage | **No** |
| Multi-tienda preparada | Schema 1 store; no OAuth multi |

---

## 4. Decisiones ya tomadas (no reabrir sin aviso)

- Uso personal, 1 admin, no SaaS multi-tenant completo en V1
- Mercado inicial: Colombia / COP / es-CO
- Fulfillment primario: **CJ**
- Margen: ideal ≥40%, mínimo operativo ≥35%, pausa <30% o stock 0
- Primera publicación: **aprobación humana** (práctica actual del panel; coherente con respuestas críticas)
- Presupuesto automático IA/infra: **$0** (bloqueado sin autorización)
- Shopify gestiona pagos; ECOM no toca dinero
- Multi-proveedor: diferido; arquitectura con `Supplier` ya preparada

---

## 5. Roadmap de bloques restantes (orden de dependencia)

### BLOQUE 27 — Ops 24/7 crítico ⬅️ implementar primero
1. HMAC webhooks Shopify + idempotencia pedidos  
2. Job inventario CJ→Shopify cada 20 min  
3. Job polling tracking CJ cada 30 min  
4. Job digest diario 9:00 America/Bogota (Telegram + panel)  
5. Auth email/password real (sesión) para panel  
6. Checklist enable-REAL  
7. Export CSV auditoría/productos  

### BLOQUE 28 — Scoring completo
- Fórmula Opportunity Score ponderada  
- Saturation Score  
- Filtros hard de las 21 reglas + categorías prohibidas  
- Envío ≤15% PVP; processing ≤3d  

### BLOQUE 29 — Contenido ampliado
- Landing page HTML estática por producto (R2 o `/public/landings`)  
- Pipeline imágenes (CJ + Gemini image si free)  
- Estado ASSET_PENDING para vídeo  

### BLOQUE 30 — Panel completo v2
- Módulos: Dashboard KPIs, Proveedores, Alertas, Config reglas  
- Lista verificación diaria  
- Historial exportable  

### BLOQUE 31 — Multi-fuente tendencias
- Adaptadores: Meta Ad Library, Reddit, YouTube Data (solo APIs oficiales free)  
- Rate limits Serper  

### BLOQUE 32 — Marketing orgánico (adapters)
- Borradores por canal; publicar solo con credenciales reales  
- Nunca fingir publicación  

### BLOQUE 33 — Analytics + pricing job
- Márgenes reales post-venta  
- Job precio ±10% max 2/día con datos  
- Pausar bajo rendimiento (ventana configurable)  

### BLOQUE 34 — Soporte
- Clasificación consultas; respuestas plantilla; escalado humano  

### BLOQUE 35 — Multi-país / multi-tienda prep
- Store por mercado; moneda; timezone  
- OAuth Shopify por tienda  

### BLOQUE 36 — Infra + CI/CD
- GitHub Actions: test + lint + docker build  
- compose.prod + backup script  
- Deploy guide Oracle/Hetzner  

### BLOQUE 37 — Seguridad avanzada
- MFA TOTP  
- Rotación tokens  
- License checker  

### BLOQUE 38 — Docs + aceptación
- README actualizado, arquitectura, runbook, API OpenAPI  
- E2E Playwright flujo completo  
- Evidencia backup/restore  

### BLOQUE 39 — Multi-proveedor (si se reactiva)
- AliExpress/otros solo con API oficial  
- Ranking por producto+país  

### BLOQUE 40 — Canales shopping
- Google Merchant, Meta Shop, etc. cuando haya cuentas reales  

---

## 6. Criterio de aceptación final (de tus docs)

ECOM solo se considera **entregado** cuando:

1. Flujo real: descubrir → puntuar → aprobar → publicar Shopify → pedido webhook → fulfill CJ → tracking → métricas  
2. Integraciones críticas reales (no MOCK etiquetado como real)  
3. Auth + auditoría + kill-switch  
4. Pruebas unitarias + integración + E2E de flujos críticos  
5. Backup restaurado con éxito al menos una vez  
6. Documentación permite instalar desde cero sin conocimiento privado  
7. Presupuesto automático $0 respetado  
8. Panel en español operable por el admin solo  

---

## 7. Qué NO entra en “completar el núcleo” (explícito)

- SaaS multi-tenant completo  
- Procesar pagos/reembolsos dentro de ECOM  
- Scraping de sitios que prohíben bots  
- Campañas de ads de pago sin aprobación  
- Inventar datos de coste/stock/tendencia  
- Reescritura autónoma de código de producción por IA  

---

## 8. Próximo paso inmediato

**Implementar BLOQUE 27 (Ops 24/7)** en el repositorio: webhooks firmados, jobs inventario/tracking/digest, auth sesión, export CSV, checklist REAL.

Luego BLOQUE 28 (scoring) y 29 (landing/assets).
