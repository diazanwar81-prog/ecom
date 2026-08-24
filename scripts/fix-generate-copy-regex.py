#!/usr/bin/env python3
"""Fix unterminated regex in generate-copy caused by real newline in pattern."""
from pathlib import Path
import re

p = Path('apps/api/src/main.ts')
t = p.read_text(encoding='utf-8')

# Broken pattern spans two lines after (.+)
broken = re.compile(
    r"const m = String\(result\.text\)\.match\(\s*/(?:t\[i[^"]*?\)i,\s*\);",
    re.S,
)

# Safe: no real newlines inside the JS regex literal
fixed = (
    "const m = String(result.text).match(\n"
    "        /(?:t[i\\u00ed]tulo|title)\\s*[:\\uFF1A]?\\s*(.+)\\n+(?:descripci[o\\u00f3]n|description)?\\s*[:\\uFF1A]?\\s*([\\s\\S]+)/i,\n"
    "      );"
)

# Simpler approach without unicode escapes in character classes — use explicit alternation
fixed = (
    "const m = String(result.text).match(\n"
    r"        /(?:titulo|título|title)\s*[:：]?\s*(.+)\n+(?:descripcion|descripción|description)?\s*[:：]?\s*([\s\S]+)/i,"
    "\n"
    "      );"
)

# Actually the cleanest: avoid special chars in regex entirely
fixed = '''const m = String(result.text).match(
        /(?:titulo|title)\s*:\s*(.+)\n+(?:descripcion|description)?\s*:?\s*([\s\S]+)/i,
      );'''

# Ensure fixed string as written to file uses literal backslash-n inside the regex
# In Python triple quotes, \\n in regex source for JS must be: we need the file to contain \n as two chars
fixed = (
    "const m = String(result.text).match(\n"
    "        /(?:titulo|title)\\s*:\\s*(.+)\\n+(?:descripcion|description)?\\s*:?\\s*([\\s\\S]+)/i,\n"
    "      );"
)

if 'const m = String(result.text).match(' not in t:
    print('match block not found')
    raise SystemExit(1)

# Replace from const m = ... through ); that closes match(
old = re.compile(
    r"const m = String\(result\.text\)\.match\([\s\S]*?\);",
    re.M,
)
m = old.search(t)
if not m:
    print('could not find match() call')
    raise SystemExit(1)

print('Found at', m.start(), 'len', len(m.group(0)))
print('OLD repr:', repr(m.group(0)[:200]))

t2 = old.sub(fixed, t, count=1)

# Validate: the regex line should not have an unescaped real newline between / and /i
# Extract the new match call
m2 = old.search(t2)
if not m2:
    # fixed doesn't match old pattern because structure same - search fixed string presence
    if '\\n+(?:descripcion' not in t2 and '\n+(?:descripcion' not in t2:
        # check for proper form
        pass

if 'Unterminated' in t2:
    pass

p.write_text(t2, encoding='utf-8')
print('Wrote fix')
# show context
idx = t2.find('const m = String(result.text).match')
print(t2[idx:idx+220])
