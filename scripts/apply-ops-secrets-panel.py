#!/usr/bin/env python3
"""
Add GET/POST /ops/secrets for runtime secrets management
+ section in apps/web/app/page.tsx
"""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
WEB = Path('apps/web/app/page.tsx')

# ---------- API ----------
api = MAIN.read_text(encoding='utf-8')

SECRETS_BLOCK = r'''
  /** Lista enmascarada de integraciones configurables en runtime */
  @Get('secrets')
  listSecrets() {
    const mask = (v?: string | null) => {
      const s = String(v || '').trim();
      if (!s) return { configured: false, preview: '', length: 0 };
      if (s.length <= 8) return { configured: true, preview: '****', length: s.length };
      return {
        configured: true,
        preview: s.slice(0, 4) + '…' + s.slice(-4),
        length: s.length,
      };
    };
    const keys = [
      'ECOM_MODE',
      'SHOPIFY_SHOP_DOMAIN',
      'SHOPIFY_SHOP',
      'SHOPIFY_ACCESS_TOKEN',
      'SHOPIFY_CLIENT_ID',
      'SHOPIFY_CLIENT_SECRET',
      'SHOPIFY_WEBHOOK_SECRET',
      'SHOPIFY_API_VERSION',
      'CJ_API_KEY',
      'CJ_DEFAULT_VID',
      'CJ_DEFAULT_SKU',
      'CJ_LOGISTIC_NAME',
      'CJ_FROM_COUNTRY',
      'CJ_USD_COP_RATE',
      'SERPER_API_KEY',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'HF_TOKEN',
      'HF_MODEL',
      'ECOM_AI_FORCE_LIVE',
      'ECOM_ALLOW_PAID_AI',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_CHAT_ID',
      'APP_URL',
      'API_URL',
      'ECOM_PUBLIC_HTTPS_URL',
      'ECOM_DISCOVERY_INTERVAL_MINUTES',
      'ECOM_REAL_CONFIRM',
    ] as const;
    const items: Record<string, any> = {};
    for (const k of keys) {
      if (k === 'ECOM_MODE' || k === 'GEMINI_MODEL' || k === 'HF_MODEL' || k === 'SHOPIFY_API_VERSION' || k === 'CJ_LOGISTIC_NAME' || k === 'CJ_FROM_COUNTRY' || k === 'CJ_USD_COP_RATE' || k === 'CJ_DEFAULT_VID' || k === 'CJ_DEFAULT_SKU' || k === 'APP_URL' || k === 'API_URL' || k === 'ECOM_PUBLIC_HTTPS_URL' || k === 'ECOM_DISCOVERY_INTERVAL_MINUTES' || k === 'SHOPIFY_SHOP_DOMAIN' || k === 'SHOPIFY_SHOP') {
        items[k] = {
          configured: Boolean(String(process.env[k] || '').trim()),
          value: String(process.env[k] || ''),
          secret: false,
        };
      } else {
        items[k] = { ...mask(process.env[k]), secret: true };
      }
    }
    return {
      mode: process.env.ECOM_MODE || 'MOCK',
      note: 'Valores en proceso (runtime). No reescribe .env. Reiniciar Docker puede volver al archivo.',
      items,
    };
  }

  /** Actualiza process.env en runtime. Solo claves en allowlist. */
  @Post('secrets')
  setSecrets(
    @Body()
    body: {
      values?: Record<string, string>;
      confirm?: string;
    },
  ) {
    const allow = new Set([
      'ECOM_MODE',
      'SHOPIFY_SHOP_DOMAIN',
      'SHOPIFY_SHOP',
      'SHOPIFY_ACCESS_TOKEN',
      'SHOPIFY_CLIENT_ID',
      'SHOPIFY_CLIENT_SECRET',
      'SHOPIFY_WEBHOOK_SECRET',
      'SHOPIFY_API_VERSION',
      'CJ_API_KEY',
      'CJ_DEFAULT_VID',
      'CJ_DEFAULT_SKU',
      'CJ_LOGISTIC_NAME',
      'CJ_FROM_COUNTRY',
      'CJ_USD_COP_RATE',
      'SERPER_API_KEY',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'HF_TOKEN',
      'HF_MODEL',
      'ECOM_AI_FORCE_LIVE',
      'ECOM_ALLOW_PAID_AI',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_CHAT_ID',
      'APP_URL',
      'API_URL',
      'ECOM_PUBLIC_HTTPS_URL',
      'ECOM_DISCOVERY_INTERVAL_MINUTES',
      'ECOM_REAL_CONFIRM',
    ]);
    const incoming = body?.values || {};
    const updated: string[] = [];
    const rejected: string[] = [];
    for (const [k, v] of Object.entries(incoming)) {
      if (!allow.has(k)) {
        rejected.push(k);
        continue;
      }
      if (v === undefined || v === null) continue;
      const val = String(v).trim();
      // vacío = no tocar (para no borrar por error al enviar form parcial)
      if (val === '') continue;
      if (k === 'ECOM_MODE') {
        const m = val.toUpperCase();
        if (!['MOCK', 'SANDBOX', 'REAL'].includes(m)) {
          rejected.push(k);
          continue;
        }
        if (m === 'REAL' && String(body?.confirm || '') !== 'I_UNDERSTAND_REAL_MODE') {
          return {
            error: 'confirm_required',
            message: 'REAL requiere confirm=I_UNDERSTAND_REAL_MODE',
          };
        }
        process.env.ECOM_MODE = m;
        if (m === 'REAL') process.env.ECOM_REAL_CONFIRM = 'I_UNDERSTAND_REAL_MODE';
        updated.push(k);
        continue;
      }
      process.env[k] = val;
      updated.push(k);
    }
    try {
      void writeAudit('OPS_SECRETS_UPDATE', 'System', 'secrets', {
        updated,
        rejected,
      });
    } catch {}
    return {
      ok: true,
      updated,
      rejected,
      mode: process.env.ECOM_MODE || 'MOCK',
      note: 'Aplicado en runtime. No escribe .env.',
    };
  }
'''

