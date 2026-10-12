import { z } from 'zod';
import Decimal from 'decimal.js';

// Evidence is a short verbatim OCR excerpt; pages are one-based everywhere in our app.
const evidence = {
  page: z.number().int().positive().nullable(),
  evidence: z.string().min(1).nullable(),
};
export const textFieldSchema = z.strictObject({ value: z.string().min(1).nullable(), ...evidence });
export const numberFieldSchema = z.strictObject({
  value: z.number().finite().min(-1_000_000_000).max(1_000_000_000).nullable(), ...evidence,
});
export const invoiceSchema = z.strictObject({
  supplier: textFieldSchema,
  invoiceNumber: textFieldSchema,
  date: textFieldSchema.describe('Invoice date normalized as YYYY-MM-DD, or null; never the due/payment date.'),
  currency: textFieldSchema.describe('ISO currency code only when explicitly supported by the document.'),
  items: z.array(z.strictObject({
    description: textFieldSchema,
    quantity: numberFieldSchema,
    unitPrice: numberFieldSchema,
    lineTotal: numberFieldSchema.describe('Printed net line amount; never recompute or repair it.'),
  })).max(1000),
  totalHt: numberFieldSchema,
  totalTtc: numberFieldSchema,
  vatRate: numberFieldSchema.describe('Single VAT percentage if explicit; null if missing or multiple rates.'),
  vatAmount: numberFieldSchema,
  uncertainties: z.array(z.strictObject({ field: z.string().min(1), message: z.string().min(1) })),
});

export const pageSchema = z.strictObject({ page: z.number().int().positive(), markdown: z.string() });
export const warningSchema = z.strictObject({
  code: z.string(), field: z.string(), message: z.string(),
  source: z.enum(['extraction', 'validation', 'business']),
  page: z.number().int().positive().nullable(),
});
export const checkSchema = z.strictObject({
  code: z.string(), field: z.string(), label: z.string(),
  status: z.enum(['pass', 'fail', 'skipped']),
  expected: z.number().finite().nullable(), actual: z.number().finite().nullable(),
  difference: z.number().finite().nullable(), message: z.string(),
}).superRefine((check, context) => {
  const unavailable = check.expected === null || check.actual === null;
  if (check.status === 'skipped') {
    if (!unavailable || check.difference !== null) {
      context.addIssue({ code: 'custom', path: ['status'], message: 'Un contrôle non vérifiable exige une donnée absente et un écart nul.' });
    }
  } else if (unavailable || check.difference === null) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Un contrôle évalué exige deux montants et un écart.' });
  } else {
    // Match the domain's decimal half-up rounding; imported metadata is not trusted.
    const computedDifference = new Decimal(check.actual!).minus(check.expected!)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    if (check.difference !== computedDifference) {
      context.addIssue({ code: 'custom', path: ['difference'], message: 'L’écart doit correspondre au montant lu moins le montant attendu, arrondi au centime.' });
    }
    if ((Math.abs(check.difference) <= 0.01) !== (check.status === 'pass')) {
      context.addIssue({ code: 'custom', path: ['status'], message: 'Le statut du contrôle contredit son écart et la tolérance d’un centime.' });
    }
  }
});
export const resultSchema = z.strictObject({
  id: z.string().min(1), fileName: z.string().min(1), sha256: z.string(), durationMs: z.number().nonnegative(),
  status: z.enum(['ok', 'review', 'error']),
  pages: z.array(pageSchema), invoice: invoiceSchema.nullable(),
  warnings: z.array(warningSchema), checks: z.array(checkSchema),
  error: z.strictObject({
    stage: z.enum(['file', 'ocr', 'llm', 'schema', 'unknown']), code: z.string(), message: z.string(),
  }).nullable(),
}).superRefine((result, context) => {
  const issue = (path: string, message: string): void => {
    context.addIssue({ code: 'custom', path: [path], message });
  };
  if (new Set(result.pages.map(({ page }) => page)).size !== result.pages.length) {
    issue('pages', 'Les numéros des pages OCR doivent être uniques.');
  }
  if (result.status === 'error') {
    if (result.error === null) issue('error', 'Un échec doit contenir son diagnostic.');
    if (result.invoice !== null) issue('invoice', 'Un échec technique ne peut pas contenir une facture validée.');
    if (result.checks.length > 0) issue('checks', 'Un échec sans facture validée ne peut pas contenir de contrôles métier.');
    return;
  }
  if (result.error !== null) issue('error', 'Une facture traitée ne peut pas avoir un diagnostic d’échec.');
  if (result.invoice === null) {
    issue('invoice', 'Une facture traitée doit contenir les données validées.');
    return;
  }
  if (!result.pages.some(({ markdown }) => markdown.trim())) issue('pages', 'Une facture traitée doit conserver son texte source.');
  if (result.checks.length === 0) issue('checks', 'Une facture traitée doit contenir ses contrôles métier.');
  const invoice = result.invoice;
  const required = [invoice.supplier, invoice.invoiceNumber, invoice.date, invoice.currency, invoice.totalHt, invoice.totalTtc,
    ...invoice.items.flatMap((item) => [item.description, item.quantity, item.unitPrice])];
  const needsReview = result.warnings.length > 0 || result.checks.some(({ status }) => status !== 'pass')
    || invoice.uncertainties.length > 0 || invoice.items.length === 0 || required.some(({ value }) => value === null);
  if (needsReview !== (result.status === 'review')) {
    issue('status', 'Le statut doit refléter les avertissements, données manquantes et contrôles de cette facture.');
  }
});
export const batchSchema = z.strictObject({
  schemaVersion: z.literal(1), generatedAt: z.iso.datetime(),
  mode: z.enum(['mistral', 'demo']),
  models: z.strictObject({ ocr: z.string(), chat: z.string() }),
  invoices: z.array(resultSchema),
}).superRefine((batch, context) => {
  const ids = new Set<string>();
  batch.invoices.forEach((invoice, index) => {
    if (ids.has(invoice.id)) {
      context.addIssue({ code: 'custom', path: ['invoices', index, 'id'], message: 'Les identifiants de factures doivent être uniques dans un lot.' });
    }
    ids.add(invoice.id);
  });
});

export type TextField = z.infer<typeof textFieldSchema>;
export type NumberField = z.infer<typeof numberFieldSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type OcrPage = z.infer<typeof pageSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type Check = z.infer<typeof checkSchema>;
export type InvoiceResult = z.infer<typeof resultSchema>;
export type Batch = z.infer<typeof batchSchema>;

export const invoiceJsonSchema = z.toJSONSchema(invoiceSchema);
