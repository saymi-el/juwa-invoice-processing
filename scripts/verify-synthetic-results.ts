import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { batchSchema } from '../src/shared/schema';
import type { Check, Invoice, InvoiceResult, NumberField, TextField } from '../src/shared/schema';

// These references are written before extraction; model output never becomes ground truth.
const caseSchema = z.object({
  fileName: z.string().min(1),
  scenario: z.string().min(1),
  invoice: z.object({
    supplier: z.string().min(1),
    invoiceNumber: z.string().min(1).nullable(),
    date: z.string().min(1).nullable(),
    currency: z.string().min(1),
    items: z.array(z.object({
      description: z.string().min(1),
      quantity: z.number().finite().nullable(),
      unitPrice: z.number().finite(),
      lineTotal: z.number().finite(),
    })),
    totalHt: z.number().finite(),
    totalTtc: z.number().finite(),
    vatRate: z.number().finite().nullable(),
    vatAmount: z.number().finite(),
  }),
  expected: z.object({
    allowedStatuses: z.array(z.enum(['ok', 'review'])).min(1),
    checks: z.array(z.object({
      code: z.string().min(1),
      field: z.string().min(1),
      status: z.enum(['pass', 'fail', 'skipped']),
      expected: z.number().finite().nullable().optional(),
      actual: z.number().finite().nullable().optional(),
      difference: z.number().finite().nullable().optional(),
    })),
    minPages: z.number().int().positive().optional(),
    pageAssertions: z.record(z.string(), z.number().int().positive()).optional(),
  }),
});
const manifestSchema = z.object({ cases: z.array(caseSchema).min(1) });
type SyntheticCase = z.infer<typeof caseSchema>;
type CaseReport = { fileName: string; scenario: string; status: 'pass' | 'fail'; errors: string[] };

const inputPath = process.argv[2] ?? 'output/synthetic-results.json';
const reportPath = process.argv[3] ?? 'output/synthetic-test-report.json';
const manifestPath = 'examples/synthetic-cases.json';

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matches(path: string, actual: string | number | null | undefined, expected: string | number | null): boolean {
  if (typeof expected !== 'string') return actual === expected;
  if (typeof actual !== 'string') return false;
  // Identifiers and normalized dates/currencies are exact values, not OCR snippets.
  if (['invoiceNumber', 'date', 'currency'].includes(path)) return actual === expected;
  const words = normalize(expected);
  if (!words) return false;
  return path.endsWith('.description')
    ? ` ${normalize(actual)} `.includes(` ${words} `)
    : normalize(actual) === words;
}

function invoiceFields(invoice: Invoice): Map<string, TextField | NumberField> {
  const entries: Array<[string, TextField | NumberField]> = [
    ['supplier', invoice.supplier], ['invoiceNumber', invoice.invoiceNumber], ['date', invoice.date],
    ['currency', invoice.currency], ['totalHt', invoice.totalHt], ['totalTtc', invoice.totalTtc],
    ['vatRate', invoice.vatRate], ['vatAmount', invoice.vatAmount],
  ];
  invoice.items.forEach((item, index) => {
    for (const key of ['description', 'quantity', 'unitPrice', 'lineTotal'] as const) {
      entries.push([`items.${index}.${key}`, item[key]]);
    }
  });
  return new Map(entries);
}

function checkKey(check: Pick<Check, 'code' | 'field'>): string {
  return `${check.code}:${check.field}`;
}

