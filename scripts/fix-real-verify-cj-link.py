#!/usr/bin/env python3
"""Fix RealCloseController.verify to count PUBLISHED products with CJ link on ProductSupplier."""
from pathlib import Path

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

OLD = """    const products = await prisma.product.findMany({ take: 200 });
    const orders = await prisma.order.findMany({ take: 200 });
    const publishedWithCj = products.filter(
      (p) => p.status === 'PUBLISHED' && ((p as any).cjVariantId || (p as any).cjSku),
    ).length;"""

NEW = """    const products = await prisma.product.findMany({
      take: 200,
      include: { suppliers: true },
    });
    const orders = await prisma.order.findMany({ take: 200 });
    const publishedWithCj = products.filter((p) => {
      if (p.status !== 'PUBLISHED') return false;
      return (p.suppliers || []).some(
        (s: any) => Boolean(s.cjVariantId || s.cjSku),
      );
    }).length;"""

if OLD not in t:
    if "include: { suppliers: true }" in t and "publishedWithCj" in t:
        print("already fixed")
        raise SystemExit(0)
    print("pattern not found — searching alternate")
    if "const publishedWithCj = products.filter" in t:
        # broader replace around publishedWithCj block
        import re
        t2, n = re.subn(
            r"const products = await prisma\.product\.findMany\(\{ take: 200 \}\);\s*"
            r"const orders = await prisma\.order\.findMany\(\{ take: 200 \}\);\s*"
            r"const publishedWithCj = products\.filter\([\s\S]*?\)\.length;",
            NEW.strip() + "\n",
            t,
            count=1,
        )
        if n:
            t = t2
            print("fixed via regex")
        else:
            print("FAILED to patch")
            raise SystemExit(1)
    else:
        print("FAILED")
        raise SystemExit(1)
else:
    t = t.replace(OLD, NEW, 1)
    print("fixed exact")

# also inventory stock from primary supplier if present
OLD_INV = """    const inv = applyInventoryPolicy(
      products.map((p) => ({
        productId: p.id,
        stock: (p as any).stock ?? null,
        status: p.status,
      })),
    );"""

NEW_INV = """    const inv = applyInventoryPolicy(
      products.map((p) => {
        const primary = (p.suppliers || []).find((s: any) => s.isPrimary) || (p.suppliers || [])[0];
        return {
          productId: p.id,
          stock: primary?.stock ?? null,
          status: p.status,
        };
      }),
    );"""

if OLD_INV in t:
    t = t.replace(OLD_INV, NEW_INV, 1)
    print("inventory stock from ProductSupplier")
elif "primary?.stock" in t:
    print("inventory already from supplier")
else:
    print("inventory pattern skip")

MAIN.write_text(t)
print("done")
