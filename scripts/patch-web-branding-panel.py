#!/usr/bin/env python3
"""Enhance apps/web/app/page.tsx: branding editor per product + REAL mode button."""
from pathlib import Path

p = Path('apps/web/app/page.tsx')
t = p.read_text(encoding='utf-8')

# --- state for branding drafts ---
if 'brandDrafts' not in t:
    t = t.replace(
        "const [board, setBoard] = useState<any>(null);",
        "const [board, setBoard] = useState<any>(null);\n"
        "  const [brandDrafts, setBrandDrafts] = useState<Record<string, { title: string; description: string; notes: string; open: boolean }>>({});\n"
        "  const [realBusy, setRealBusy] = useState(false);",
        1,
    )
    print('state added')

# --- helpers openBrand / save / regen / real mode ---
HELPERS = '''
  function openBrand(p: Product) {
    setBrandDrafts((prev) => ({
      ...prev,
      [p.id]: {
        title: brandTitle(p.title),
        description: p.description || '',
        notes: prev[p.id]?.notes || '',
        open: true,
      },
    }));
  }

  function setBrandField(id: string, field: 'title' | 'description' | 'notes', value: string) {
    setBrandDrafts((prev) => ({
      ...prev,
      [id]: {
        title: prev[id]?.title ?? '',
        description: prev[id]?.description ?? '',
        notes: prev[id]?.notes ?? '',
        open: true,
        [field]: value,
      },
    }));
  }

  async function saveBranding(id: string, approved = false) {
    const d = brandDrafts[id];
    if (!d) return;
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/branding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: d.title,
        description: d.description,
        approved,
      }),
    });
    const data = await res.json();
    if (data.error) setMessage(`Branding: ${data.error}`);
    else setMessage(approved ? 'Branding aprobado y guardado' : 'Branding guardado');
    await load();
  }

  async function regenerateBranding(id: string) {
    const d = brandDrafts[id] || { title: '', description: '', notes: '', open: true };
    setMessage(null);
    setAiResult(null);
    const res = await fetch(`${API}/products/${id}/generate-copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: d.title,
        instructions: d.notes || 'Título corto comercial en español (Colombia). Descripción con beneficios, materiales/uso y CTA.',
        applyTitle: true,
        language: 'es-CO',
      }),
    });
    const data = await res.json();
    const r = data.result;
    setAiResult(`[${r?.provider}${r?.mock ? ' · MOCK' : ''}] ${r?.text || r?.error || 'sin texto'}`);
    if (data.product) {
      setBrandDrafts((prev) => ({
        ...prev,
        [id]: {
          title: brandTitle(data.product.title),
          description: data.product.description || '',
          notes: prev[id]?.notes || '',
          open: true,
        },
      }));
    }
    setMessage(`Copy regenerado vía ${r?.provider}`);
    await load();
  }

  async function activateRealMode() {
    if (realBusy) return;
    const ok = window.confirm(
      '¿Activar modo REAL en este proceso?\n\n' +
        '• Publicará/fulfill con credenciales live\n' +
        '• No modifica el archivo .env\n' +
        '• Reiniciar Docker puede volver a SANDBOX\n\n' +
        'Confirma solo si completaste checklist HTTPS/webhooks/CJ/Shopify.',
    );
    if (!ok) return;
    setRealBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${API}/ops/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'REAL', confirm: 'I_UNDERSTAND_REAL_MODE' }),
      });
      const data = await res.json();
      if (data.error) setMessage(`REAL: ${data.error} — ${data.message || ''}`);
      else setMessage(`Modo ${data.mode} activo (runtime). ${data.note || ''}`);
      await load();
    } catch (e: any) {
      setMessage(e?.message || 'Error activando REAL');
    } finally {
      setRealBusy(false);
    }
  }

  async function activateSandboxMode() {
    setMessage(null);
    const res = await fetch(`${API}/ops/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'SANDBOX' }),
    });
    const data = await res.json();
    setMessage(data.ok ? 'Modo SANDBOX (runtime)' : `Error: ${data.error}`);
    await load();
  }
'''

if 'async function activateRealMode' not in t:
    t = t.replace(
        'async function fulfillOrder(id: string) {',
        HELPERS + '\n  async function fulfillOrder(id: string) {',
        1,
    )
    print('helpers inserted')

# --- header REAL button next to Actualizar ---
OLD_HDR = '''        <p style={{ margin: '0.35rem 0' }}>
          Modo:{' '}
          <strong style={{ color: mode === 'MOCK' ? '#ca8a04' : '#16a34a' }}>{mode}</strong>
          {' · '}
          <button type="button" onClick={load} style={{ cursor: 'pointer' }}>
            Actualizar
          </button>
          {loading && <span style={{ marginLeft: 8, color: '#64748b' }}>Cargando…</span>}
        </p>'''

