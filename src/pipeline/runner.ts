import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateInvoice } from '../domain/validate';
import { batchSchema, invoiceSchema, type Batch, type InvoiceResult, type OcrPage } from '../shared/schema';
import { PipelineError, type MistralClient } from './api';

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
type RunOptions = {
  inputDir: string;
  client: MistralClient;
  models: Batch['models'];
  onProgress?: (result: InvoiceResult, index: number, total: number) => void;
};

async function processFile(filePath: string, fileName: string, client: MistralClient): Promise<InvoiceResult> {
  const startedAt = Date.now();
  let stage: NonNullable<InvoiceResult['error']>['stage'] = 'file';
  let pages: OcrPage[] = [];
  let sha256 = '';
  // Use the full file name in the id as well: identical PDFs remain distinct batch entries.
  const id = createHash('sha256').update(fileName).digest('hex').slice(0, 16);
  try {
    if ((await stat(filePath)).size > MAX_PDF_BYTES) {
      throw new PipelineError('PDF_TOO_LARGE', 'Le PDF dépasse la limite de 20 Mo.');
    }
    const pdf = await readFile(filePath);
    sha256 = createHash('sha256').update(pdf).digest('hex');
    if (!pdf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      throw new PipelineError('INVALID_PDF', 'Le fichier ne contient pas de signature PDF.');
    }
    stage = 'ocr';
    pages = await client.ocr(pdf);
    if (!pages.some(({ markdown }) => markdown.trim())) {
      throw new PipelineError('EMPTY_OCR', 'L’OCR n’a détecté aucun texte exploitable.');
    }
    stage = 'llm';
    const extracted = await client.extract(pages);
    stage = 'schema';
    const parsed = invoiceSchema.safeParse(extracted);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(racine)'))].slice(0, 8);
      throw new PipelineError('INVALID_INVOICE_SCHEMA', `Le JSON ne respecte pas le schéma de facture. Champs : ${fields.join(', ')}.`);
    }
    stage = 'unknown';
    const checked = validateInvoice(parsed.data, pages);
    return {
      id, fileName, sha256, durationMs: Date.now() - startedAt,
      status: checked.warnings.length > 0 || checked.checks.some(({ status }) => status !== 'pass') ? 'review' : 'ok',
      pages, ...checked, error: null,
    };
  } catch (error) {
    return {
      id, fileName, sha256, durationMs: Date.now() - startedAt, status: 'error', pages,
      invoice: null, warnings: [], checks: [],
      error: {
        stage,
        code: error instanceof PipelineError ? error.code : stage === 'file' ? 'FILE_READ_ERROR' : 'PROCESSING_ERROR',
        message: error instanceof PipelineError ? error.message : stage === 'file'
          ? 'Impossible de lire ce fichier. Vérifiez ses permissions.'
          : 'Le traitement a échoué à cette étape. Les autres factures restent traitées.',
      },
    };
  }
}

export async function runBatch({ inputDir, client, models, onProgress }: RunOptions): Promise<Batch> {
  let files: string[];
  try {
    files = (await readdir(inputDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
      .map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  } catch {
    throw new Error('Impossible de lire le dossier d’entrée. Vérifiez le chemin et les permissions.');
  }
  if (files.length === 0) throw new Error('Le dossier d’entrée ne contient aucun fichier PDF.');
  const invoices: InvoiceResult[] = [];
  // Sequential by design: small batches and limited Experiment API rate limits.
  for (const [index, fileName] of files.entries()) {
    const result = await processFile(join(inputDir, fileName), fileName, client);
    invoices.push(result);
    onProgress?.(result, index + 1, files.length);
  }
  return batchSchema.parse({ schemaVersion: 1, generatedAt: new Date().toISOString(), mode: 'mistral', models, invoices });
}
