#!/usr/bin/env python3
"""Replace inline approvals section with <ApprovalsPanel /> + import."""
from pathlib import Path
import re

WEB = Path(__file__).resolve().parents[1] / "apps/web/app/page.tsx"
t = WEB.read_text()

if "ApprovalsPanel" in t and "from '../components/ApprovalsPanel'" in t:
    print("already wired")
    raise SystemExit(0)

if "from '../components/ApprovalsPanel'" not in t:
    t = t.replace(
        "import { useEffect, useState } from 'react';",
        "import { useEffect, useState } from 'react';\nimport { ApprovalsPanel } from '../components/ApprovalsPanel';",
        1,
    )
    print("import added")

# Remove duplicate pendingApprovals helpers if only used by old panel — keep for safety

pattern = re.compile(
    r"<section style=\{\{ marginBottom: '1.75rem', background: '#fff7ed'.*?</section>",
    re.S,
)
m = pattern.search(t)
if m:
    t = t[: m.start()] + "      <ApprovalsPanel />\n" + t[m.end() :]
    print("replaced approvals section with <ApprovalsPanel />")
else:
    # fallback h2 title
    m2 = re.search(r"<section[^>]*>\s*<h2[^>]*>Panel de aprobaciones</h2>[\s\S]*?</section>", t)
    if m2:
        t = t[: m2.start()] + "      <ApprovalsPanel />\n" + t[m2.end() :]
        print("replaced via h2 fallback")
    else:
        print("WARN: approvals section not found")

WEB.write_text(t)
print("done")
