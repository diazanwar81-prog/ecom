#!/usr/bin/env python3
"""Fix: cleanProductTitle was inserted between @Controller and class."""
from pathlib import Path

MAIN = Path(__file__).resolve().parents[1] / "apps/api/src/main.ts"
t = MAIN.read_text()

broken = '''@Controller('products')

function cleanProductTitle(raw: string): string {
  return String(raw || '')
    .replace(/\\[(?:MOCK|SERPER\\+CJ|SERPER|CJ)\\]\\s*/gi, '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Producto ECOM';
}

class ProductsController {'''

# More tolerant match without over-escaping
import re
pat = re.compile(
    r"@Controller\('products'\)\s*\n\s*function cleanProductTitle\(raw: string\): string \{[\s\S]*?\}\n\s*class ProductsController \{",
    re.M,
)
m = pat.search(t)
if not m:
    if "@Controller('products')\nclass ProductsController" in t or "@Controller('products')\n\nclass ProductsController" in t:
        print("Already fixed or different layout")
    else:
        print("Pattern not found — dumping context")
        idx = t.find("cleanProductTitle")
        print(repr(t[idx-80:idx+200]))
    raise SystemExit(1 if not m else 0)

fixed = '''function cleanProductTitle(raw: string): string {
  return String(raw || '')
    .replace(/\\[(?:MOCK|SERPER\\+CJ|SERPER|CJ)\\]\\s*/gi, '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Producto ECOM';
}

@Controller('products')
class ProductsController {'''

# Write fixed with correct regex for TS source (single backslashes in file)
fixed = """function cleanProductTitle(raw: string): string {
  return String(raw || '')
    .replace(/\[(?:MOCK|SERPER\+CJ|SERPER|CJ)\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Producto ECOM';
}

@Controller('products')
class ProductsController {"""

t2 = pat.sub(fixed, t, count=1)
if t2 == t:
    print("No change")
    raise SystemExit(1)
MAIN.write_text(t2)
print("Fixed decorator placement")
print("OK check:", "@Controller('products')\nclass ProductsController" in t2 or "@Controller('products')\nclass ProductsController" in t2.replace('\n\n','\n'))
