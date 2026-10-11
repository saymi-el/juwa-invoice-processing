import { describe, expect, it } from 'vitest';
import { invoiceJsonSchema, invoiceSchema, numberFieldSchema, textFieldSchema } from '../src/shared/schema';

describe('typed extraction contract', () => {
  it('accepts an explicit unknown but rejects a missing value', () => {
    expect(textFieldSchema.safeParse({ value: null, page: null, evidence: null }).success).toBe(true);
    expect(textFieldSchema.safeParse({ page: null, evidence: null }).success).toBe(false);
  });
  it('rejects numeric strings, nonfinite amounts and extra properties', () => {
    const provenance = { page: 1, evidence: '10,00 €' };
    for (const value of ['10,00', Infinity, NaN]) {
      expect(numberFieldSchema.safeParse({ value, ...provenance }).success).toBe(false);
    }
    expect(numberFieldSchema.safeParse({ value: 10, ...provenance, confidence: 1 }).success).toBe(false);
  });
  it('requires one-based page numbers when supplied', () => {
    expect(textFieldSchema.safeParse({ value: 'ACME', page: 0, evidence: 'ACME' }).success).toBe(false);
  });
  it('shares the same required schema with the model', () => {
    expect(invoiceJsonSchema.type).toBe('object');
    expect(invoiceJsonSchema.additionalProperties).toBe(false);
    expect(invoiceJsonSchema.required).toContain('totalTtc');
    expect(invoiceSchema.safeParse({ supplier: 'ACME' }).success).toBe(false);
  });
});