NEW_HDR = '''        <p style={{ margin: '0.35rem 0', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span>
            Modo:{' '}
            <strong
              style={{
                color: mode === 'REAL' ? '#dc2626' : mode === 'MOCK' ? '#ca8a04' : '#16a34a',
              }}
            >
              {mode}
            </strong>
          </span>
          <button type="button" onClick={load} style={{ cursor: 'pointer' }}>
            Actualizar
          </button>
          {mode !== 'REAL' ? (
            <button
              type="button"
              onClick={activateRealMode}
              disabled={realBusy}
              style={{
                cursor: 'pointer',
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '4px 12px',
                fontWeight: 600,
              }}
            >
              {realBusy ? 'Activando…' : 'Activar REAL'}
            </button>
          ) : (
            <button
              type="button"
              onClick={activateSandboxMode}
              style={{
                cursor: 'pointer',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '4px 12px',
              }}
            >
              Volver SANDBOX
            </button>
          )}
          {loading && <span style={{ color: '#64748b' }}>Cargando…</span>}
        </p>'''

if 'Activar REAL' not in t and OLD_HDR in t:
    t = t.replace(OLD_HDR, NEW_HDR, 1)
    print('header REAL button patched')
elif 'Activar REAL' in t:
    print('header already has REAL')
else:
    print('WARNING: header pattern not found')

# --- product card branding block ---
OLD_DESC = '''                  {p.description ? (
                    <p
                      style={{
                        fontSize: 13,
                        color: '#334155',
                        margin: '0.45rem 0',
                        lineHeight: 1.4,
                      }}
                    >
                      {String(p.description).slice(0, 220)}
                      {String(p.description).length > 220 ? '…' : ''}
                    </p>
                  ) : (
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: '0.4rem 0' }}>
                      Sin descripción aún — usa solo el botón «Copy IA» cuando quieras.
                    </p>
                  )}

                  <p style={{ fontSize: 13, margin: '0.35rem 0 0.55rem' }}>
                    <strong>{money(p.salePrice, p.currency || 'COP')}</strong>
                    {' · '}score {p.opportunityScore ?? '—'} · conf {p.confidence ?? '—'}% · stock{' '}
                    {p.stock ?? '—'}
                  </p>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>'''

NEW_DESC = '''                  <p style={{ fontSize: 13, margin: '0.35rem 0 0.35rem' }}>
                    <strong>{money(p.salePrice, p.currency || 'COP')}</strong>
                    {' · '}score {p.opportunityScore ?? '—'} · conf {p.confidence ?? '—'}% · stock{' '}
                    {p.stock ?? '—'} · margen {p.marginPercent ?? '—'}%
                  </p>

                  <div
                    style={{
                      fontSize: 12,
                      color: '#475569',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '8px 10px',
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Ficha / specs</div>
                    <div>Título origen: {p.title}</div>
                    <div>
                      SKU {p.cjSku || '—'} · vid {p.cjVariantId || '—'} ·{' '}
                      {p.verified ? 'proveedor verificado' : 'sin verificar'}
                    </div>
                    <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
                      {p.description
                        ? String(p.description).slice(0, 480) +
                          (String(p.description).length > 480 ? '…' : '')
                        : 'Sin descripción / specs aún.'}
                    </div>
                  </div>

                  {brandDrafts[p.id]?.open ? (
                    <div
                      style={{
                        border: '1px solid #c4b5fd',
                        background: '#f5f3ff',
                        borderRadius: 8,
                        padding: 10,
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                        Editor de branding
                      </div>
                      <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                        Título (ES)
                        <input
                          value={brandDrafts[p.id]?.title || ''}
                          onChange={(e) => setBrandField(p.id, 'title', e.target.value)}
                          style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                        />
                      </label>
                      <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                        Descripción / características
                        <textarea
                          value={brandDrafts[p.id]?.description || ''}
                          onChange={(e) => setBrandField(p.id, 'description', e.target.value)}
                          rows={5}
                          style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                        />
                      </label>
                      <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                        Notas para regenerar con IA (opcional)
                        <textarea
                          value={brandDrafts[p.id]?.notes || ''}
                          onChange={(e) => setBrandField(p.id, 'notes', e.target.value)}
                          rows={2}
                          placeholder="Ej: enfatizar acero inoxidable, envío a Colombia, tono premium"
                          style={{ width: '100%', padding: 6, marginTop: 2, boxSizing: 'border-box' }}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => saveBranding(p.id, false)} style={{ cursor: 'pointer' }}>
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => saveBranding(p.id, true)}
                          style={{
                            cursor: 'pointer',
                            background: '#16a34a',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            padding: '4px 10px',
                          }}
                        >
                          Aprobar branding
                        </button>
                        <button
                          type="button"
                          onClick={() => regenerateBranding(p.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          Regenerar IA
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setBrandDrafts((prev) => ({
                              ...prev,
                              [p.id]: { ...prev[p.id], open: false },
                            }))
                          }
                          style={{ cursor: 'pointer' }}
                        >
                          Cerrar
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => openBrand(p)} style={{ cursor: 'pointer' }}>
                      Branding
                    </button>'''

if 'Editor de branding' not in t and OLD_DESC in t:
    t = t.replace(OLD_DESC, NEW_DESC, 1)
    print('product branding UI patched')
elif 'Editor de branding' in t:
    print('branding UI already present')
else:
    print('WARNING: product desc pattern not found')

p.write_text(t, encoding='utf-8')
print('Wrote', p, 'lines', len(t.splitlines()))
