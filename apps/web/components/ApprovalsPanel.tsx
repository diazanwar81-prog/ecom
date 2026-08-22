'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type ProductBrief = {
  id: string;
  title: string;
  status: string;
  marginPercent?: number;
  marginBand?: string;
  opportunityScore?: number;
  confidence?: number;
  stock?: number;
  supplierName?: string;
  cjSku?: string | null;
};

type Approval = {
  id: string;
  productId?: string;
  action: string;
  reason: string;
  status: string;
  createdAt: string;
  product?: ProductBrief | null;
};

type Product = ProductBrief & {
  salePrice?: number;
  currency?: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return res.json() as Promise<T>;
}

function bandColor(b?: string) {
  if (b === 'IDEAL') return '#16a34a';
  if (b === 'OPERATIONAL') return '#2563eb';
  if (b === 'ALERT') return '#ca8a04';
  if (b === 'PAUSE') return '#dc2626';
  return '#64748b';
}

export function ApprovalsPanel() {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const approvalsQ = useQuery({
    queryKey: ['approvals'],
    queryFn: () => fetchJson<{ items: Approval[] }>(`${API}/approvals`),
  });

  const productsQ = useQuery({
    queryKey: ['products'],
    queryFn: () => fetchJson<{ items: Product[] }>(`${API}/products`),
  });

  const approvals = approvalsQ.data?.items || [];
  const products = productsQ.data?.items || [];
  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING');
  const pendingProducts = products.filter((p) => p.status === 'PENDING_APPROVAL');

  const decideM = useMutation({
    mutationFn: async (vars: { id: string; decision: 'APPROVED' | 'REJECTED' }) => {
      const data = await fetchJson<any>(`${API}/approvals/${vars.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: vars.decision }),
      });
      if (data.error) throw new Error(data.error);
      return data;
    },
    onMutate: async ({ id, decision }) => {
      await qc.cancelQueries({ queryKey: ['approvals'] });
      await qc.cancelQueries({ queryKey: ['products'] });
      const prevA = qc.getQueryData<{ items: Approval[] }>(['approvals']);
      const prevP = qc.getQueryData<{ items: Product[] }>(['products']);
      const target = prevA?.items.find((a) => a.id === id);

      qc.setQueryData<{ items: Approval[] }>(['approvals'], (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((a) => (a.id === id ? { ...a, status: decision } : a)),
        };
      });

      if (target?.productId) {
        qc.setQueryData<{ items: Product[] }>(['products'], (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((p) =>
              p.id === target.productId
                ? { ...p, status: decision === 'APPROVED' ? 'DRAFT' : 'REJECTED' }
                : p,
            ),
          };
        });
      }

      return { prevA, prevP };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prevA) qc.setQueryData(['approvals'], ctx.prevA);
      if (ctx?.prevP) qc.setQueryData(['products'], ctx.prevP);
      setMessage(`Error: ${err.message}`);
    },
    onSuccess: (_d, vars) => setMessage(`Decisión ${vars.decision}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const goLiveM = useMutation({
    mutationFn: async (productId: string) => {
      const data = await fetchJson<any>(`${API}/products/${productId}/go-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Aprobado y publicado desde panel' }),
      });
      if (data.error) throw new Error(`${data.error} ${data.reason || ''}`.trim());
      return data;
    },
    onMutate: async (productId) => {
      await qc.cancelQueries({ queryKey: ['approvals'] });
      await qc.cancelQueries({ queryKey: ['products'] });
      const prevA = qc.getQueryData<{ items: Approval[] }>(['approvals']);
      const prevP = qc.getQueryData<{ items: Product[] }>(['products']);

      qc.setQueryData<{ items: Approval[] }>(['approvals'], (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((a) =>
            a.productId === productId && a.status === 'PENDING'
              ? { ...a, status: 'APPROVED' }
              : a,
          ),
        };
      });

      qc.setQueryData<{ items: Product[] }>(['products'], (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((p) =>
            p.id === productId ? { ...p, status: 'PUBLISHED' } : p,
          ),
        };
      });

      return { prevA, prevP };
    },
    onError: (err: Error, _id, ctx) => {
      if (ctx?.prevA) qc.setQueryData(['approvals'], ctx.prevA);
      if (ctx?.prevP) qc.setQueryData(['products'], ctx.prevP);
      setMessage(`Go-live: ${err.message}`);
    },
    onSuccess: (data) => {
      setMessage(
        `Go-live OK · shopify=${data.shopify?.externalId || data.product?.externalId} · mock=${data.mock}`,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const requestM = useMutation({
    mutationFn: async (productId: string) => {
      const data = await fetchJson<any>(`${API}/products/${productId}/request-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'FIRST_PUBLICATION', reason: 'Primera publicación' }),
      });
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => setMessage(`Aprobación solicitada: ${data.approval?.id}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const busy = decideM.isPending || goLiveM.isPending || requestM.isPending;

  return (
    <section
      style={{
        marginBottom: '1.75rem',
        background: '#fff7ed',
        border: '1px solid #fed7aa',
        borderRadius: 10,
        padding: '1rem',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Panel de aprobaciones</h2>
      <p style={{ fontSize: 13, color: '#9a3412' }}>
        Pendientes: <strong>{pendingApprovals.length}</strong> solicitudes ·{' '}
        <strong>{pendingProducts.length}</strong> productos en PENDING_APPROVAL
        {busy ? ' · procesando…' : ''}
      </p>
      {message && <p style={{ color: '#2563eb', fontSize: 13 }}>{message}</p>}

      <h3 style={{ fontSize: 15 }}>Solicitudes PENDING</h3>
      {pendingApprovals.length === 0 && (
        <p style={{ color: '#64748b', fontSize: 13 }}>No hay solicitudes pendientes.</p>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {pendingApprovals.map((a) => (
          <div
            key={a.id}
            style={{ background: '#fff', border: '1px solid #fdba74', borderRadius: 8, padding: 12 }}
          >
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decideM.mutate({ id: a.id, decision: 'APPROVED' })}
                  style={{
                    cursor: busy ? 'wait' : 'pointer',
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 10px',
                  }}
                >
                  Solo aprobar
                </button>
                {a.productId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => goLiveM.mutate(a.productId!)}
                    style={{
                      cursor: busy ? 'wait' : 'pointer',
                      background: '#16a34a',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '6px 10px',
                    }}
                  >
                    Aprobar y publicar
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decideM.mutate({ id: a.id, decision: 'REJECTED' })}
                  style={{
                    cursor: busy ? 'wait' : 'pointer',
                    background: '#dc2626',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 10px',
                  }}
                >
                  Rechazar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 15, marginTop: 16 }}>Productos PENDING_APPROVAL</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {pendingProducts.map((p) => (
          <div
            key={p.id}
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 10,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: 13 }}>
              <strong>{p.title}</strong>
              <div style={{ color: '#64748b' }}>
                margen {p.marginPercent}% ({p.marginBand}) · score {p.opportunityScore} · conf{' '}
                {p.confidence}%
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => requestM.mutate(p.id)}
                style={{ cursor: busy ? 'wait' : 'pointer' }}
              >
                Crear solicitud
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => goLiveM.mutate(p.id)}
                style={{
                  cursor: busy ? 'wait' : 'pointer',
                  background: '#16a34a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 10px',
                }}
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
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>
          Historial de aprobaciones ({approvals.length})
        </summary>
        <ul style={{ fontSize: 12, color: '#475569' }}>
          {approvals.map((a) => (
            <li key={a.id}>
              {a.createdAt} · {a.status} · {a.action} · {a.product?.title || a.productId || '—'}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
