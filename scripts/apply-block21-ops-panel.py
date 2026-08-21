#!/usr/bin/env python3
"""Block 21: enhance web ops panel with orders, sync-inventory, fulfill."""
from pathlib import Path
import sys

PAGE = Path(__file__).resolve().parents[1] / "apps/web/app/page.tsx"
t = PAGE.read_text()

if "syncInventory" in t and "Pedidos" in t:
    print("Already block 21 panel")
    sys.exit(0)

if "const [orders, setOrders]" not in t:
    t = t.replace(
        "const [jobs, setJobs] = useState<any[]>([]);\n",
        "const [jobs, setJobs] = useState<any[]>([]);\n  const [orders, setOrders] = useState<any[]>([]);\n",
        1,
    )

if "setOrders(" not in t:
    t = t.replace(
        "const j = await fetch(`${API}/jobs`).then((x) => x.json());\n        setJobs(j.items || []);",
        "const j = await fetch(`${API}/jobs`).then((x) => x.json());\n        setJobs(j.items || []);\n        const o = await fetch(`${API}/orders`).then((x) => x.json()).catch(() => ({ items: [] }));\n        setOrders(o.items || []);",
        1,
    )

if "async function syncInventory" not in t:
    helpers = (
        "\n"
        "  async function syncInventory(id: string) {\n"
        "    setMessage(null);\n"
        "    const res = await fetch(`${API}/products/${id}/sync-inventory`, {\n"
        "      method: 'POST',\n"
        "      headers: { 'Content-Type': 'application/json' },\n"
        "      body: JSON.stringify({}),\n"
        "    });\n"
        "    const data = await res.json();\n"
        "    if (data.error) setMessage(`Inventory: ${data.error}`);\n"
        "    else setMessage(`Inventory OK · available=${data.available} · ecom=${data.ecomStock}`);\n"
        "    await load();\n"
        "  }\n\n"
        "  async function fulfillOrder(id: string) {\n"
        "    setMessage(null);\n"
        "    const res = await fetch(`${API}/orders/${id}/fulfill`, { method: 'POST' });\n"
        "    const data = await res.json();\n"
        "    if (data.error) setMessage(`Fulfill: ${data.error}`);\n"
        "    else setMessage(`Fulfill OK · ${data.cj?.supplierOrderId || data.order?.status}`);\n"
        "    await load();\n"
        "  }\n\n"
        "  async function syncTracking(id: string) {\n"
        "    setMessage(null);\n"
        "    const res = await fetch(`${API}/orders/${id}/sync-tracking`, {\n"
        "      method: 'POST',\n"
        "      headers: { 'Content-Type': 'application/json' },\n"
        "      body: JSON.stringify({ notifyCustomer: false }),\n"
        "    });\n"
        "    const data = await res.json();\n"
        "    if (data.error) setMessage(`Tracking: ${data.error}`);\n"
        "    else setMessage(`Tracking OK · ${data.trackingNumber || data.shopify?.fulfillmentId}`);\n"
        "    await load();\n"
        "  }\n\n"
    )
    t = t.replace(
        "  const bandColor = (b?: string) => {",
        helpers + "  const bandColor = (b?: string) => {",
        1,
    )

if "syncInventory(p.id)" not in t:
    t = t.replace(
        "onClick={() => publish(p.id)} style={{ cursor: 'pointer' }}>Publicar</button>",
        "onClick={() => publish(p.id)} style={{ cursor: 'pointer' }}>Publicar</button>\n"
        "                <button type=\"button\" onClick={() => syncInventory(p.id)} style={{ cursor: 'pointer' }}>Sync stock</button>",
        1,
    )

if "<h2>Pedidos" not in t:
    section = (
        "\n"
        "      <section style={{ marginBottom: '1.75rem' }}>\n"
        "        <h2>Pedidos ({orders.length})</h2>\n"
        "        {orders.length === 0 && <p style={{ color: '#64748b' }}>Sin pedidos.</p>}\n"
        "        <div style={{ display: 'grid', gap: 8 }}>\n"
        "          {orders.map((o) => (\n"
        "            <div key={o.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>\n"
        "              <strong>{o.orderNumber || o.id}</strong> · {o.status} · {o.total} {o.currency}\n"
        "              <div style={{ fontSize: 12, color: '#64748b' }}>\n"
        "                {o.email || 'sin email'} · {o.fulfillmentNote || ''}\n"
        "              </div>\n"
        "              <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>\n"
        "                {o.status !== 'FULFILLED' && (\n"
        "                  <button type=\"button\" onClick={() => fulfillOrder(o.id)} style={{ cursor: 'pointer' }}>Fulfill CJ</button>\n"
        "                )}\n"
        "                <button type=\"button\" onClick={() => syncTracking(o.id)} style={{ cursor: 'pointer' }}>Sync tracking Shopify</button>\n"
        "              </div>\n"
        "            </div>\n"
        "          ))}\n"
        "        </div>\n"
        "      </section>\n\n"
    )
    if "<h2>Aprobaciones</h2>" in t:
        t = t.replace("<h2>Aprobaciones</h2>", section + "      <h2>Aprobaciones</h2>", 1)
    else:
        print("WARN: Aprobaciones not found")

t = t.replace("Discovery + Orquestador + Cola", "Ops: pedidos · stock · fulfill", 1)
if "Panel block 21" not in t:
    t = t.replace("Presupuesto auto $0.", "Presupuesto auto $0. · Panel block 21 (orders/inventory).", 1)

PAGE.write_text(t)
print("Patched ops panel block 21")
print("  setOrders:", "setOrders" in t)
print("  syncInventory:", "syncInventory" in t)
print("  Pedidos:", "Pedidos" in t)
