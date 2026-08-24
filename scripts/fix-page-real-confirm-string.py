#!/usr/bin/env python3
"""Repair broken window.confirm in page.tsx — write literal \\n not real newlines."""
from pathlib import Path
import re

p = Path('apps/web/app/page.tsx')
t = p.read_text(encoding='utf-8')

pattern = re.compile(
    r'async function activateRealMode\(\) \{.*?\n  async function activateSandboxMode',
    re.S,
)

# Double-escaped: Python writes \\n into the file so JS sees \\n escape sequences
new_fn = (
    "async function activateRealMode() {\n"
    "    if (realBusy) return;\n"
    "    const ok = window.confirm(\n"
    "      'Activar modo REAL en este proceso?\\n\\n' +\n"
    "        '- Publicara/fulfill con credenciales live\\n' +\n"
    "        '- No modifica el archivo .env\\n' +\n"
    "        '- Reiniciar Docker puede volver a SANDBOX\\n\\n' +\n"
    "        'Confirma solo si completaste checklist HTTPS/webhooks/CJ/Shopify.',\n"
    "    );\n"
    "    if (!ok) return;\n"
    "    setRealBusy(true);\n"
    "    setMessage(null);\n"
    "    try {\n"
    "      const res = await fetch(`${API}/ops/mode`, {\n"
    "        method: 'POST',\n"
    "        headers: { 'Content-Type': 'application/json' },\n"
    "        body: JSON.stringify({ mode: 'REAL', confirm: 'I_UNDERSTAND_REAL_MODE' }),\n"
    "      });\n"
    "      const data = await res.json();\n"
    "      if (data.error) setMessage(`REAL: ${data.error} — ${data.message || ''}`);\n"
    "      else setMessage(`Modo ${data.mode} activo (runtime). ${data.note || ''}`);\n"
    "      await load();\n"
    "    } catch (e: any) {\n"
    "      setMessage(e?.message || 'Error activando REAL');\n"
    "    } finally {\n"
    "      setRealBusy(false);\n"
    "    }\n"
    "  }\n"
    "\n"
    "  async function activateSandboxMode"
)

m = pattern.search(t)
if not m:
    print('Pattern not found')
    i = t.find('activateRealMode')
    print(repr(t[i:i+400]) if i >= 0 else 'missing')
    raise SystemExit(1)

t2 = pattern.sub(new_fn, t, count=1)

# Fail if any single-quoted string in confirm still contains a real newline
if re.search(r"window\.confirm\([\s\S]{0,40}'[^']*\n", t2):
    print('ERROR: still has real newline inside a quote')
    raise SystemExit(2)

p.write_text(t2, encoding='utf-8')
print('OK fixed')
i = t2.find('async function activateRealMode')
print(t2[i:i+550])
