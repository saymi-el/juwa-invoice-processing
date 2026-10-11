import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineError, type MistralClient } from '../src/pipeline/api';
import { runBatch } from '../src/pipeline/runner';
import { batchSchema, type Invoice } from '../src/shared/schema';

const field = <T extends string | number>(value: T) => ({ value, page: 1, evidence: String(value) });
const invoice: Invoice = {
  supplier: field('Fournisseur test'), invoiceNumber: field('TEST-001'), date: field('2026-10-12'), currency: field('EUR'),
  items: [{ description: field('Pièce'), quantity: field(2), unitPrice: field(10), lineTotal: field(20) }],
  totalHt: field(20), totalTtc: field(24), vatRate: field(20), vatAmount: field(4), uncertainties: [],
};
const pages = [{ page: 1, markdown: 'Fournisseur test TEST-001 2026-10-12 EUR Pièce 2 10 20 24 4' }];
const models = { ocr: 'test-ocr', chat: 'test-chat' };
let inputDir: string;

beforeEach(async () => { inputDir = await mkdtemp(join(tmpdir(), 'juwa-pipeline-')); });
afterEach(async () => { await rm(inputDir, { recursive: true, force: true }); });
async function addPdf(name: string, content = '%PDF-1.4 mock'): Promise<void> {
  await writeFile(join(inputDir, name), content);
}
function mockClient(): MistralClient {
  return { ocr: vi.fn(async () => pages), extract: vi.fn(async () => structuredClone(invoice)) };
}

describe('batch pipeline', () => {
  it('keeps a valid PDF, an invalid file and an API failure as independent results', async () => {
    await addPdf('01-valid.pdf');
    await addPdf('02-broken.pdf', 'not a PDF');
    await addPdf('03-api-failure.pdf');
    const client = mockClient();
    vi.mocked(client.ocr).mockResolvedValueOnce(pages)
      .mockRejectedValueOnce(new PipelineError('HTTP_429', 'Limite de débit atteinte.'));
    const result = await runBatch({ inputDir, client, models });
    expect(batchSchema.safeParse(result).success).toBe(true);
    expect(result.invoices.map(({ status }) => status)).toEqual(['ok', 'error', 'error']);
    expect(result.invoices[1]?.error).toMatchObject({ stage: 'file', code: 'INVALID_PDF' });
    expect(result.invoices[2]?.error).toMatchObject({ stage: 'ocr', code: 'HTTP_429' });
    expect(client.extract).toHaveBeenCalledTimes(1);
    expect(result.invoices[0]?.sha256).toHaveLength(64);
  });

  it('preserves OCR when the LLM JSON does not match the schema and continues', async () => {
    await addPdf('01-invalid-schema.pdf');
    await addPdf('02-valid.pdf');
    const client = mockClient();
    vi.mocked(client.extract).mockResolvedValueOnce({ supplier: 123 });
    const result = await runBatch({ inputDir, client, models });
    expect(result.invoices[0]).toMatchObject({ status: 'error', pages, invoice: null,
      error: { stage: 'schema', code: 'INVALID_INVOICE_SCHEMA' } });
    expect(result.invoices[1]?.status).toBe('ok');
  });

  it('marks a readable arithmetic discrepancy for review without changing the printed amount', async () => {
    await addPdf('inconsistent.pdf');
    const client = mockClient();
    const inconsistent = structuredClone(invoice);
    inconsistent.items[0]!.lineTotal = field(21);
    vi.mocked(client.extract).mockResolvedValue(inconsistent);
    vi.mocked(client.ocr).mockResolvedValue([{ page: 1, markdown: `${pages[0]!.markdown} 21` }]);
    const result = await runBatch({ inputDir, client, models });
    expect(result.invoices[0]?.status).toBe('review');
    expect(result.invoices[0]?.invoice?.items[0]?.lineTotal.value).toBe(21);
    expect(result.invoices[0]?.checks.some(({ status }) => status === 'fail')).toBe(true);
  });

  it('records empty OCR without calling extraction', async () => {
    await addPdf('empty.pdf');
    const client = mockClient();
    vi.mocked(client.ocr).mockResolvedValue([{ page: 1, markdown: '' }]);
    const result = await runBatch({ inputDir, client, models });
    expect(result.invoices[0]?.error).toMatchObject({ stage: 'ocr', code: 'EMPTY_OCR' });
    expect(client.extract).not.toHaveBeenCalled();
  });

  it('does not expose unexpected exception messages in saved results', async () => {
    await addPdf('failure.pdf');
    const client = mockClient();
    vi.mocked(client.extract).mockRejectedValue(new Error('secret-api-key'));
    const result = await runBatch({ inputDir, client, models });
    expect(JSON.stringify(result)).not.toContain('secret-api-key');
    expect(result.invoices[0]?.pages).toEqual(pages);
  });

  it('rejects a folder with no PDFs instead of creating a misleading successful empty batch', async () => {
    await writeFile(join(inputDir, 'readme.txt'), 'test');
    await expect(runBatch({ inputDir, client: mockClient(), models })).rejects.toThrow('aucun fichier PDF');
  });
});
