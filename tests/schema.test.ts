import { describe, expect, it } from 'vitest';
import { batchSchema, checkSchema, invoiceJsonSchema, invoiceSchema, numberFieldSchema, resultSchema, textFieldSchema,
  type Batch, type Check, type InvoiceResult } from '../src/shared/schema';

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

function validResult(): InvoiceResult {
  const field = <T extends string | number>(value: T) => ({ value, page: 1, evidence: String(value) });
  return {
    id: 'invoice-1', fileName: 'invoice.pdf', sha256: '', durationMs: 10, status: 'ok',
    pages: [{ page: 1, markdown: 'ACME F-1 2026-10-12 EUR Pièce 1 10 12 20 2' }],
    invoice: {
      supplier: field('ACME'), invoiceNumber: field('F-1'), date: field('2026-10-12'), currency: field('EUR'),
      items: [{ description: field('Pièce'), quantity: field(1), unitPrice: field(10), lineTotal: field(10) }],
      totalHt: field(10), totalTtc: field(12), vatRate: field(20), vatAmount: field(2), uncertainties: [],
    },
    warnings: [], checks: [{ code: 'HT_TAX_TTC', field: 'totalTtc', label: 'HT + TVA / TTC',
      status: 'pass', expected: 12, actual: 12, difference: 0, message: 'Les montants concordent.' }], error: null,
  };
}
const failure = { stage: 'ocr' as const, code: 'EMPTY_OCR', message: 'Aucun texte OCR disponible.' };

describe('imported result invariants', () => {
  it('accepts a successful result and an OCR failure that preserves its pages', () => {
    expect(resultSchema.safeParse(validResult()).success).toBe(true);
    expect(resultSchema.safeParse({ ...validResult(), status: 'error', invoice: null, error: failure, checks: [] }).success).toBe(true);
  });

  it.each([
    { invoice: null }, { error: failure }, { checks: [] }, { pages: [] },
    { warnings: [{ code: 'WARNING', field: 'supplier', message: 'À vérifier', source: 'validation', page: 1 }] },
    { status: 'review' },
  ])('rejects a contradictory success or unjustified review: %j', (change) => {
    expect(resultSchema.safeParse({ ...validResult(), ...change }).success).toBe(false);
  });

  it('does not label a missing essential field as successful even if warnings were removed', () => {
    const result = validResult();
    result.invoice!.supplier.value = null;
    expect(resultSchema.safeParse(result).success).toBe(false);
    result.status = 'review';
    expect(resultSchema.safeParse(result).success).toBe(true);
  });

  it('requires failed and skipped checks to yield review, preserving the checked figures', () => {
    for (const check of [
      { status: 'fail', expected: 12, actual: 15, difference: 3 },
      { status: 'skipped', expected: null, actual: 12, difference: null },
    ] as const) {
      const result = validResult();
      result.checks[0] = { ...result.checks[0]!, ...check };
      expect(resultSchema.safeParse(result).success).toBe(false);
      result.status = 'review';
      expect(resultSchema.safeParse(result).success).toBe(true);
    }
  });

  it('rejects failures without diagnostics or with supposedly validated data', () => {
    const result = { ...validResult(), status: 'error', invoice: null, checks: [] };
    expect(resultSchema.safeParse(result).success).toBe(false);
    expect(resultSchema.safeParse({ ...result, error: failure, invoice: validResult().invoice }).success).toBe(false);
    expect(resultSchema.safeParse({ ...result, error: failure, checks: validResult().checks }).success).toBe(false);
  });

  it.each([
    { status: 'pass', expected: null }, { status: 'fail', difference: null },
    { status: 'pass', difference: 3 }, { status: 'fail', difference: 0.01 },
    { status: 'skipped', difference: 0 }, { status: 'skipped', difference: null },
  ])('rejects internally contradictory check metadata: %j', (change) => {
    const check: Check = validResult().checks[0]!;
    expect(checkSchema.safeParse({ ...check, ...change }).success).toBe(false);
  });

  it('recomputes imported differences rather than trusting a claimed successful check', () => {
    const check = validResult().checks[0]!;
    expect(checkSchema.safeParse({ ...check, expected: 100, actual: 999, difference: 0, status: 'pass' }).success).toBe(false);
    expect(checkSchema.safeParse({ ...check, expected: 100, actual: 999, difference: 899, status: 'fail' }).success).toBe(true);
    // Decimal half-up must match the pipeline for both signs at a rounding boundary.
    expect(checkSchema.safeParse({ ...check, expected: 1, actual: 1.005, difference: 0.01, status: 'pass' }).success).toBe(true);
    expect(checkSchema.safeParse({ ...check, expected: 1.005, actual: 1, difference: -0.01, status: 'pass' }).success).toBe(true);
  });

  it('rejects duplicated OCR page numbers and duplicated result ids', () => {
    const result = validResult();
    result.pages.push(result.pages[0]!);
    expect(resultSchema.safeParse(result).success).toBe(false);
    const batch: Batch = { schemaVersion: 1, generatedAt: '2026-10-12T09:00:00.000Z', mode: 'demo',
      models: { ocr: 'aucun', chat: 'aucun' }, invoices: [validResult(), validResult()] };
    expect(batchSchema.safeParse(batch).success).toBe(false);
    batch.invoices[1]!.id = 'invoice-2';
    expect(batchSchema.safeParse(batch).success).toBe(true);
  });
});
