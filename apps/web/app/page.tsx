'use client';

import { useEffect, useState } from 'react';

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
  autoPublish?: { ok: boolean; reason: string };
};

type Approval = {
  id: string;
  productId?: string;
  action: string;
  reason: string;
  status: string;
  createdAt: string;
};

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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
  const [rules, setRules] = useState<any>(null);
  const [aiStatus, setAiStatus] = useState<any>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [h, p, a, au, r, ai, ar, ds, pr] = await Promise.all([
        fetch(`${API}/health`).then((x) => x.json()),
        fetch(`${API}/products`).then((x) => x.json()),
        fetch(`${API}/approvals`).then((x) => x.json()),
        fetch(`${API}/audit?limit=15`).then((x) => x.json()),
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
  }, []);

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
    const res = await fetch(`${API}/approvals/${id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    setMessage(`Decisión ${decision} · ${data.approval?.id}`);
    await load();
  }

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
    const res = await fetch(`${API}/discovery/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 3, runPipeline: true, onlyPassingFilters: true }),
    });
    const data = await res.json();
    setMessage(`Discovery: creados ${data.created}, skipped ${data.skipped}, rejected ${data.rejectedFilter}`);
    await load();
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

  async function publish(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/publish`, { method: 'POST' });
    const data = await res.json();
    if (data.error) setMessage(`Publish: ${data.error} ${data.reason || ''}`);
    else setMessage(`Publicado mock=${data.mock} id=${data.shopify?.externalId || data.product?.externalId}`);
    await load();
  }

  const bandColor = (b?: string) => {
    if (b === 'IDEAL') return '#16a34a';
    if (b === 'OPERATIONAL') return '#2563eb';
    if (b === 'ALERT') return '#ca8a04';
    if (b === 'PAUSE') return '#dc2626';
    return '#64748b';
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '0 auto', maxWidth: 1120, padding: '1.5rem' }}>
      <header style={{ marginBottom: '1.25rem' }}>
        <p style={{ color: '#64748b', margin: 0 }}>ECOM · Panel operativo</p>
        <h1 style={{ margin: '0.25rem 0' }}>Bloque {block ?? '—'} · Discovery + Orquestador + Cola</h1>
        <p>
          Modo: <strong style={{ color: mode === 'MOCK' ? '#ca8a04' : '#16a34a' }}>{mode}</strong>
          {' · '}
          <button type="button" onClick={load} style={{ cursor: 'pointer' }}>Actualizar</button>
        </p>
        {loading && <p>Cargando…</p>}
        {error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}
        {message && <p style={{ color: '#2563eb' }}>{message}</p>}
      </header>

      {discoveryStatus && (
        <section style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '1rem', marginBottom: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>Descubrimiento</h2>
          <p style={{ fontSize: 14 }}>{discoveryStatus.note}</p>
          <p style={{ fontSize: 13, color: '#475569' }}>
            MOCK: {discoveryStatus.sources?.mockCatalog ? 'sí' : 'no'} · Serper:{' '}
            {discoveryStatus.sources?.serper ? 'sí' : 'no'} · CJ catalog:{' '}
            {discoveryStatus.sources?.cjCatalog ? 'sí' : 'no'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" onClick={runDiscovery} style={{ cursor: 'pointer' }}>Discovery ahora</button>
            <button type="button" onClick={enqueueDiscovery} style={{ cursor: 'pointer' }}>Encolar discovery (BullMQ)</button>
          </div>
          <h3 style={{ fontSize: 15 }}>Preview candidatos</h3>
          <ul style={{ fontSize: 13, margin: 0 }}>
            {preview.map((c: any) => (
              <li key={c.title}>
                {c.title} · score {c.opportunityScore} · filtros{' '}
                {c.hardFilters?.ok ? 'OK' : (c.hardFilters?.reasons || []).join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {aiStatus && (
        <section style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '1rem', marginBottom: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>AI Router</h2>
          <p style={{ fontSize: 14 }}>Presupuesto auto: ${aiStatus.budgetUsdAutomatic} · Paid: {String(aiStatus.allowPaid)}</p>
          {aiResult && (
            <pre style={{ whiteSpace: 'pre-wrap', background: '#fff', padding: 10, borderRadius: 6, fontSize: 12 }}>{aiResult}</pre>
          )}
        </section>
      )}

      {rules && (
        <section style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '1.25rem' }}>
          <h2 style={{ marginTop: 0 }}>Reglas</h2>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: 14 }}>
            <li>Margen ideal ≥ {rules.rules?.MARGIN_IDEAL}% · mínimo ≥ {rules.rules?.MARGIN_MIN}%</li>
            <li>Opportunity ≥ {rules.rules?.MIN_OPPORTUNITY_SCORE} · Auto-publish conf ≥ {rules.rules?.AUTO_PUBLISH_CONFIDENCE}%</li>
          </ul>
        </section>
      )}

      <section style={{ marginBottom: '1.75rem' }}>
        <h2>Productos ({products.length})</h2>
        <div style={{ display: 'grid', gap: '0.85rem' }}>
          {products.map((p) => (
            <article
              key={p.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '0.85rem',
                background: p.sourceMode === 'MOCK' ? '#fffbeb' : '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{p.title}</strong>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {p.status} · {p.sourceMode} · {p.supplierName}
                    {p.cjVariantId ? ` · CJ ${p.cjVariantId}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', color: bandColor(p.marginBand), fontWeight: 600 }}>
                  {p.marginPercent ?? '—'}% {p.marginBand}
                </div>
              </div>
              <p style={{ fontSize: 13, margin: '0.5rem 0' }}>
                {p.salePrice?.toLocaleString?.('es-CO')} {p.currency} · score {p.opportunityScore} · conf{' '}
                {p.confidence}% · stock {p.stock}
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => evaluate(p.id)} style={{ cursor: 'pointer' }}>Evaluar</button>
                <button type="button" onClick={() => runPipeline(p.id)} style={{ cursor: 'pointer' }}>Pipeline</button>
                <button type="button" onClick={() => requestApproval(p.id)} style={{ cursor: 'pointer' }}>Pedir aprobación</button>
                <button type="button" onClick={() => generateCopy(p.id)} style={{ cursor: 'pointer' }}>Copy IA</button>
                <button type="button" onClick={() => publish(p.id)} style={{ cursor: 'pointer' }}>Publicar</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: '1.75rem' }}>
        <h2>Aprobaciones</h2>
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
      </section>

      <section style={{ marginBottom: '1.75rem' }}>
        <h2>Agent runs</h2>
        <ul style={{ fontSize: 12, color: '#475569' }}>
          {agentRuns.map((r) => (
            <li key={r.id}>
              {r.createdAt} · {r.productTitle} · <strong>{r.status}</strong> · margen {r.marginPercent}%
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: '1.75rem' }}>
        <h2>Jobs (cola)</h2>
        {jobs.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>Sin jobs recientes o endpoint /jobs no disponible aún.</p>}
        <ul style={{ fontSize: 12 }}>
          {jobs.map((j) => (
            <li key={String(j.id)}>
              {j.name} · {j.state} · {j.id}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Auditoría</h2>
        <ul style={{ fontSize: 12, color: '#475569' }}>
          {audits.map((x) => (
            <li key={x.id}>
              {x.createdAt} · <strong>{x.action}</strong> · {x.entityType}
            </li>
          ))}
        </ul>
      </section>

      <footer style={{ marginTop: '2rem', fontSize: 12, color: '#94a3b8' }}>
        Discovery MOCK/Serper · Orchestrator · AgentRun · BullMQ · Shopify/CJ live-ready. Presupuesto auto $0.
      </footer>
    </main>
  );
}
