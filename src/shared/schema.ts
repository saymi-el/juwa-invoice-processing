import { z } from 'zod';

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
});
export const resultSchema = z.strictObject({
  id: z.string(), fileName: z.string(), sha256: z.string(), durationMs: z.number().nonnegative(),
  status: z.enum(['ok', 'review', 'error']),
  pages: z.array(pageSchema), invoice: invoiceSchema.nullable(),
  warnings: z.array(warningSchema), checks: z.array(checkSchema),
  error: z.strictObject({
    stage: z.enum(['file', 'ocr', 'llm', 'schema', 'unknown']), code: z.string(), message: z.string(),
  }).nullable(),
});
export const batchSchema = z.strictObject({
  schemaVersion: z.literal(1), generatedAt: z.iso.datetime(),
  mode: z.enum(['mistral', 'demo']),
  models: z.strictObject({ ocr: z.string(), chat: z.string() }),
  invoices: z.array(resultSchema),
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