# Insert secrets endpoints before closing of OpsController (before last }
# of OpsController after inventory/sync-all)
MARKER = "    return { mode: process.env.ECOM_MODE || 'MOCK', count: results.length, results };\n  }\n}\n\n\n@Controller('scoring')"

if "@Get('secrets')" in api:
    print('API secrets already present')
elif MARKER in api:
    api = api.replace(
        MARKER,
        "    return { mode: process.env.ECOM_MODE || 'MOCK', count: results.length, results };\n  }"
        + SECRETS_BLOCK
        + "}\n\n\n@Controller('scoring')",
        1,
    )
    print('API /ops/secrets inserted')
else:
    # fallback: after @Get('status') of OpsController
    m2 = "@Controller('ops')\nclass OpsController {\n  @Get('status')"
    if m2 in api and "@Get('secrets')" not in api:
        api = api.replace(
            m2,
            "@Controller('ops')\nclass OpsController {" + SECRETS_BLOCK + "\n  @Get('status')",
            1,
        )
        print('API secrets inserted at OpsController start')
    else:
        print('WARNING: could not insert API secrets')

MAIN.write_text(api, encoding='utf-8')

# ---------- WEB ----------
web = WEB.read_text(encoding='utf-8')

if 'secretsForm' not in web:
    web = web.replace(
        'const [board, setBoard] = useState<any>(null);',
        '''const [board, setBoard] = useState<any>(null);
  const [secretsMeta, setSecretsMeta] = useState<any>(null);
  const [secretsForm, setSecretsForm] = useState<Record<string, string>>({});
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [secretsMsg, setSecretsMsg] = useState<string | null>(null);''',
        1,
    )
    print('web state secrets added')

# load secrets in load()
if "fetch(`${API}/ops/secrets`)" not in web:
    # after setBoard
    if 'setBoard(b);' in web:
        web = web.replace(
            'setBoard(b);',
            '''setBoard(b);
        try {
          const sec = await fetch(`${API}/ops/secrets`).then((x) => x.json());
          setSecretsMeta(sec);
          const init: Record<string, string> = {};
          for (const [k, v] of Object.entries(sec.items || {})) {
            if (!(v as any).secret && (v as any).value != null) init[k] = String((v as any).value);
            else init[k] = '';
          }
          setSecretsForm((prev) => ({ ...init, ...prev }));
        } catch {
          /* optional */
        }''',
            1,
        )
        print('web load secrets hooked')

SAVE_FN = '''
  async function saveSecrets() {
    setSecretsMsg(null);
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(secretsForm)) {
      if (String(v || '').trim()) values[k] = String(v).trim();
    }
    const body: any = { values };
    if (values.ECOM_MODE === 'REAL') body.confirm = 'I_UNDERSTAND_REAL_MODE';
    const res = await fetch(`${API}/ops/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) setSecretsMsg(`Error: ${data.error} ${data.message || ''}`);
    else setSecretsMsg(`Guardado runtime: ${(data.updated || []).join(', ') || 'sin cambios'}`);
    // clear secret fields after save so they don't linger in UI
    setSecretsForm((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (['SHOPIFY_ACCESS_TOKEN','SHOPIFY_CLIENT_SECRET','SHOPIFY_WEBHOOK_SECRET','CJ_API_KEY','SERPER_API_KEY','GEMINI_API_KEY','HF_TOKEN','TELEGRAM_BOT_TOKEN'].includes(k)) {
          next[k] = '';
        }
      }
      return next;
    });
    await load();
  }
'''

