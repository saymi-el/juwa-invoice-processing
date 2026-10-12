import { describe, expect, it } from 'vitest';
import type { Invoice, OcrPage } from '../src/shared/schema';
import { lineAmount, parseAmount, roundMoney, sumMoney } from '../src/domain/money';
import { validateInvoice } from '../src/domain/validate';

function sample(): { invoice: Invoice; pages: OcrPage[] } {
  const field = <T extends string | number>(value: T, evidence: string) => ({ value, page: 1, evidence });
  const invoice: Invoice = {
    supplier: field('Exemple', 'Exemple'), invoiceNumber: field('A-42', 'A-42'),
    date: field('2026-06-12', '12/06/2026'), currency: field('EUR', 'EUR'),
    items: [{ description: field('Pièce', 'Pièce'), quantity: field(2, 'Quantité 2'),
      unitPrice: field(10, 'Prix 10,00'), lineTotal: field(20, 'Ligne 20,00') }],
    totalHt: field(20, 'HT 20,00'), totalTtc: field(24, 'TTC 24,00'),
    vatRate: field(20, 'Taux 20 %'), vatAmount: field(4, 'TVA 4,00'), uncertainties: [],
  };
  return { invoice, pages: [{ page: 1,
    markdown: 'Exemple A-42 12/06/2026 EUR Pièce Quantité 2 Prix 10,00 Ligne 20,00 HT 20,00 Taux 20 % TVA 4,00 TTC 24,00' }] };
}

describe('amounts', () => {
  it.each([['1 944,00 €', 1944], ['1\u202f167,40', 1167.4], ['19,6 %', 19.6],
    ['1,167.40', 1167.4], ['1.167,40', 1167.4], ['-5,20', -5.2], ['illisible', null]])(
    'parses %s', (input, expected) => expect(parseAmount(input)).toBe(expected),
  );
  it('uses decimal half-up rounding without floating point drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(roundMoney('1.005')).toBe(1.01);
    expect(lineAmount(3, 2.675)).toBe(8.03);
  });
});

