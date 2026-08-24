'use client';

import { useEffect, useState, useMemo } from 'react';
import { ApprovalsPanel } from '../components/ApprovalsPanel';

type Product = {
  id: string;
  title: string;
  status: string;
  opportunityScore?: number;
  confidence?: number;
  marginPercent?: number;
  marginBand?: string;
  salePrice?: number;
  currency?: string;
  stock?: number;
  canPublish?: boolean;
  shouldPause?: boolean;
  sourceMode?: string;
  supplierName?: string;
  verified?: boolean;
  cjVariantId?: string | null;
  cjSku?: string | null;
  description?: string | null;
  externalId?: string | null;
  imageUrls?: string[] | null;
  autoPublish?: { ok: boolean; reason: string };
};

type Approval = {
  id: string;
  productId?: string;
  action: string;
  reason: string;
  status: string;
  createdAt: string;
  product?: {
    id: string;
    title: string;
    status: string;
    marginPercent?: number;
    marginBand?: string;
    opportunityScore?: number;
    confidence?: number;
    salePrice?: number;
    currency?: string;
    stock?: number;
    supplierName?: string;
    verified?: boolean;
    cjSku?: string | null;
    canPublish?: boolean;
    shouldPause?: boolean;
  } | null;
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** Branding: quita prefijos de proveedor/mock y acorta para UI */
function brandTitle(raw?: string | null): string {
  if (!raw) return 'Sin título';
  let t = raw
    .replace(/^\[(SERPER\+CJ|SERPER|CJ|MOCK)\]\s*/i, '')
    .replace(/^Cross-Border\s+(Dropshipping\s+)?/i, '')
    .replace(/^Oem And Dropshipping\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > 72) t = t.slice(0, 69).trim() + '…';
  return t;
}

function money(n?: number | null, currency = 'COP') {
  if (n == null || Number.isNaN(Number(n))) return '—';
  try {
    return Number(n).toLocaleString('es-CO') + ' ' + currency;
  } catch {
    return String(n) + ' ' + currency;
  }
}

export default function Home() {
  const [mode, setMode] = useState('MOCK');
  const [block, setBlock] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audits, setAudits] = useState<any[]>([]);
  const [agentRuns, setAgentRuns] = useState<any[]>([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<any>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [rules, setRules] = useState<any>(null);
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [board, setBoard] = useState<any>(null);
  const [brandDrafts, setBrandDrafts] = useState<Record<string, { title: string; description: string; notes: string; open: boolean }>>({});
  const [realBusy, setRealBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [h, p, a, au, r, ai, ar, ds, pr] = await Promise.all([
        fetch(`${API}/health`).then((x) => x.json()),
        fetch(`${API}/products`).then((x) => x.json()),
        fetch(`${API}/approvals`).then((x) => x.json()),
        fetch(`${API}/audit?limit=20`).then((x) => x.json()),
        fetch(`${API}/rules`).then((x) => x.json()),
        fetch(`${API}/ai/status`).then((x) => x.json()),
        fetch(`${API}/agent-runs?limit=10`).then((x) => x.json()).catch(() => ({ items: [] })),
        fetch(`${API}/discovery/status`).then((x) => x.json()).catch(() => null),
        fetch(`${API}/discovery/preview?limit=5`).then((x) => x.json()).catch(() => ({ items: [] })),
      ]);
      setMode(h.mode || 'MOCK');
      setBlock(h.block ?? null);
      setProducts(p.items || []);
      setApprovals(a.items || []);
      setAudits(au.items || []);
      setRules(r);
      setAiStatus(ai);
      setAgentRuns(ar.items || []);
      setDiscoveryStatus(ds);
      setPreview(pr.items || []);
      try {
        const j = await fetch(`${API}/jobs`).then((x) => x.json());
        setJobs(j.items || []);
        const o = await fetch(`${API}/orders`).then((x) => x.json()).catch(() => ({ items: [] }));
        setOrders(o.items || []);
        const b = await fetch(`${API}/autonomy/board`).then((x) => x.json()).catch(() => null);
        setBoard(b);
      } catch {
        setJobs([]);
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo conectar con la API');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, []);

  const notifications = useMemo(() => {
    const items: { id: string; level: 'info' | 'warn' | 'ok' | 'err'; text: string; at?: string }[] = [];
    if (message) items.push({ id: 'msg', level: 'info', text: message });
    const pending = approvals.filter((a) => a.status === 'PENDING');
    if (pending.length) {
      items.push({
        id: 'appr',
        level: 'warn',
        text: `${pending.length} aprobación(es) pendiente(s)`,
      });
    }
    const paid = orders.filter((o) => o.status === 'PAID');
    if (paid.length) {
      items.push({
        id: 'paid',
        level: 'warn',
        text: `${paid.length} pedido(s) PAID por cumplir`,
      });
    }
    const drafts = products.filter((p) => p.status === 'DRAFT');
    if (drafts.length) {
      items.push({
        id: 'draft',
        level: 'ok',
        text: `${drafts.length} producto(s) DRAFT listos para go-live`,
      });
    }
    for (const a of (audits || []).slice(0, 6)) {
      items.push({
        id: a.id,
        level: 'info',
        text: `${a.action} · ${a.entityType}${a.entityId ? ' · ' + String(a.entityId).slice(0, 8) : ''}`,
        at: a.createdAt,
      });
    }
    return items.slice(0, 12);
  }, [message, approvals, orders, products, audits]);

  async function evaluate(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/evaluate`, { method: 'POST' });
    const data = await res.json();
    setMessage(`Evaluado: margen ${data.item?.marginPercent ?? data.evaluation?.margin?.marginPercent}%`);
    await load();
  }

  async function requestApproval(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'FIRST_PUBLICATION', reason: 'Primera publicación' }),
    });
    const data = await res.json();
    setMessage(`Aprobación solicitada: ${data.approval?.id}`);
    await load();
  }

  /** Pipeline de reglas/orquestador — NO genera copy (skipAiCopy: true). Copy IA es botón aparte. */
  async function runPipeline(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skipAiCopy: true }),
    });
    const data = await res.json();
    setMessage(`Pipeline: ${data.result?.status} · run ${data.agentRunId}`);
    await load();
  }

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setMessage(null);
    const current = approvals.find((a) => a.id === id);
    setApprovals((prev) => prev.map((a) => (a.id === id ? { ...a, status: decision } : a)));
    if (current?.productId) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === current.productId
            ? { ...p, status: decision === 'APPROVED' ? 'DRAFT' : 'REJECTED' }
            : p,
        ),
      );
    }
    try {
      const res = await fetch(`${API}/approvals/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (data.error) {
        setMessage(`Error: ${data.error}`);
        await load();
        return;
      }
      setMessage(`Decisión ${decision}`);
    } catch (e: any) {
      setMessage(e?.message || 'Error de red');
      await load();
      return;
    }
    await load();
  }

  /** Solo copy / branding con IA — independiente del Pipeline. */
  async function generateCopy(id: string) {
    setMessage(null);
    setAiResult(null);
    const res = await fetch(`${API}/products/${id}/generate-copy`, { method: 'POST' });
    const data = await res.json();
    const r = data.result;
    setAiResult(`[${r?.provider}${r?.mock ? ' · MOCK' : ''}] ${r?.text || r?.error || 'sin texto'}`);
    setMessage(`Copy vía ${r?.provider}`);
    await load();
  }

  async function runDiscovery() {
    setMessage(null);
    try {
      const res = await fetch(`${API}/jobs/discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 2, runPipeline: true, onlyPassingFilters: true }),
      });
      const data = await res.json();
      if (data.error) setMessage(`Discovery: ${data.error}`);
      else setMessage(`Discovery encolado job=${data.jobId || 'ok'}`);
      await load();
    } catch (e: any) {
      setMessage(`Discovery falló: ${e?.message || 'Failed to fetch'}`);
    }
  }

  async function enqueueDiscovery() {
    setMessage(null);
    const res = await fetch(`${API}/jobs/discovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 3, runPipeline: true, onlyPassingFilters: true }),
    });
    const data = await res.json();
    if (data.error) setMessage(`Cola error: ${data.error}`);
    else setMessage(`Job discovery encolado: ${data.jobId}`);
    await load();
  }

  async function goLive(id: string) {
    setMessage(null);
    setApprovals((prev) =>
      prev.map((a) =>
        a.productId === id && a.status === 'PENDING' ? { ...a, status: 'APPROVED' } : a,
      ),
    );
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'PUBLISHED' } : p)));
    try {
      const res = await fetch(`${API}/products/${id}/go-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Aprobado y publicado desde panel' }),
      });
      const data = await res.json();
      if (data.error) {
        setMessage(`Go-live: ${data.error} ${data.reason || ''}`);
        await load();
        return;
      }
      setMessage(
        `Go-live OK · shopify=${data.shopify?.externalId || data.product?.externalId} · mock=${data.mock}`,
      );
    } catch (e: any) {
      setMessage(e?.message || 'Error de red');
    }
    await load();
  }

  async function publish(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/publish`, { method: 'POST' });
    const data = await res.json();
    if (data.error) setMessage(`Publish: ${data.error} ${data.reason || ''}`);
    else
      setMessage(
        `Publicado mock=${data.mock} id=${data.shopify?.externalId || data.product?.externalId}`,
      );
    await load();
  }

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
      '¿Activar modo REAL en este proceso?

