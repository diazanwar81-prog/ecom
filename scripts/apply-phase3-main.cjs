#!/usr/bin/env node
/**
 * Wires phase-3 KPIs into DashboardController + Ops endpoints.
 * docker compose run --rm workspace node scripts/apply-phase3-main.cjs
 */
const fs = require('fs');
const path = 'apps/api/src/main.ts';
let t = fs.readFileSync(path, 'utf8');

if (t.includes('phase3-runtime-wire')) {
  console.log('Already wired phase-3');
  process.exit(0);
}

// Import after phase1 import if present, else after ops import
const phase1Import = "from './phase1-runtime-wire';";
const phase3Import =
  "\nimport {\n  loadDashboardKpisFromDb,\n  loadIntegrationsHub,\n  loadSixPhaseReport,\n} from './phase3-runtime-wire';\n";

if (t.includes(phase1Import)) {
  t = t.replace(phase1Import, phase1Import + phase3Import);
} else {
  const anchor = "from '../../../packages/ops/src/index';";
  if (!t.includes(anchor)) {
    console.error('ops import not found');
    process.exit(1);
  }
  t = t.replace(anchor, anchor + phase3Import);
}

// Enhance DashboardController.summary return to include ops-p3 kpis
const dashMarker = "@Controller('dashboard')";
const dashIdx = t.indexOf(dashMarker);
if (dashIdx < 0) {
  console.error('DashboardController not found');
  process.exit(1);
}

const summaryReturn = '      dailyChecklist: checklist,';
if (!t.includes('opsP3Kpis')) {
  if (!t.includes(summaryReturn)) {
    console.warn('dashboard summary return marker not found');
  } else {
    t = t.replace(
      summaryReturn,
      "      dailyChecklist: checklist,\n      opsP3Kpis: await loadDashboardKpisFromDb(prisma),\n",
    );
  }
}

// Add methods on DashboardController before closing of class
const trendsCtrl = "@Controller('trends')";
if (!t.includes("@Get('kpis')") && t.includes(trendsCtrl)) {
  const insertMethods =
    "\n  @Get('kpis')\n" +
    '  async kpis() {\n' +
    '    return loadDashboardKpisFromDb(prisma);\n' +
    '  }\n\n' +
    "  @Get('integrations')\n" +
    '  integrations() {\n' +
    '    return loadIntegrationsHub();\n' +
    '  }\n\n';
  t = t.replace('\n}\n\n\n@Controller(\x27trends\x27)', insertMethods + '}\n\n\n@Controller(\x27trends\x27)');
  // fallback if quote style differs
  if (!t.includes("@Get('kpis')")) {
    t = t.replace(
      /\n\}\n\n\n@Controller\('trends'\)/,
      insertMethods + "}\n\n\n@Controller('trends')",
    );
  }
}

// Ops six-phase endpoint
if (!t.includes("@Get('runtime/six-phase')")) {
  const inv =
    "  @Post('inventory/sync-all')\n" +
    '  async syncAllInventory() {\n' +
    '    return runInventorySyncAll();\n' +
    '  }\n';
  const extra =
    inv +
    '\n' +
    "  @Get('runtime/six-phase')\n" +
    '  sixPhase() {\n' +
    '    return loadSixPhaseReport();\n' +
    '  }\n';
  if (t.includes(inv) && !t.includes("@Get('runtime/six-phase')")) {
    t = t.replace(inv, extra);
  } else if (t.includes("@Get('p0/verify')") && !t.includes("@Get('runtime/six-phase')")) {
    t = t.replace(
      "  @Get('p0/verify')\n  p0Verify() {\n    return phase1VerifyEndpoints();\n  }\n",
      "  @Get('p0/verify')\n  p0Verify() {\n    return phase1VerifyEndpoints();\n  }\n\n  @Get('runtime/six-phase')\n  sixPhase() {\n    return loadSixPhaseReport();\n  }\n",
    );
  }
}

fs.writeFileSync(path, t);
console.log('Wired phase-3 into', path);
