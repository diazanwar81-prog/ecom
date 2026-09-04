import { describe, it, expect } from 'vitest';
import { verifyPhase0, verifyPhase1, verifyPhase2, runPhases } from './index';

describe('phase-runner 0-1-2', () => {
  it('phase 0 passes local gates', () => {
    const r = verifyPhase0();
    expect(r.ok).toBe(true);
    expect(r.criticalFailed).toBe(0);
  });

  it('phase 1 hmac and inventory logic pass', () => {
    const r = verifyPhase1();
    expect(r.ok).toBe(true);
  });

  it('phase 2 scoring pass', () => {
    const r = verifyPhase2();
    expect(r.ok).toBe(true);
  });

  it('runPhases sequential all green', () => {
    const all = runPhases([0, 1, 2]);
    expect(all.ok).toBe(true);
    expect(all.reports).toHaveLength(3);
  });
});
