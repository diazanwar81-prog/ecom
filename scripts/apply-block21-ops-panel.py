#!/usr/bin/env python3
"""Block 21: enhance web ops panel with orders, sync-inventory, fulfill."""
from pathlib import Path
import sys

PAGE = Path(__file__).resolve().parents[1] / 'apps/web/app/page.tsx'
t = PAGE.read_text()

if 'syncInventory' in t and '/orders' in t and 'block 21' in t.lower():
    print('Already block 21 panel')
    sys.exit(0)

# Add orders state
if 'const [orders, setOrders]' not in t:
    t = t.replace(
        'const [jobs, setJobs] = useState<any[]>([]);
',
        'const [jobs, setJobs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
',
        1,
    )

# Load orders in load()
if "fetch(`${API}/orders")" not in t and 'fetch(`${API}/orders`)' not in t:
    t = t.replace(
        "const j = await fetch(`${API}/jobs`).then((x) => x.json());\n        setJobs(j.items || []);",
        "const j = await fetch(`${API}/jobs`).then((x) => x.json());\n        setJobs(j.items || []);\n        const o = await fetch(`${API}/orders`).then((x) => x.json()).catch(() => ({ items: [] }));\n        setOrders(o.items || []);",
        1,
    )

# Action helpers before bandColor
if 'async function syncInventory' not in t:
    helpers = '''
  async function syncInventory(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/sync-inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.error) setMessage(`Inventory: ${data.error}`);
    else setMessage(`Inventory OK · available=${data.available} · ecom=${data.ecomStock}`);
    await load();
  }

  async function fulfillOrder(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/orders/${id}/fulfill`, { method: 'POST' });
    const data = await res.json();
    if (data.error) setMessage(`Fulfill: ${data.error}`);
    else setMessage(`Fulfill OK · ${data.cj?.supplierOrderId || data.order?.status}`);
    await load();
  }

  async function syncTracking(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/orders/${id}/sync-tracking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifyCustomer: false }),
    });
    const data = await res.json();
    if (data.error) setMessage(`Tracking: ${data.error}`);
    else setMessage(`Tracking OK · ${data.trackingNumber || data.shopify?.fulfillmentId}`);
    await load();
  }

'''
    t = t.replace(
        '  const bandColor = (b?: string) => {',
        helpers + '  const bandColor = (b?: string) => {',
        1,
    )

# Add buttons on product cards
if 'syncInventory(p.id)' not in t:
    t = t.replace(
        "<button type=\"button\" onClick={() => publish(p.id)} style={{ cursor: 'pointer' }}>Publicar</button>",
        "<button type=\"button\" onClick={() => publish(p.id)} style={{ cursor: 'pointer' }}>Publicar</button>\n                <button type=\"button\" onClick={() => syncInventory(p.id)} style={{ cursor: 'pointer' }}>Sync stock</button>",
        1,
    )
    # alternate without escape
    if 'syncInventory(p.id)' not in t:
        t = t.replace(
            "onClick={() => publish(p.id)} style={{ cursor: 'pointer' }}>Publicar</button>",
            "onClick={() => publish(p.id)} style={{ cursor: 'pointer' }}>Publicar</button>\n                <button type=\"button\" onClick={() => syncInventory(p.id)} style={{ cursor: 'pointer' }}>Sync stock</button>",
            1,
        )

# Orders section before Approvals
if '<h2>Pedidos' not in t and '<h2>Orders' not in t:
    section = '''
      <section style={{ marginBottom: '1.75rem' }}>
        <h2>Pedidos ({orders.length})</h2>
        {orders.length === 0 && <p style={{ color: '#64748b' }}>Sin pedidos.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {orders.map((o) => (
            <div key={o.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
              <strong>{o.orderNumber || o.id}</strong> · {o.status} · {o.total} {o.currency}
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {o.email || 'sin email'} · {o.fulfillmentNote || ''}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {o.status !== 'FULFILLED' && (
                  <button type="button" onClick={() => fulfillOrder(o.id)} style={{ cursor: 'pointer' }}>Fulfill CJ</button>
                )}
                <button type="button" onClick={() => syncTracking(o.id)} style={{ cursor: 'pointer' }}>Sync tracking Shopify</button>
              </div>
            </div>
          ))}
        </div>
      </section>

'''
    if '<h2>Aprobaciones</h2>' in t:
        t = t.replace('<h2>Aprobaciones</h2>', section + '      <h2>Aprobaciones</h2>', 1)
    else:
        print('WARN: Aprobaciones section not found')

# Header title bump
t = t.replace(
    'Bloque {block ?? \'—\'} · Discovery + Orquestador + Cola',
    'Bloque {block ?? \'—\'} · Ops: pedidos · stock · fulfill',
    1,
)
if "Ops: pedidos" not in t:
    t = t.replace(
        'Discovery + Orquestador + Cola',
        'Ops: pedidos · stock · fulfill',
        1,
    )

# footer marker
if 'block 21' not in t.lower():
    t = t.replace(
        'Presupuesto auto $0.',
        'Presupuesto auto $0. · Panel block 21 (orders/inventory).',
        1,
    )

PAGE.write_text(t)
print('Patched ops panel block 21')
print('  orders state:', 'setOrders' in t)
print('  syncInventory:', 'syncInventory' in t)
print('  Pedidos section:', 'Pedidos' in t)
