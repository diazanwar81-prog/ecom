import { describe, it, expect } from 'vitest';
import { complete, getRouterStatus, generateProductCopy } from './index';

describe('getRouterStatus', () => {
  it('exposes zero automatic budget', () => {
    const s = getRouterStatus();
    expect(s.budgetUsdAutomatic).toBe(0);
    expect(s.providers.some((p) => p.id === 'gemini')).toBe(true);
    expect(s.providers.some((p) => p.id === 'huggingface')).toBe(true);
    expect(s.providers.some((p) => p.id === 'mock')).toBe(true);
  });
});

describe('complete in MOCK', () => {
  it('returns mock response without external calls', async () => {
    const r = await complete({
      task: 'general',
      messages: [{ role: 'user', content: 'Hola ECOM' }],
    });
    expect(r.ok).toBe(true);
    expect(r.mock).toBe(true);
    expect(r.provider).toBe('mock');
    expect(r.text).toContain('[MOCK]');
  });

  it('generates product description mock', async () => {
    const r = await generateProductCopy({
      title: 'Organizador cocina',
      facts: 'plástico, plegable, 30cm',
    });
    expect(r.mock).toBe(true);
    expect(r.text.length).toBeGreaterThan(10);
  });
});