function verifyCase(reference: SyntheticCase, result: InvoiceResult): string[] {
  const errors: string[] = [];
  if (result.status === 'error' || result.invoice === null) {
    return [`échec technique : ${result.error?.code ?? 'facture absente'}`];
  }
  if (!reference.expected.allowedStatuses.includes(result.status)) {
    errors.push(`statut ${result.status}, attendu ${reference.expected.allowedStatuses.join(' ou ')}`);
  }
  const invoice = result.invoice;
  const fields = invoiceFields(invoice);
  const compare = (path: string, expected: string | number | null): void => {
    const actual = fields.get(path)?.value;
    if (!matches(path, actual, expected)) {
      errors.push(`${path} : attendu ${JSON.stringify(expected)}, reçu ${JSON.stringify(actual) ?? 'absent'}`);
    }
  };
  for (const key of ['supplier', 'invoiceNumber', 'date', 'currency', 'totalHt', 'totalTtc', 'vatRate', 'vatAmount'] as const) {
    compare(key, reference.invoice[key]);
  }
  if (invoice.items.length !== reference.invoice.items.length) {
    errors.push(`nombre de lignes : attendu ${reference.invoice.items.length}, reçu ${invoice.items.length}`);
  }
  reference.invoice.items.forEach((item, index) => {
    for (const key of ['description', 'quantity', 'unitPrice', 'lineTotal'] as const) {
      compare(`items.${index}.${key}`, item[key]);
    }
  });

  // A dropped check must not accidentally turn an incomplete result green.
  const expectedChecks = new Map<string, Check['status']>([
    ['COMPUTED_SUM_HT:totalHt', 'pass'], ['PRINTED_SUM_HT:totalHt', 'pass'],
    ['HT_TAX_TTC:totalTtc', 'pass'], ['VAT_RATE:vatAmount', 'pass'],
  ]);
  reference.invoice.items.forEach((_, index) => expectedChecks.set(`LINE_TOTAL:items.${index}.lineTotal`, 'pass'));
  const overrides = new Set<string>();
  for (const check of reference.expected.checks) {
    const key = checkKey(check);
    if (overrides.has(key)) errors.push(`référence de contrôle dupliquée : ${key}`);
    overrides.add(key);
    expectedChecks.set(key, check.status);
  }
  const actualChecks = new Map<string, Check>();
  for (const check of result.checks) {
    const key = checkKey(check);
    if (actualChecks.has(key)) errors.push(`contrôle dupliqué : ${key}`);
    actualChecks.set(key, check);
    const expectedStatus = expectedChecks.get(key) ?? 'pass';
    if (check.status !== expectedStatus) errors.push(`${key} : attendu ${expectedStatus}, reçu ${check.status}`);
  }
  for (const key of expectedChecks.keys()) {
    if (!actualChecks.has(key)) errors.push(`contrôle absent : ${key}`);
  }
  for (const expected of reference.expected.checks) {
    const key = checkKey(expected);
    const actual = actualChecks.get(key);
    if (!actual) continue;
    for (const metric of ['expected', 'actual', 'difference'] as const) {
      if (expected[metric] !== undefined && actual[metric] !== expected[metric]) {
        errors.push(`${key}.${metric} : attendu ${expected[metric]}, reçu ${actual[metric]}`);
      }
    }
  }
  if (result.pages.length < (reference.expected.minPages ?? 1)) {
    errors.push(`pages OCR : au moins ${reference.expected.minPages ?? 1} attendue(s), reçu ${result.pages.length}`);
  }
  for (const [path, page] of Object.entries(reference.expected.pageAssertions ?? {})) {
    const field = fields.get(path);
    if (!field) errors.push(`champ de provenance inconnu : ${path}`);
    else if (field.page !== page) errors.push(`${path}.page : attendu ${page}, reçu ${field.page}`);
    if (!result.pages.some((candidate) => candidate.page === page)) errors.push(`page source ${page} absente pour ${path}`);
  }
  return errors;
}

const globalErrors: string[] = [];
const cases: CaseReport[] = [];
let generatedAt: string | null = null;
try {
  if ([inputPath, manifestPath].some((path) => resolve(path) === resolve(reportPath))) {
    throw new Error('Le rapport doit avoir un chemin distinct des résultats et de la référence.');
  }
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const names = new Set(manifest.cases.map(({ fileName }) => fileName));
  if (names.size !== manifest.cases.length) throw new Error('La référence contient des noms de factures dupliqués.');
  const batch = batchSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')));
  generatedAt = batch.generatedAt;
  if (batch.mode !== 'mistral') throw new Error('Un lot de démonstration ne constitue pas un test réel de Mistral.');

  for (const result of batch.invoices) {
    if (!names.has(result.fileName)) globalErrors.push(`facture inattendue : ${result.fileName}`);
  }
  for (const reference of manifest.cases) {
    const matchingResults = batch.invoices.filter(({ fileName }) => fileName === reference.fileName);
    const result = matchingResults[0];
    const errors = matchingResults.length === 1 && result
      ? verifyCase(reference, result)
      : [`${matchingResults.length === 0 ? 'résultat absent' : 'résultats dupliqués'} : ${reference.fileName}`];
    cases.push({ fileName: reference.fileName, scenario: reference.scenario, status: errors.length ? 'fail' : 'pass', errors });
  }
} catch (error) {
  globalErrors.push(error instanceof Error ? error.message : 'Vérification impossible.');
}

const failed = cases.filter(({ status }) => status === 'fail').length;
const report = {
  inputPath, manifestPath, batchGeneratedAt: generatedAt,
  status: globalErrors.length || failed ? 'fail' : 'pass',
  counts: { total: cases.length, passed: cases.length - failed, failed, errors: globalErrors.length + cases.reduce((sum, item) => sum + item.errors.length, 0) },
  globalErrors, cases,
};
for (const item of cases) {
  console.log(`${item.status === 'pass' ? 'OK' : 'ÉCHEC'} ${item.fileName} — ${item.scenario}`);
  for (const error of item.errors) console.log(`  ${error}`);
}
for (const error of globalErrors) console.error(error);
console.log(`${report.counts.passed}/${report.counts.total} scénarios conformes ; ${report.counts.errors} écart(s).`);
try {
  if ([inputPath, manifestPath].some((path) => resolve(path) === resolve(reportPath))) throw new Error('Chemin de rapport protégé.');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Rapport : ${reportPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Impossible d’écrire le rapport.');
  process.exitCode = 1;
}
if (report.status === 'fail') process.exitCode = 1;