if 'async function saveSecrets' not in web:
    web = web.replace(
        'async function fulfillOrder(id: string) {',
        SAVE_FN + '\n  async function fulfillOrder(id: string) {',
        1,
    )
    print('saveSecrets helper added')

SECTION = '''
      <section
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '0.85rem 1rem',
          marginBottom: '1.1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>APIs · tokens · IDs</h2>
          <button type="button" onClick={() => setSecretsOpen((o) => !o)} style={{ cursor: 'pointer' }}>
            {secretsOpen ? 'Ocultar' : 'Configurar'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#64748b', margin: '6px 0 0' }}>
          Cambia claves en runtime sin editar .env. No se muestran secretos completos; deja vacío para no
          modificar. Reiniciar Docker puede restaurar el .env.
        </p>
        {secretsOpen && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 10,
              }}
            >
              {[
                ['ECOM_MODE', 'MOCK | SANDBOX | REAL'],
                ['SHOPIFY_SHOP_DOMAIN', 'ej. e1-v1.myshopify.com'],
                ['SHOPIFY_ACCESS_TOKEN', 'shpat_…'],
                ['SHOPIFY_CLIENT_ID', ''],
                ['SHOPIFY_CLIENT_SECRET', 'shpss_…'],
                ['SHOPIFY_WEBHOOK_SECRET', ''],
                ['CJ_API_KEY', 'CJ…@api@…'],
                ['CJ_DEFAULT_VID', ''],
                ['CJ_DEFAULT_SKU', ''],
                ['CJ_LOGISTIC_NAME', 'CJPacket Ordinary'],
                ['CJ_FROM_COUNTRY', 'CN'],
                ['CJ_USD_COP_RATE', '4200'],
                ['SERPER_API_KEY', ''],
                ['GEMINI_API_KEY', ''],
                ['GEMINI_MODEL', 'gemini-2.0-flash'],
                ['HF_TOKEN', 'hf_…'],
                ['TELEGRAM_BOT_TOKEN', ''],
                ['TELEGRAM_CHAT_ID', ''],
                ['ECOM_PUBLIC_HTTPS_URL', 'https://….trycloudflare.com'],
                ['ECOM_AI_FORCE_LIVE', 'true | false'],
              ].map(([key, ph]) => {
                const meta = secretsMeta?.items?.[key];
                const configured = meta?.configured;
                const preview = meta?.secret ? meta?.preview : meta?.value;
                return (
                  <label key={key} style={{ fontSize: 12, display: 'block' }}>
                    <span style={{ fontWeight: 600 }}>{key}</span>
                    {configured ? (
                      <span style={{ color: '#16a34a', marginLeft: 6 }}>· ok {preview || ''}</span>
                    ) : (
                      <span style={{ color: '#94a3b8', marginLeft: 6 }}>· vacío</span>
                    )}
                    <input
                      type={meta?.secret ? 'password' : 'text'}
                      placeholder={ph || (configured ? '•••• (dejar vacío = no cambiar)' : '')}
                      value={secretsForm[key] ?? ''}
                      onChange={(e) =>
                        setSecretsForm((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      style={{
                        width: '100%',
                        marginTop: 4,
                        padding: 6,
                        boxSizing: 'border-box',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                      }}
                      autoComplete="off"
                    />
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={saveSecrets}
                style={{
                  cursor: 'pointer',
                  background: '#0f172a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 14px',
                  fontWeight: 600,
                }}
              >
                Guardar en runtime
              </button>
              <button
                type="button"
                onClick={async () => {
                  const sec = await fetch(`${API}/ops/secrets`).then((x) => x.json());
                  setSecretsMeta(sec);
                }}
                style={{ cursor: 'pointer' }}
              >
                Refrescar estado
              </button>
              {secretsMsg && <span style={{ fontSize: 13, color: '#334155' }}>{secretsMsg}</span>}
            </div>
          </div>
        )}
      </section>
'''

if 'APIs · tokens · IDs' not in web:
    # insert after header / before notifications section — use first section after header
    anchor = "      <section\n        style={{\n          background: '#fff',\n          border: '1px solid #e2e8f0',\n          borderRadius: 10,\n          padding: '0.85rem 1rem',\n          marginBottom: '1.1rem',\n        }}\n      >\n        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>"
    if anchor in web:
        web = web.replace(anchor, SECTION + '\n' + anchor, 1)
        print('web secrets section inserted')
    else:
        # try after error line
        if '{error && <p style={{ color: \'#dc2626\' }}>Error: {error}</p>}' in web:
            web = web.replace(
                "{error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}",
                "{error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}\n" + SECTION,
                1,
            )
            print('web secrets section after error')
        else:
            print('WARNING: could not place secrets section')
else:
    print('web secrets section already present')

WEB.write_text(web, encoding='utf-8')
print('Done. web lines', len(web.splitlines()), 'api lines', len(api.splitlines()))
