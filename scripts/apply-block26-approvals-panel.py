#!/usr/bin/env python3
"""Block 26: Approvals panel — API includes product + richer web section."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/api/src/main.ts"
WEB = ROOT / "apps/web/app/page.tsx"

# --- API: enrich approvals list ---
t = MAIN.read_text()
old_list = (
    "  @Get()\n"
    "  async list(@Query('status') status?: string) {\n"
    "    const where = status ? { status: status as ApprovalStatus } : {};\n"
    "    const items = await prisma.approval.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });\n"
    "    return { mode: MODE, count: items.length, items };\n"
    "  }"
)
new_list = (
    "  @Get()\n"
    "  async list(@Query('status') status?: string) {\n"
    "    const where = status ? { status: status as ApprovalStatus } : {};\n"
    "    const rows = await prisma.approval.findMany({\n"
    "      where,\n"
    "      orderBy: { createdAt: 'desc' },\n"
    "      take: 100,\n"
    "      include: {\n"
    "        product: {\n"
    "          include: {\n"
    "            suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' }, take: 1 },\n"
    "          },\n"
    "        },\n"
    "      },\n"
    "    });\n"
    "    const items = rows.map((a) => {\n"
    "      const enriched = a.product ? enrichProduct(a.product) : null;\n"
    "      return {\n"
    "        id: a.id,\n"
    "        productId: a.productId,\n"
    "        action: a.action,\n"
    "        reason: a.reason,\n"
    "        status: a.status,\n"
    "        createdAt: a.createdAt,\n"
    "        decidedAt: a.decidedAt,\n"
    "        product: enriched\n"
    "          ? {\n"
    "              id: enriched.id,\n"
    "              title: enriched.title,\n"
    "              status: enriched.status,\n"
    "              marginPercent: enriched.marginPercent,\n"
    "              marginBand: enriched.marginBand,\n"
    "              opportunityScore: enriched.opportunityScore,\n"
    "              confidence: enriched.confidence,\n"
    "              salePrice: enriched.salePrice,\n"
    "              currency: enriched.currency,\n"
    "              stock: enriched.stock,\n"
    "              supplierName: enriched.supplierName,\n"
    "              verified: enriched.verified,\n"
    "              cjSku: enriched.cjSku,\n"
    "              canPublish: enriched.canPublish,\n"
    "              shouldPause: enriched.shouldPause,\n"
    "            }\n"
    "          : null,\n"
    "      };\n"
    "    });\n"
    "    return { mode: MODE, count: items.length, items };\n"
    "  }"
)
if old_list in t:
    t = t.replace(old_list, new_list, 1)
    print("API approvals list enriched")
else:
    print("WARN: approvals list pattern not found")

t = re.sub(r"block:\s*\d+", "block: 26", t, count=1)
t = re.sub(
    r"void alertOps\('BOOT', \{ service: 'ecom-api', block: \d+ \}\)",
    "void alertOps('BOOT', { service: 'ecom-api', block: 26 })",
    t,
)
MAIN.write_text(t)

# --- WEB: replace Approvals section with richer panel ---
w = WEB.read_text()

# Expand Approval type
if "product?: {" not in w:
    w = w.replace(
        "type Approval = {\n  id: string;\n  productId?: string;\n  action: string;\n  reason: string;\n  status: string;\n  createdAt: string;\n};",
        "type Approval = {\n  id: string;\n  productId?: string;\n  action: string;\n  reason: string;\n  status: string;\n  createdAt: string;\n  product?: {\n    id: string;\n    title: string;\n    status: string;\n    marginPercent?: number;\n    marginBand?: string;\n    opportunityScore?: number;\n    confidence?: number;\n    salePrice?: number;\n    currency?: string;\n    stock?: number;\n    supplierName?: string;\n    verified?: boolean;\n    cjSku?: string | null;\n    canPublish?: boolean;\n    shouldPause?: boolean;\n  } | null;\n};",
        1,
    )
    print("Approval type expanded")

# Filter pending helper after bandColor
if "pendingApprovals" not in w:
    w = w.replace(
        "const bandColor = (b?: string) => {",
        "const pendingApprovals = approvals.filter((a) => a.status === 'PENDING');\n"
        "  const pendingProducts = products.filter((p) => p.status === 'PENDING_APPROVAL');\n\n"
        "  const bandColor = (b?: string) => {",
        1,
    )

# Replace the weak Approvals block
old_ui = """      <h2>Aprobaciones</h2>
        {approvals.length === 0 && <p style={{ color: '#64748b' }}>Sin solicitudes.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {approvals.map((a) => (
            <div key={a.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
              <strong>{a.action}</strong> · {a.status}
              <div style={{ fontSize: 13, color: '#64748b' }}>{a.reason}</div>
              {a.status === 'PENDING' && (
                <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => decide(a.id, 'APPROVED')} style={{ cursor: 'pointer' }}>Aprobar</button>
                  <button type="button" onClick={() => decide(a.id, 'REJECTED')} style={{ cursor: 'pointer' }}>Rechazar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>"""

new_ui = """      <section style={{ marginBottom: '1.75rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Panel de aprobaciones</h2>
        <p style={{ fontSize: 13, color: '#9a3412' }}>
          Pendientes: <strong>{pendingApprovals.length}</strong> solicitudes ·{" "}
          <strong>{pendingProducts.length}</strong> productos en PENDING_APPROVAL
        </p>

        <h3 style={{ fontSize: 15 }}>Solicitudes PENDING</h3>
        {pendingApprovals.length === 0 && (
          <p style={{ color: '#64748b', fontSize: 13 }}>No hay solicitudes pendientes.</p>
        )}
        <div style={{ display: 'grid', gap: 10 }}>
          {pendingApprovals.map((a) => (
            <div key={a.id} style={{ background: '#fff', border: '1px solid #fdba74', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong>{a.product?.title || a.action}</strong>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {a.action} · {a.reason}
                  </div>
                  {a.product && (
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      margen{' '}
                      <span style={{ color: bandColor(a.product.marginBand), fontWeight: 600 }}>
                        {a.product.marginPercent}% ({a.product.marginBand})
                      </span>
                      {' · '}score {a.product.opportunityScore} · conf {a.product.confidence}%
                      {' · '}stock {a.product.stock ?? '—'}
                      {' · '}{a.product.supplierName}
                      {a.product.cjSku ? ` · SKU ${a.product.cjSku}` : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => decide(a.id, 'APPROVED')}
                    style={{ cursor: 'pointer', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px' }}
                  >
                    Solo aprobar
                  </button>
                  {a.productId && (
                    <button
                      type="button"
                      onClick={() => goLive(a.productId!)}
                      style={{ cursor: 'pointer', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px' }}
                    >
                      Aprobar y publicar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => decide(a.id, 'REJECTED')}
                    style={{ cursor: 'pointer', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px' }}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <h3 style={{ fontSize: 15, marginTop: 16 }}>Productos PENDING_APPROVAL (acceso directo)</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {pendingProducts.map((p) => (
            <div key={p.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13 }}>
                <strong>{p.title}</strong>
                <div style={{ color: '#64748b' }}>
                  margen {p.marginPercent}% ({p.marginBand}) · score {p.opportunityScore} · conf {p.confidence}%
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => requestApproval(p.id)} style={{ cursor: 'pointer' }}>
                  Crear solicitud
                </button>
                <button
                  type="button"
                  onClick={() => goLive(p.id)}
                  style={{ cursor: 'pointer', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px' }}
                >
                  Go-live
                </button>
              </div>
            </div>
          ))}
          {pendingProducts.length === 0 && (
            <p style={{ color: '#64748b', fontSize: 13 }}>Ningún producto en PENDING_APPROVAL.</p>
          )}
        </div>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>Historial de aprobaciones ({approvals.length})</summary>
          <ul style={{ fontSize: 12, color: '#475569' }}>
            {approvals.map((a) => (
              <li key={a.id}>
                {a.createdAt} · {a.status} · {a.action} · {a.product?.title || a.productId || '—'}
              </li>
            ))}
          </ul>
        </details>
      </section>"""

if old_ui in w:
    w = w.replace(old_ui, new_ui, 1)
    print("Web approvals panel replaced")
elif "Panel de aprobaciones" in w:
    print("Web panel already present")
else:
    # try looser match: from <h2>Aprobaciones to next section Agent runs
    m = re.search(
        r"<h2>Aprobaciones</h2>.*?(?=<section style=\{\{ marginBottom: '1.75rem' \}\}>\s*<h2>Agent runs</h2>)",
        w,
        re.S,
    )
    if m:
        w = w[: m.start()] + new_ui + "\n\n      " + w[m.end() :]
        print("Web approvals panel replaced (regex)")
    else:
        print("WARN: could not find Approvals UI block")

# Move panel near top after header message — optional: insert marker comment
if "Panel de aprobaciones" in w and "/* APPROVALS_TOP */" not in w:
    # leave where it is if replace worked; also bump footer
    w = w.replace("Panel block 21", "Panel block 26")
    w = w.replace("Ops: pedidos · stock · fulfill", "Ops: aprobaciones · pedidos · publish")

WEB.write_text(w)
print("Done block 26")
