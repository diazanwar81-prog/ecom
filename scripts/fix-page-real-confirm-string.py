#!/usr/bin/env python3
from pathlib import Path
import re

p = Path('apps/web/app/page.tsx')
t = p.read_text(encoding='utf-8')

# Replace broken activateRealMode confirm block
pattern = re.compile(
    r"async function activateRealMode\(\) \{[\s\S]*?async function activateSandboxMode",
    re.M,
)

replacement = '''async function activateRealMode() {
    if (realBusy) return;
    const ok = window.confirm(
      'Activar modo REAL en este proceso?\n\n' +
        '- Publicara/fulfill con credenciales live\n' +
        '- No modifica el archivo .env\n' +
        '- Reiniciar Docker puede volver a SANDBOX\n\n' +
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

  async function activateSandboxMode'''

if pattern.search(t):
    t2, n = pattern.subn(replacement, t, count=1)
    if n != 1:
        print('replace count unexpected', n)
    p.write_text(t2, encoding='utf-8')
    print('Fixed activateRealMode string')
else:
    print('Pattern not found')
    # show snippet around activateRealMode
    i = t.find('activateRealMode')
    print(repr(t[i:i+400]) if i>=0 else 'no activateRealMode')
