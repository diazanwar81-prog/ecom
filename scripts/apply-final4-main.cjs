#!/usr/bin/env node
/**
 * Wires final-4 endpoints into OpsController.
 * docker compose run --rm workspace node scripts/apply-final4-main.cjs
 */
const fs = require('fs');
const path = 'apps/api/src/main.ts';
let t = fs.readFileSync(path, 'utf8');

if (t.includes('final4-runtime-wire')) {
  console.log('Already wired final-4');
  process.exit(0);
}

const importBlock =
  "\nimport {\n  final4E2ePreflight,\n  final4E2eLogicTest,\n  final4Ops247,\n  final4Production,\n  final4SelfCheck,\n  final4AutopilotTick,\n} from './final4-runtime-wire';\n";

if (t.includes("from './phase3-runtime-wire';")) {
  t = t.replace("from './phase3-runtime-wire';", "from './phase3-runtime-wire';" + importBlock);
} else if (t.includes("from './phase1-runtime-wire';")) {
  t = t.replace("from './phase1-runtime-wire';", "from './phase1-runtime-wire';" + importBlock);
} else {
  console.error('phase1/3 import not found — run phase1/3 apply first');
  process.exit(1);
}

const methods =
  "\n  @Get('final4/check')\n" +
  '  final4Check() {\n' +
  '    return final4SelfCheck();\n' +
  '  }\n\n' +
  "  @Get('final4/e2e/preflight')\n" +
  '  final4E2e() {\n' +
  '    return final4E2ePreflight();\n' +
  '  }\n\n' +
  "  @Get('final4/e2e/logic')\n" +
  '  final4E2eLogic() {\n' +
  '    return final4E2eLogicTest();\n' +
  '  }\n\n' +
  "  @Get('final4/ops247')\n" +
  '  final4Ops() {\n' +
  '    return final4Ops247();\n' +
  '  }\n\n' +
  "  @Get('final4/production')\n" +
  '  final4Prod() {\n' +
  '    return final4Production();\n' +
  '  }\n\n' +
  "  @Post('final4/autopilot/tick')\n" +
  '  async final4ApTick(@Body() body: { candidates?: any[]; usage?: any }) {\n' +
  '    const usage = body?.usage || {\n' +
  '      newProductsToday: 0,\n' +
  '      publishesToday: 0,\n' +
  '      fulfillsToday: 0,\n' +
  '      aiCallsToday: 0,\n' +
  '      autoApprovesToday: 0,\n' +
  '    };\n' +
  '    let candidates = body?.candidates || [];\n' +
  '    if (!candidates.length) {\n' +
  "      const pending = await prisma.product.findMany({ where: { status: 'PENDING_APPROVAL' }, take: 10 });\n" +
  '      candidates = pending.map((p) => ({\n' +
  '        id: p.id,\n' +
  '        title: p.title,\n' +
  '        marginPercent: p.marginPercent != null ? Number(p.marginPercent) : undefined,\n' +
  '        isFirstPublish: p.isFirstPublication,\n' +
  '      }));\n' +
  '    }\n' +
  '    return final4AutopilotTick(candidates, usage);\n' +
  '  }\n';

if (!t.includes("@Get('final4/check')")) {
  if (t.includes("@Get('runtime/six-phase')")) {
    t = t.replace(
      /@Get\('runtime\/six-phase'\)\s*\n\s*sixPhase\(\) \{[\s\S]*?\n  \}/,
      (m) => m + methods,
    );
  } else if (t.includes("@Get('p0/verify')")) {
    t = t.replace(
      /@Get\('p0\/verify'\)\s*\n\s*p0Verify\(\) \{[\s\S]*?\n  \}/,
      (m) => m + methods,
    );
  } else {
    console.error('ops endpoints anchor not found');
    process.exit(1);
  }
}

fs.writeFileSync(path, t);
console.log('Wired final-4 into', path);
