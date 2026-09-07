import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConstraintsFromEnv, evaluateAutopilotAction } from './constraints';

describe('autopilot constraints', () => {
  const keys = [
    'ECOM_AUTOPILOT',
    'ECOM_AUTO_GO_LIVE',
    'ECOM_KILL_SWITCH',
    'ECOM_APPROVAL_MODE',
    'ECOM_MIN_MARGIN_PCT',
  ];
  const prev: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('blocks when autopilot off', () => {
    process.env.ECOM_AUTOPILOT = 'false';
    process.env.ECOM_AUTO_GO_LIVE = 'false';
    const c = loadConstraintsFromEnv();
    const r = evaluateAutopilotAction('discover', c, {
      newProductsToday: 0,
      publishesToday: 0,
      fulfillsToday: 0,
      aiCallsToday: 0,
      autoApprovesToday: 0,
    });
    expect(r.allowed).toBe(false);
  });

  it('respects publish cap', () => {
    process.env.ECOM_AUTOPILOT = 'true';
    process.env.ECOM_AUTO_GO_LIVE = 'true';
    process.env.ECOM_APPROVAL_MODE = 'AUTO';
    process.env.ECOM_MAX_PUBLISHES_PER_DAY = '2';
    const c = loadConstraintsFromEnv();
    const r = evaluateAutopilotAction(
      'auto_publish',
      c,
      {
        newProductsToday: 0,
        publishesToday: 2,
        fulfillsToday: 0,
        aiCallsToday: 0,
        autoApprovesToday: 0,
      },
      { marginPct: 40 },
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('publish_cap');
  });

  it('blocks low margin auto_approve', () => {
    process.env.ECOM_AUTOPILOT = 'true';
    process.env.ECOM_APPROVAL_MODE = 'SEMIAUTO';
    process.env.ECOM_MIN_MARGIN_PCT = '35';
    const c = loadConstraintsFromEnv();
    const r = evaluateAutopilotAction(
      'auto_approve',
      c,
      {
        newProductsToday: 0,
        publishesToday: 0,
        fulfillsToday: 0,
        aiCallsToday: 0,
        autoApprovesToday: 0,
      },
      { marginPct: 20 },
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('margin_below_min');
  });
});
