import { runPhases } from './index';

const result = runPhases([0, 1, 2]);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
