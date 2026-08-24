#!/usr/bin/env python3
"""
1) Extend POST /products/:id/generate-copy to accept title + instructions + applyTitle
2) Add POST /ops/mode for runtime ECOM_MODE switch (REAL requires confirm)
Does not rewrite whole main.ts — surgical replaces.
"""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

OLD_COPY = '''  @Post(':id/generate-copy')
  async generateCopy(@Param('id') id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const enriched = enrichProduct(p);
    const result = await generateProductCopy({
      title: enriched.title,
      facts: `costo ${enriched.productCost}, stock ${enriched.stock}, proveedor ${enriched.supplierName}`,
      language: 'es-CO',
    });
    if (result.ok && result.text) {
      await prisma.product.update({ where: { id }, data: { description: result.text.slice(0, 4000) } });
    }
    await writeAudit('AI_PRODUCT_COPY', 'Product', id, { provider: result.provider });
    return { mode: MODE, productId: id, result };
  }
}'''

NEW_COPY = '''  @Post(':id/generate-copy')
  async generateCopy(
    @Param('id') id: string,
    @Body()
    body?: {
      title?: string;
      instructions?: string;
      applyTitle?: boolean;
      language?: string;
    },
  ) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: { suppliers: { include: { supplier: true }, orderBy: { isPrimary: 'desc' } } },
    });
    if (!p) return { error: 'not_found' };
    const enriched = enrichProduct(p);
    const titleForCopy = (body?.title || enriched.title || '').trim() || enriched.title;
    const extra = (body?.instructions || '').trim();
    const facts = [
      `costo ${enriched.productCost}`,
      `stock ${enriched.stock}`,
      `proveedor ${enriched.supplierName}`,
      `sku ${enriched.cjSku || 'n/a'}`,
      `precio venta ${enriched.salePrice} ${enriched.currency || 'COP'}`,
      extra ? `notas editor: ${extra}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    const result = await generateProductCopy({
      title: titleForCopy,
      facts,
      language: body?.language || 'es-CO',
    });

    const data: any = {};
    if (result.ok && result.text) {
      data.description = result.text.slice(0, 4000);
      // Heurística: si el modelo devuelve "Título: ...\\nDescripción: ..." separar
      const m = String(result.text).match(
        /(?:t[ií]tulo|title)\s*[:：]\s*(.+)\n+(?:descripci[oó]n|description)?\s*[:：]?\s*([\\s\\S]+)/i,
      );
      if (m && body?.applyTitle !== false) {
        const cleanT = m[1].replace(/[*#]/g, '').trim().slice(0, 180);
        if (cleanT.length > 8) data.title = cleanT;
        if (m[2]?.trim()) data.description = m[2].trim().slice(0, 4000);
      } else if (body?.applyTitle && body?.title) {
        data.title = body.title.trim().slice(0, 180);
      }
    } else if (body?.applyTitle && body?.title) {
      data.title = body.title.trim().slice(0, 180);
    }

    let updated = null;
    if (Object.keys(data).length) {
      updated = await prisma.product.update({ where: { id }, data });
    }
    await writeAudit('AI_PRODUCT_COPY', 'Product', id, {
      provider: result.provider,
      applyTitle: Boolean(body?.applyTitle),
      hasInstructions: Boolean(extra),
    });
    return {
      mode: MODE,
      productId: id,
      result,
      product: updated ? enrichProduct({ ...p, ...updated }) : enrichProduct(p),
    };
  }

  /** Guardar branding manual (título + descripción) sin llamar IA */
  @Post(':id/branding')
  async saveBranding(
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; approved?: boolean },
  ) {
    const p = await prisma.product.findUnique({ where: { id } });
    if (!p) return { error: 'not_found' };
    const data: any = {};
    if (typeof body?.title === 'string' && body.title.trim()) {
      data.title = body.title.trim().slice(0, 180);
    }
    if (typeof body?.description === 'string') {
      data.description = body.description.slice(0, 4000);
    }
    if (!Object.keys(data).length) return { error: 'empty' };
    const updated = await prisma.product.update({ where: { id }, data });
    await writeAudit(
      body?.approved ? 'BRANDING_APPROVED' : 'BRANDING_SAVED',
      'Product',
      id,
      { keys: Object.keys(data) },
    );
    return { mode: MODE, product: enrichProduct(updated), approved: Boolean(body?.approved) };
  }
}'''

if OLD_COPY in text:
    text = text.replace(OLD_COPY, NEW_COPY, 1)
    print('generate-copy + branding endpoints patched')
elif "@Post(':id/branding')" in text:
    print('branding endpoint already present')
else:
    print('WARNING: generate-copy block not found exactly — manual check needed')

# Runtime mode switch on OpsController
OPS_MARK = "@Controller('ops')\nclass OpsController {"
OPS_MODE = '''@Controller('ops')
class OpsController {
  /** Cambia ECOM_MODE en runtime (hasta reinicio del contenedor). REAL exige confirm. */
  @Post('mode')
  setMode(
    @Body()
    body: {
      mode?: string;
      confirm?: string;
    },
  ) {
    const next = String(body?.mode || '')
      .trim()
      .toUpperCase();
    if (!['MOCK', 'SANDBOX', 'REAL'].includes(next)) {
      return { error: 'invalid_mode', allowed: ['MOCK', 'SANDBOX', 'REAL'] };
    }
    if (next === 'REAL') {
      const conf = String(body?.confirm || '').trim();
      if (conf !== 'I_UNDERSTAND_REAL_MODE') {
        return {
          error: 'confirm_required',
          message:
            'Para REAL envía confirm=I_UNDERSTAND_REAL_MODE. No escribe .env; solo proceso actual.',
        };
      }
      process.env.ECOM_REAL_CONFIRM = 'I_UNDERSTAND_REAL_MODE';
    }
    process.env.ECOM_MODE = next;
    // MODE const in file may be frozen at boot — health reads process.env when possible
    return {
      ok: true,
      mode: next,
      note:
        next === 'REAL'
          ? 'REAL activo en este proceso. Reiniciar contenedor sin ECOM_REAL_CONFIRM vuelve a .env.'
          : `Modo ${next} activo en runtime`,
      persistedInEnvFile: false,
    };
  }
'''

if "@Post('mode')" in text and 'setMode' in text:
    print('ops/mode already present')
elif OPS_MARK in text:
    text = text.replace(OPS_MARK, OPS_MODE, 1)
    print('ops/mode endpoint added')
else:
    print('WARNING: OpsController not found')

MAIN.write_text(text, encoding='utf-8')
print('Wrote', MAIN)