describe('provenance and business validation', () => {
  it('accepts a consistent invoice without modifying its source', () => {
    const { invoice, pages } = sample();
    const before = JSON.stringify(invoice);
    const result = validateInvoice(invoice, pages);
    expect(result.warnings).toEqual([]);
    expect(result.checks.every((check) => check.status === 'pass')).toBe(true);
    expect(JSON.stringify(invoice)).toBe(before);
  });
  it('rejects invented evidence, page numbers and unsupported numbers', () => {
    const { invoice, pages } = sample();
    invoice.supplier.evidence = 'Autre fournisseur';
    invoice.invoiceNumber.page = 2;
    invoice.totalTtc.value = 99;
    const result = validateInvoice(invoice, pages);
    expect(result.invoice.supplier.value).toBeNull();
    expect(result.invoice.invoiceNumber.value).toBeNull();
    expect(result.invoice.totalTtc.value).toBeNull();
    expect(result.checks.find((check) => check.code === 'HT_TAX_TTC')?.status).toBe('skipped');
  });
  it.each(['3.753,60 €', '3,753.60 EUR', '3\u202f753,60 €'])('keeps a correctly sourced amount formatted as %s', (evidence) => {
    const { invoice, pages } = sample();
    invoice.totalHt = { value: 3753.6, page: 1, evidence };
    pages[0]!.markdown += ` ${evidence}`;
    const result = validateInvoice(invoice, pages);
    expect(result.invoice.totalHt.value).toBe(3753.6);
    expect(result.warnings.some((warning) => warning.code === 'UNSUPPORTED_NUMBER')).toBe(false);
  });
  it('rejects invented text even when its evidence exists', () => {
    const { invoice, pages } = sample();
    invoice.supplier.value = 'Fournisseur inventé';
    invoice.invoiceNumber.value = 'A-999';
    invoice.items[0]!.description.value = 'Produit inventé';
    const result = validateInvoice(invoice, pages);
    expect(result.invoice.supplier.value).toBeNull();
    expect(result.invoice.invoiceNumber.value).toBeNull();
    expect(result.invoice.items[0]!.description.value).toBeNull();
    expect(result.warnings.filter((warning) => warning.code === 'UNSUPPORTED_TEXT')).toHaveLength(3);
  });
  it('normalizes accents, case, punctuation and whitespace when checking text values', () => {
    const { invoice, pages } = sample();
    invoice.supplier = { value: 'Méca-Précision', page: 1, evidence: 'MECA   PRECISION' };
    invoice.items[0]!.description.value = 'piece';
    invoice.invoiceNumber.value = 'a 42';
    pages[0]!.markdown += ' MECA   PRECISION';
    const result = validateInvoice(invoice, pages);
    expect(result.invoice.supplier.value).toBe('Méca-Précision');
    expect(result.warnings).toEqual([]);
  });
  it('rejects a valid calendar date that is not supported by its evidence', () => {
    const { invoice, pages } = sample();
    invoice.date.value = '2025-01-01';
    const result = validateInvoice(invoice, pages);
    expect(result.invoice.date.value).toBeNull();
    expect(result.warnings.some((warning) => warning.code === 'UNSUPPORTED_DATE')).toBe(true);
  });
  it.each([
    ['2026-06-12', '2026-06-12'], ['12/06/2026', '2026-06-12'], ['12/06/09', '2009-06-12'],
    ['12/06/69', '2069-06-12'], ['12/06/70', '1970-06-12'],
    ['12 juin 2026', '2026-06-12'], ['1er février 2009', '2009-02-01'], ['12 févr. 2009', '2009-02-12'],
  ])('matches supported date format %s', (evidence, value) => {
    const { invoice, pages } = sample();
    invoice.date = { value, page: 1, evidence };
    pages[0]!.markdown += ` ${evidence}`;
    expect(validateInvoice(invoice, pages).invoice.date.value).toBe(value);
  });
  it('marks an unrecognized date format as uncertain instead of assuming the model is right', () => {
    const { invoice, pages } = sample();
    invoice.date.evidence = 'June 12th, 2026';
    pages[0]!.markdown += ' June 12th, 2026';
    const result = validateInvoice(invoice, pages);
    expect(result.invoice.date.value).toBeNull();
    expect(result.warnings.find((warning) => warning.code === 'UNSUPPORTED_DATE')?.message).toContain('format non reconnu');
  });
  it.each([
    ['EUR', '€', true], ['EUR', 'EUR', true], ['USD', '$', false], ['USD', 'USD', true],
    ['USD', 'US$', true], ['GBP', '£', true], ['GBP', 'GBP', true], ['USD', 'EUR', false],
  ])('requires unambiguous support for currency %s from %s', (value, evidence, accepted) => {
    const { invoice, pages } = sample();
    invoice.currency = { value, page: 1, evidence };
    pages[0]!.markdown += ` ${evidence}`;
    expect(validateInvoice(invoice, pages).invoice.currency.value).toBe(accepted ? value : null);
  });
  it('never turns an unknown quantity into zero or a successful sum check', () => {
    const { invoice, pages } = sample();
    invoice.items[0]!.quantity.value = null;
    const result = validateInvoice(invoice, pages);
    expect(result.checks.find((check) => check.code === 'COMPUTED_SUM_HT')?.status).toBe('skipped');
    expect(result.warnings.some((warning) => warning.field === 'items.0.quantity')).toBe(true);
  });
  it('honors explicitly uncertain fields even if the model also returned a value', () => {
    const { invoice, pages } = sample();
    invoice.uncertainties = [{ field: 'items.0.quantity', message: 'Quantité masquée.' }];
    expect(validateInvoice(invoice, pages).invoice.items[0]!.quantity.value).toBeNull();
  });
  it('preserves printed inconsistencies and reports both line and total discrepancies', () => {
    const { invoice, pages } = sample();
    invoice.items[0]!.quantity.value = 4;
    invoice.items[0]!.quantity.evidence = 'Quantité 4';
    pages[0]!.markdown = pages[0]!.markdown.replace('Quantité 2', 'Quantité 4');
    const result = validateInvoice(invoice, pages);
    expect(result.invoice.items[0]!.lineTotal.value).toBe(20);
    expect(result.checks.find((check) => check.code === 'LINE_TOTAL')?.difference).toBe(-20);
    expect(result.checks.find((check) => check.code === 'COMPUTED_SUM_HT')?.status).toBe('fail');
    expect(result.checks.find((check) => check.code === 'HT_TAX_TTC')?.status).toBe('pass');
  });
  it('supports historical VAT rates and one-cent rounding tolerance', () => {
    const { invoice, pages } = sample();
    invoice.totalHt = { value: 338.95, page: 1, evidence: '338,95' };
    invoice.vatRate = { value: 19.6, page: 1, evidence: '19,6' };
    invoice.vatAmount = { value: 66.43, page: 1, evidence: '66,43' };
    invoice.totalTtc = { value: 405.38, page: 1, evidence: '405,38' };
    pages[0]!.markdown += ' 338,95 19,6 66,43 405,38';
    const result = validateInvoice(invoice, pages);
    expect(result.checks.find((check) => check.code === 'VAT_RATE')?.status).toBe('pass');
    expect(result.checks.find((check) => check.code === 'HT_TAX_TTC')?.status).toBe('pass');
  });
  it('rejects impossible calendar dates and warns about corrupted OCR', () => {
    const { invoice, pages } = sample();
    invoice.date.value = '2026-02-30';
    pages[0]!.markdown += ' Ã©mission';
    const result = validateInvoice(invoice, pages);
    expect(result.invoice.date.value).toBeNull();
    expect(result.warnings.some((warning) => warning.code === 'INVALID_DATE')).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'OCR_ENCODING')).toBe(true);
  });
  it('reports empty line extraction without claiming a valid zero total', () => {
    const { invoice, pages } = sample();
    invoice.items = [];
    const result = validateInvoice(invoice, pages);
    expect(result.warnings.some((warning) => warning.code === 'NO_ITEMS')).toBe(true);
    expect(result.checks.find((check) => check.code === 'COMPUTED_SUM_HT')?.status).toBe('skipped');
  });
});