' +
        '• Publicará/fulfill con credenciales live
' +
        '• No modifica el archivo .env
' +
        '• Reiniciar Docker puede volver a SANDBOX

' +
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

  const bandColor = (b?: string) => {
    if (b === 'IDEAL') return '#16a34a';
    if (b === 'OPERATIONAL') return '#2563eb';
    if (b === 'ALERT') return '#ca8a04';
    if (b === 'PAUSE') return '#dc2626';
    return '#64748b';
  };

  const levelBg = (l: string) => {
    if (l === 'warn') return '#fef3c7';
    if (l === 'ok') return '#dcfce7';
    if (l === 'err') return '#fee2e2';
    return '#e0f2fe';
  };

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        margin: '0 auto',
        maxWidth: 1180,
        padding: '1.25rem',
        background: '#f8fafc',
        minHeight: '100vh',
      }}
    >
      <header style={{ marginBottom: '1rem' }}>
        <p style={{ color: '#64748b', margin: 0, fontSize: 13 }}>ECOM · Panel operativo</p>
        <h1 style={{ margin: '0.2rem 0', fontSize: '1.45rem' }}>
          Bloque {block ?? '—'} · Branding + notificaciones
        </h1>
        <p style={{ margin: '0.35rem 0', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
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
        </p>
        {error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}
      </header>

      <section
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '0.85rem 1rem',
          marginBottom: '1.1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Notificaciones</h2>
          <span style={{ fontSize: 12, color: '#64748b' }}>{notifications.length} recientes</span>
        </div>
        {notifications.length === 0 && (
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0.5rem 0 0' }}>Sin eventos.</p>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.6rem 0 0', display: 'grid', gap: 6 }}>
          {notifications.map((n) => (
            <li
              key={n.id}
              style={{
                background: levelBg(n.level),
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 13,
              }}
            >
              {n.text}
              {n.at && (
                <span style={{ color: '#64748b', marginLeft: 8, fontSize: 11 }}>
                  {String(n.at).slice(0, 19).replace('T', ' ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {board && (
        <section
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            fontSize: 13,
          }}
        >
          <strong>Autonomía</strong> score {board.score ?? '—'} · publicados con CJ:{' '}
          {board.items?.find((i: any) => i.id === 'catalog_cj')?.message || '—'}
        </section>
      )}

      {discoveryStatus && (
        <section
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 8,
            padding: '1rem',
            marginBottom: '1.1rem',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Descubrimiento</h2>
          <p style={{ fontSize: 13, margin: '0 0 8px' }}>{discoveryStatus.note}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button type="button" onClick={runDiscovery} style={{ cursor: 'pointer' }}>
              Discovery ahora
            </button>
            <button type="button" onClick={enqueueDiscovery} style={{ cursor: 'pointer' }}>
              Encolar discovery
            </button>
          </div>
          <ul style={{ fontSize: 12, margin: 0, paddingLeft: '1.1rem' }}>
            {preview.map((c: any) => (
              <li key={c.title}>
                {brandTitle(c.title)} · score {c.opportunityScore} ·{' '}
                {c.hardFilters?.ok ? 'OK' : (c.hardFilters?.reasons || []).join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {aiStatus && (
        <section
          style={{
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: 8,
            padding: '0.85rem 1rem',
            marginBottom: '1.1rem',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 16 }}>AI Router</h2>
          <p style={{ fontSize: 13, margin: 0 }}>
            Presupuesto auto: ${aiStatus.budgetUsdAutomatic} · Paid: {String(aiStatus.allowPaid)}
          </p>
          {aiResult && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                background: '#fff',
                padding: 10,
                borderRadius: 6,
                fontSize: 12,
                marginTop: 8,
              }}
            >
              {aiResult}
            </pre>
          )}
        </section>
      )}

      {rules && (
        <section
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '0.85rem 1rem',
            marginBottom: '1.1rem',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Reglas</h2>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: 13 }}>
            <li>
              Margen ideal ≥ {rules.rules?.MARGIN_IDEAL}% · mínimo ≥ {rules.rules?.MARGIN_MIN}%
            </li>
            <li>
              Opportunity ≥ {rules.rules?.MIN_OPPORTUNITY_SCORE} · Auto-publish conf ≥{' '}
              {rules.rules?.AUTO_PUBLISH_CONFIDENCE}%
            </li>
          </ul>
        </section>
      )}

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: 17 }}>Productos ({products.length})</h2>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: -6 }}>
          Título de branding en panel. <strong>Pipeline</strong> = reglas/orquestador. <strong>Copy IA</strong> =
          título/descripción (aparte).
        </p>
        <div style={{ display: 'grid', gap: '0.9rem' }}>
          {products.map((p) => {
            const title = brandTitle(p.title);
            const imgs = (p.imageUrls || []).filter(Boolean).slice(0, 4);
            return (
              <article
                key={p.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '0.9rem',
                  background: p.status === 'PUBLISHED' ? '#f0fdf4' : '#fff',
                  display: 'grid',
                  gridTemplateColumns: imgs.length ? '96px 1fr' : '1fr',
                  gap: 12,
                }}
              >
                {imgs.length > 0 && (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {imgs.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt=""
                        style={{
                          width: 96,
                          height: i === 0 ? 96 : 44,
                          objectFit: 'cover',
                          borderRadius: 6,
                          background: '#f1f5f9',
                        }}
                      />
                    ))}
                  </div>
                )}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 15 }}>{title}</strong>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        {p.status}
                        {p.externalId ? ` · Shopify ${p.externalId}` : ''}
                        {p.cjSku ? ` · SKU ${p.cjSku}` : ''}
                        {p.supplierName ? ` · ${p.supplierName}` : ''}
                      </div>
                    </div>
                    <div
                      style={{
                        textAlign: 'right',
                        color: bandColor(p.marginBand),
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      {p.marginPercent ?? '—'}% {p.marginBand}
                    </div>
                  </div>

                  <p style={{ fontSize: 13, margin: '0.35rem 0 0.35rem' }}>
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
                    </button>
                    <button type="button" onClick={() => evaluate(p.id)} style={{ cursor: 'pointer' }}>
                      Evaluar
                    </button>
                    <button type="button" onClick={() => runPipeline(p.id)} style={{ cursor: 'pointer' }}>
                      Pipeline
                    </button>
                    <button
                      type="button"
                      onClick={() => requestApproval(p.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      Pedir aprobación
                    </button>
                    <button
                      type="button"
                      onClick={() => generateCopy(p.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      Copy IA
                    </button>
                    <button
                      type="button"
                      onClick={() => goLive(p.id)}
                      style={{
                        cursor: 'pointer',
                        background: '#16a34a',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 10px',
                      }}
                    >
                      Go-live
                    </button>
                    <button type="button" onClick={() => publish(p.id)} style={{ cursor: 'pointer' }}>
                      Publicar
                    </button>
                    <button
                      type="button"
                      onClick={() => syncInventory(p.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      Sync stock
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: 17 }}>Pedidos ({orders.length})</h2>
        {orders.length === 0 && <p style={{ color: '#64748b' }}>Sin pedidos.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {orders.map((o) => (
            <div
              key={o.id}
              style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, background: '#fff' }}
            >
              <strong>{o.orderNumber || o.id}</strong> · {o.status} · {o.total} {o.currency}
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {o.email || 'sin email'} · {o.fulfillmentNote || ''}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {o.status !== 'FULFILLED' && (
                  <button type="button" onClick={() => fulfillOrder(o.id)} style={{ cursor: 'pointer' }}>
                    Fulfill CJ
                  </button>
                )}
                <button type="button" onClick={() => syncTracking(o.id)} style={{ cursor: 'pointer' }}>
                  Sync tracking Shopify
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <ApprovalsPanel />

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: 16 }}>Agent runs</h2>
        <ul style={{ fontSize: 12, color: '#475569' }}>
          {agentRuns.map((r) => (
            <li key={r.id}>
              {r.createdAt} · {brandTitle(r.productTitle)} · <strong>{r.status}</strong> · margen{' '}
              {r.marginPercent}%
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: 16 }}>Jobs (cola)</h2>
        {jobs.length === 0 && (
          <p style={{ color: '#64748b', fontSize: 13 }}>Sin jobs recientes.</p>
        )}
        <ul style={{ fontSize: 12 }}>
          {jobs.map((j) => (
            <li key={String(j.id)}>
              {j.name} · {j.state} · {j.id}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: 16 }}>Auditoría</h2>
        <ul style={{ fontSize: 12, color: '#475569' }}>
          {audits.map((x) => (
            <li key={x.id}>
              {x.createdAt} · <strong>{x.action}</strong> · {x.entityType}
            </li>
          ))}
        </ul>
      </section>

      <footer style={{ marginTop: '2rem', fontSize: 12, color: '#94a3b8' }}>
        Panel block 76 · Pipeline y Copy IA independientes · notificaciones · branding.
      </footer>
    </main>
  );
}
