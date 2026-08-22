#!/usr/bin/env python3
"""Make approve / reject / go-live remove pending items immediately in the panel."""
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "apps/web/app/page.tsx"
t = WEB.read_text()

if "optimisticRemoveApproval" in t:
    print("already patched")
    raise SystemExit(0)

old_decide = '''  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setMessage(null);
    const res = await fetch(`${API}/approvals/${id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    setMessage(`Decisi\u00f3n ${decision} \u00b7 ${data.approval?.id}`);
    await load();
  }'''

# Use actual unicode in file
old_decide = (
    "  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {\n"
    "    setMessage(null);\n"
    "    const res = await fetch(`${API}/approvals/${id}/decide`, {\n"
    "      method: 'POST',\n"
    "      headers: { 'Content-Type': 'application/json' },\n"
    "      body: JSON.stringify({ decision }),\n"
    "    });\n"
    "    const data = await res.json();\n"
    "    setMessage(`Decisi\u00f3n ${decision} \u00b7 ${data.approval?.id}`);\n"
    "    await load();\n"
    "  }"
)
# File has real ó character
old_decide = '''  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setMessage(null);
    const res = await fetch(`${API}/approvals/${id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    setMessage(`Decisi\u00f3n ${decision} \u00b7 ${data.approval?.id}`);
    await load();
  }'''.replace('\\u00f3', '\u00f3').replace('\\u00b7', '\u00b7')

new_decide = '''  function optimisticRemoveApproval(approvalId: string, productId?: string | null) {
    setApprovals((prev) =>
      prev.map((a) =>
        a.id === approvalId ? { ...a, status: 'APPROVED' } : a,
      ),
    );
    if (productId) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === productId && p.status === 'PENDING_APPROVAL'
            ? { ...p, status: 'PUBLISHED' }
            : p,
        ),
      );
    }
  }

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setMessage(null);
    const current = approvals.find((a) => a.id === id);
    // UI inmediata
    setApprovals((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: decision } : a)),
    );
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
      setMessage(`Decisi\u00f3n ${decision}`);
    } catch (e: any) {
      setMessage(e?.message || 'Error de red');
      await load();
      return;
    }
    await load();
  }'''.replace('\\u00f3', '\u00f3')

if old_decide not in t:
    # try without special chars mismatch
    import re
    m = re.search(
        r"async function decide\(id: string, decision: 'APPROVED' \| 'REJECTED'\) \{[\s\S]*?await load\(\);\n  \}",
        t,
    )
    if not m:
        print("WARN: decide not found")
    else:
        t = t[: m.start()] + new_decide.strip() + t[m.end() :]
        # fix leading spaces - new_decide already has 2 spaces issues
        print("patched decide via regex")
else:
    t = t.replace(old_decide, new_decide.strip(), 1)
    print("patched decide")

# goLive optimistic
old_go = '''  async function goLive(id: string) {
    setMessage(null);
    const res = await fetch(`${API}/products/${id}/go-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Aprobado y publicado desde panel' }),
    });
    const data = await res.json();
    if (data.error) setMessage(`Go-live: ${data.error} ${data.reason || ''}`);
    else setMessage(`Go-live OK \u00b7 shopify=${data.shopify?.externalId} \u00b7 mock=${data.mock}`);
    await load();
  }'''.replace('\\u00b7', '\u00b7')

new_go = '''  async function goLive(id: string) {
    setMessage(null);
    // Quitar de pendientes al instante
    setApprovals((prev) =>
      prev.map((a) =>
        a.productId === id && a.status === 'PENDING' ? { ...a, status: 'APPROVED' } : a,
      ),
    );
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'PUBLISHED' } : p)),
    );
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
      setMessage(`Go-live OK \u00b7 shopify=${data.shopify?.externalId || data.product?.externalId} \u00b7 mock=${data.mock}`);
    } catch (e: any) {
      setMessage(e?.message || 'Error de red');
    }
    await load();
  }'''.replace('\\u00b7', '\u00b7')

if old_go in t:
    t = t.replace(old_go, new_go, 1)
    print("patched goLive")
else:
    import re
    m = re.search(r"async function goLive\(id: string\) \{[\s\S]*?await load\(\);\n  \}", t)
    if m:
        t = t[: m.start()] + new_go.strip() + t[m.end() :]
        print("patched goLive via regex")
    else:
        print("WARN: goLive not found")

WEB.write_text(t)
print("done")
