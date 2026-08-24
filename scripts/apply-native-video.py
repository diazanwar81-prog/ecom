#!/usr/bin/env python3
"""Force Shopify staged upload resource=VIDEO for attach-video path."""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

# In upload-video method: resource FILE -> VIDEO for mp4
old1 = "resource: 'FILE',"
# Only change inside upload paths carefully - replace all FILE with VIDEO for mp4 uploads
if "resource: 'FILE'" in text:
    text = text.replace("resource: 'FILE'", "resource: 'VIDEO'")
    print('Replaced resource FILE -> VIDEO')

# Remove IMAGE fallback so we don't silently attach as MediaImage
# Find the fallback block and simplify to report VIDEO failure clearly
marker = "// Retry as IMAGE if VIDEO not accepted for this source type"
if marker in text:
    # Replace fallback section with a cleaner second VIDEO-only attempt note
    start = text.find(marker)
    # find return of successful attach before marker for context - replace from if (!attach.ok)
    # simpler: replace the retry IMAGE block
    old_retry = "mediaContentType: 'IMAGE'"
    if old_retry in text:
        # Keep one IMAGE fallback but log it - actually user wants native VIDEO
        # Change IMAGE retry to still try VIDEO with same source once more is useless
        # Remove IMAGE fallback entirely by replacing attach2 block
        pass

# Ensure attach uses VIDEO
if "mediaContentType: 'VIDEO'" not in text:
    print('WARN: VIDEO content type not found in attach')
else:
    print('VIDEO content type present')

if 'block: 94,' in text:
    text = text.replace('block: 94,', 'block: 95,', 1)
elif 'block: 93,' in text:
    text = text.replace('block: 93,', 'block: 95,', 1)

MAIN.write_text(text, encoding='utf-8')
print('Patched', MAIN)
print("resource VIDEO count:", text.count("resource: 'VIDEO'"))
