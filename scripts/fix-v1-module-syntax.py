#!/usr/bin/env python3
"""Fix: @Module({ was inserted before V1FinalController classes (syntax error)."""
from pathlib import Path

MAIN = Path('apps/api/src/main.ts')
text = MAIN.read_text(encoding='utf-8')

bad = '''@Module({
  
@Controller('v1')
'''

good = '''@Controller('v1')
'''

if bad in text:
    text = text.replace(bad, good, 1)
    print('Removed misplaced @Module({ before V1FinalController')
elif "@Module({\n  \n@Controller('v1')" in text:
    text = text.replace("@Module({\n  \n@Controller('v1')", "@Controller('v1')", 1)
    print('Removed misplaced @Module({ (variant)')
else:
    # broader: @Module({ followed soon by @Controller('v1') without controllers key
    import re
    m = re.search(r"@Module\(\{\s*\n\s*@Controller\('v1'\)", text)
    if m:
        text = text[: m.start()] + "@Controller('v1')" + text[m.end() :]
        print('Removed misplaced @Module({ via regex')
    else:
        print('Pattern not found — checking structure...')

# Ensure @Module({ exists immediately before controllers: [V1Final
if 'controllers: [V1FinalController' in text and '@Module({\n  controllers: [V1FinalController' not in text:
    text = text.replace(
        'controllers: [V1FinalController',
        '@Module({\n  controllers: [V1FinalController',
        1,
    )
    print('Inserted @Module({ before controllers array')

# Guard against duplicate @Module({
count = text.count('@Module({')
print('@Module({ count:', count)
if count != 1:
    print('WARNING: expected exactly 1 @Module({')

MAIN.write_text(text, encoding='utf-8')
print('Wrote', MAIN)
print('Has V1Final:', 'class V1FinalController' in text)
print('Has PublicLanding:', 'class PublicLandingController' in text)
