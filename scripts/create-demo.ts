import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { validateInvoice } from '../src/domain/validate';
import { batchSchema, type Invoice, type InvoiceResult } from '../src/shared/schema';

const referenceSchema = z.array(z.object({
  fileName: z.string(), supplier: z.string(), invoiceNumber: z.string(), date: z.string(),
  items: z.array(z.object({ description: z.string(), quantity: z.number(), unitPrice: z.number(), lineTotal: z.number() })),
  totalHt: z.number(), totalTtc: z.number(), vatRate: z.number(), vatAmount: z.number(),
}));
const references = referenceSchema.parse(JSON.parse(await readFile(
  new URL('../examples/reference-inputs.json', import.meta.url), 'utf8',
)));

const invoices: InvoiceResult[] = references.map((reference) => {
  const excerpts: string[] = ['DÉMONSTRATION : transcription manuelle de référence, sans OCR ni appel Mistral.'];
  const text = (value: string, excerpt = value) => {
    excerpts.push(excerpt);
    return { value, page: 1, evidence: excerpt };
  };
  const number = (value: number, label: string) => {
    const excerpt = `${label} : ${value.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}`;
    excerpts.push(excerpt);
    return { value, page: 1, evidence: excerpt };
  };
  const invoice: Invoice = {
    supplier: text(reference.supplier), invoiceNumber: text(reference.invoiceNumber),
    date: text(reference.date, reference.date.split('-').reverse().join('/')), currency: text('EUR'),
    items: reference.items.map((item, index) => ({
      description: text(item.description), quantity: number(item.quantity, `Quantité ligne ${index + 1}`),
      unitPrice: number(item.unitPrice, `Prix ligne ${index + 1}`), lineTotal: number(item.lineTotal, `Montant ligne ${index + 1}`),
    })),
    totalHt: number(reference.totalHt, 'Total HT'), totalTtc: number(reference.totalTtc, 'Total TTC'),
    vatRate: number(reference.vatRate, 'Taux TVA'), vatAmount: number(reference.vatAmount, 'TVA'), uncertainties: [],
  };
  const pages = [{ page: 1, markdown: excerpts.join('\n') }];
  const checked = validateInvoice(invoice, pages);
  return {
    id: createHash('sha256').update(reference.fileName).digest('hex').slice(0, 16),
    fileName: reference.fileName, sha256: '', durationMs: 0, pages, ...checked,
    status: checked.warnings.length > 0 ? 'review' : 'ok', error: null,
  };
});
const batch = batchSchema.parse({
  schemaVersion: 1, generatedAt: new Date().toISOString(), mode: 'demo',
  models: { ocr: 'aucun', chat: 'aucun' }, invoices,
});
const publicDir = new URL('../public/', import.meta.url);
await mkdir(publicDir, { recursive: true });
// Keep the default import available without replacing any genuine extraction.
const output = new URL('demo.json', publicDir);
await writeFile(output, `${JSON.stringify(batch, null, 2)}\n`);
console.log(`Démonstration créée : ${fileURLToPath(output)} (référence manuelle, aucun appel IA).`);
