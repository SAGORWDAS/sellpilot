import { describe, expect, it } from 'vitest';
import { buildJsonSchema, computeCost } from '../src/lib/openai';
import { offerProfileSchema, strategySchema } from '../src/lib/schemas';

describe('buildJsonSchema', () => {
  it('makes every object strict for structured outputs', () => {
    const schema = buildJsonSchema(offerProfileSchema);
    const check = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(check);
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj['type'] === 'object') {
        expect(obj['additionalProperties']).toBe(false);
        const props = obj['properties'] as Record<string, unknown>;
        expect(obj['required']).toEqual(Object.keys(props));
      }
      expect(obj).not.toHaveProperty('$schema');
      expect(obj).not.toHaveProperty('minimum');
      Object.values(obj).forEach(check);
    };
    check(schema);
  });

  it('handles nested arrays of objects', () => {
    const schema = buildJsonSchema(strategySchema);
    expect(JSON.stringify(schema)).toContain('discoveryQueries');
  });
});

describe('computeCost', () => {
  it('uses per-model rates', () => {
    expect(computeCost('gpt-5-mini', 1_000_000, 1_000_000)).toBeCloseTo(2.25);
    expect(computeCost('gpt-5', 1_000_000, 0)).toBeCloseTo(1.25);
  });

  it('falls back to bulk rates for unknown models', () => {
    expect(computeCost('some-future-model', 1_000_000, 0)).toBeCloseTo(0.25);
  });
});