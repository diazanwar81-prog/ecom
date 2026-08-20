import { describe, it, expect } from 'vitest';
import {
  calculateMargin,
  decideStock,
  decidePriceChange,
  canAutoPublish,
  requiresHumanApproval,
  RULES,
} from './index';

describe('calculateMargin', () => {
  it('returns IDEAL when margin >= 40%', () => {
    const r = calculateMargin({
      salePrice: 100,
      costs: { productCost: 40, shippingCost: 10 },
    });
    expect(r.marginPercent).toBe(50);
    expect(r.band).toBe('IDEAL');
    expect(r.canPublish).toBe(true);
    expect(r.shouldPause).toBe(false);
  });

  it('returns OPERATIONAL when 35% <= margin < 40%', () => {
    const r = calculateMargin({
      salePrice: 100,
      costs: { productCost: 50, shippingCost: 12 },
    });
    expect(r.marginPercent).toBe(38);
    expect(r.band).toBe('OPERATIONAL');
    expect(r.canPublish).toBe(true);
  });

  it('returns ALERT when 30% <= margin < 35%', () => {
    const r = calculateMargin({
      salePrice: 100,
      costs: { productCost: 55, shippingCost: 12 },
    });
    expect(r.marginPercent).toBe(33);
    expect(r.band).toBe('ALERT');
    expect(r.canPublish).toBe(false);
    expect(r.shouldAlert).toBe(true);
  });

  it('returns PAUSE when margin < 30%', () => {
    const r = calculateMargin({
      salePrice: 100,
      costs: { productCost: 70, shippingCost: 10 },
    });
    expect(r.marginPercent).toBe(20);
    expect(r.band).toBe('PAUSE');
    expect(r.shouldPause).toBe(true);
    expect(r.canPublish).toBe(false);
  });

  it('handles invalid sale price', () => {
    const r = calculateMargin({ salePrice: 0, costs: { productCost: 10, shippingCost: 5 } });
    expect(r.band).toBe('PAUSE');
    expect(r.canPublish).toBe(false);
  });
});

describe('decideStock', () => {
  it('pauses when stock is 0', () => {
    expect(decideStock(0).shouldPause).toBe(true);
  });
  it('does not pause when stock > 0', () => {
    expect(decideStock(5).shouldPause).toBe(false);
  });
  it('does not pause when stock is unknown', () => {
    expect(decideStock(null).shouldPause).toBe(false);
  });
});

describe('decidePriceChange', () => {
  const costs = { productCost: 40, shippingCost: 10 };

  it('allows change within ±10% and under daily limit', () => {
    const d = decidePriceChange({
      currentPrice: 100,
      proposedPrice: 105,
      changesToday: 0,
      costs,
    });
    expect(d.allowed).toBe(true);
    expect(d.requiresApproval).toBe(false);
  });

  it('blocks when daily limit reached', () => {
    const d = decidePriceChange({
      currentPrice: 100,
      proposedPrice: 105,
      changesToday: RULES.MAX_PRICE_CHANGE_PER_DAY,
      costs,
    });
    expect(d.allowed).toBe(false);
    expect(d.requiresApproval).toBe(true);
  });

  it('blocks when variation > 10%', () => {
    const d = decidePriceChange({
      currentPrice: 100,
      proposedPrice: 120,
      changesToday: 0,
      costs,
    });
    expect(d.allowed).toBe(false);
    expect(d.variationPercent).toBe(20);
  });
});

describe('canAutoPublish', () => {
  it('requires human approval for first publication', () => {
    const r = canAutoPublish({
      marginPercent: 45,
      opportunityScore: 80,
      confidence: 98,
      hasVerifiedSupplier: true,
      hasCriticalUnknownCost: false,
      isFirstPublication: true,
    });
    expect(r.ok).toBe(false);
  });

  it('allows when all rules pass', () => {
    const r = canAutoPublish({
      marginPercent: 42,
      opportunityScore: 70,
      confidence: 96,
      hasVerifiedSupplier: true,
      hasCriticalUnknownCost: false,
      isFirstPublication: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe('requiresHumanApproval', () => {
  it('flags critical actions', () => {
    expect(requiresHumanApproval('DELETE_PRODUCT')).toBe(true);
    expect(requiresHumanApproval('NEW_SUPPLIER')).toBe(true);
    expect(requiresHumanApproval('SEARCH_PRODUCTS')).toBe(false);
  });
});
