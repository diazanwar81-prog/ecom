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
  const [products, setProducts] = useState<Product[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audits, setAudits] = useState<any[]>([]);
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
      const [h, p, a, au, r, ai] = await Promise.all([
        fetch(`${API}/health`).then((x) => x.json()),
        fetch(`${API}/products`).then((x) => x.json()),
        fetch(`${API}/approvals`).then((x) => x.json()),
        fetch(`${API}/audit?limit=20`).then((x) => x.json()),
        fetch(`${API}/rules`).then((x) => x.json()),
        fetch(`${API}/ai/status`).then((x) => x.json()),
      ]);
      setMode(h.mode || 'MOCK');
      setProducts(p.items || []);
      setApprovals(a.items || []);
      setAudits(au.items || []);
      setRules(r);
      setAiStatus(ai);
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
    setMessage(`Evaluado: margen ${data.evaluation?.margin?.marginPercent}% (${data.evaluation?.margin?.band})`);
    await load();
  }

  async function requestApproval(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/request-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'FIRST_PUBLICATION', reason: 'Primera publicación de producto MOCK' }),
    });
    const data = await res.json();
    setMessage(`Aprobación solicitada: ${data.approval?.id}`);
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
    setMessage(`Decisión ${decision} sobre ${data.approval?.id}`);
    await load();
  }

  async function generateCopy(id: string) {
    setMessage(null);
    setAiResult(null);
    const res = await fetch(`${API}/products/${id}/generate-copy`, { method: 'POST' });
    const data = await res.json();
    const r = data.result;
    setAiResult(
      `[${r?.provider}${r?.mock ? ' · MOCK' : ''}] ${r?.text || r?.error || 'sin texto'}`,
    );
    setMessage(`Copy generado vía ${r?.provider} (mock=${r?.mock})`);
    await load();
  }

  async function testAiPrompt() {
    setAiResult(null);
    const res = await fetch(`${API}/ai/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Resume en una frase qué es ECOM dropshipping', task: 'general' }),
    });
    const data = await res.json();
    const r = data.result;
    setAiResult(`[${r?.provider}${r?.mock ? ' · MOCK' : ''}] ${r?.text || r?.error}`);
  }

  const bandColor = (b?: string) => {
    if (b === 'IDEAL') return '#16a34a';
    if (b === 'OPERATIONAL') return '#2563eb';
    if (b === 'ALERT') return '#ca8a04';
    if (b === 'PAUSE') return '#dc2626';
    return '#64748b';
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '0 auto', maxWidth: 1100, padding: '1.5rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <p style={{ color: '#64748b', margin: 0 }}>ECOM · Panel operativo</p>
        <h1 style={{ margin: '0.25rem 0' }}>Bloque 3 — AI Router (Gemini + Hugging Face)</h1>
        <p>
          Modo actual: <strong style={{ color: mode === 'MOCK' ? '#ca8a04' : '#16a34a' }}>{mode}</strong>
          {' · '}
          <button onClick={load} style={{ cursor: 'pointer' }}>Actualizar</button>
        </p>
        {loading && <p>Cargando…</p>}
        {error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}
        {message && <p style={{ color: '#2563eb' }}>{message}</p>}
      </header>

      {aiStatus && (
        <section style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>AI Router</h2>
          <p style={{ fontSize: 14, margin: '0 0 0.5rem' }}>
            Presupuesto automático: <strong>${aiStatus.budgetUsdAutomatic} USD</strong>
            {' · '}Paid AI permitido: {aiStatus.allowPaid ? 'sí' : 'no'}
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: 14 }}>
            {(aiStatus.providers || []).map((p: any) => (
              <li key={p.id}>
                <strong>{p.id}</strong> — modelo {p.model} —{' '}
                {p.configured ? 'clave presente' : 'sin clave'} — {p.note}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 12 }}>
            <button onClick={testAiPrompt} style={{ cursor: 'pointer' }}>Probar complete (MOCK)</button>
          </div>
          {aiResult && (
            <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', background: '#fff', padding: 12, borderRadius: 6, fontSize: 13 }}>
              {aiResult}
            </pre>
          )}
        </section>
      )}

      {rules && (
        <section style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>Motor de reglas</h2>
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            <li>Margen ideal ≥ {rules.rules?.MARGIN_IDEAL}%</li>
            <li>Margen mínimo operativo ≥ {rules.rules?.MARGIN_MIN}%</li>
            <li>Alerta 30–34.99% · Pausa {'<30%'} o stock = 0</li>
            <li>Máx. {rules.rules?.MAX_PRICE_CHANGE_PER_DAY} cambios de precio/día · ±{rules.rules?.MAX_PRICE_VARIATION_PERCENT}%</li>
          </ul>
        </section>
      )}

      <section style={{ marginBottom: '2rem' }}>
        <h2>Productos candidatos (MOCK)</h2>
        {products.length === 0 && !loading && <p>No hay productos. La API debe estar en http://localhost:4000</p>}
        <div style={{ display: 'grid', gap: '1rem' }}>
          {products.map((p) => (
            <article
              key={p.id}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '1rem',
                background: p.sourceMode === 'MOCK' ? '#fffbeb' : '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{p.title}</strong>
                  <div style={{ fontSize: 14, color: '#64748b' }}>
                    {p.id} · {p.status} · {p.sourceMode}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: bandColor(p.marginBand), fontWeight: 600 }}>
                    Margen {p.marginPercent ?? '—'}% ({p.marginBand ?? '—'})
                  </div>
                  <div style={{ fontSize: 14 }}>
                    Score {p.opportunityScore ?? '—'} · Conf {p.confidence ?? '—'}% · Stock {p.stock ?? '—'}
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 14, margin: '0.75rem 0' }}>
                Precio: {p.salePrice?.toLocaleString?.('es-CO') ?? p.salePrice} {p.currency}
                {p.shouldPause && <span style={{ color: '#dc2626' }}> · PAUSA recomendada</span>}
                {p.canPublish && <span style={{ color: '#16a34a' }}> · Elegible</span>}
              </p>
              {p.autoPublish && (
                <p style={{ fontSize: 13, color: '#475569' }}>
                  Auto-publicar: {p.autoPublish.ok ? 'Sí' : 'No'} — {p.autoPublish.reason}
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button onClick={() => evaluate(p.id)} style={{ cursor: 'pointer' }}>Re-evaluar</button>
                <button onClick={() => requestApproval(p.id)} style={{ cursor: 'pointer' }}>Solicitar aprobación</button>
                <button onClick={() => generateCopy(p.id)} style={{ cursor: 'pointer' }}>Generar copy (IA)</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Centro de aprobaciones</h2>
        {approvals.length === 0 && <p style={{ color: '#64748b' }}>Sin aprobaciones pendientes.</p>}
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {approvals.map((a) => (
            <div key={a.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.75rem' }}>
              <div><strong>{a.action}</strong> · {a.status}</div>
              <div style={{ fontSize: 14, color: '#64748b' }}>{a.reason}</div>
              {a.status === 'PENDING' && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button onClick={() => decide(a.id, 'APPROVED')} style={{ cursor: 'pointer' }}>Aprobar</button>
                  <button onClick={() => decide(a.id, 'REJECTED')} style={{ cursor: 'pointer' }}>Rechazar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Auditoría reciente</h2>
        <ul style={{ fontSize: 13, color: '#475569' }}>
          {audits.map((x) => (
            <li key={x.id}>
              {x.createdAt} · <strong>{x.action}</strong> · {x.entityType}/{x.entityId} · {x.runtimeMode}
            </li>
          ))}
        </ul>
      </section>

      <footer style={{ marginTop: '2rem', fontSize: 12, color: '#94a3b8' }}>
        AI Router: Gemini → Hugging Face → MOCK. Presupuesto automático $0. Sin claves = solo MOCK. No hay cobros automáticos.
      </footer>
    </main>
  );
}
