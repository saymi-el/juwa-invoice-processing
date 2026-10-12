import { z } from 'zod';
import { invoiceJsonSchema, type OcrPage } from '../shared/schema';
import type { MistralConfig } from './config';
import { documentPrompt, SYSTEM_PROMPT } from './prompt';

export interface MistralClient {
  ocr(pdf: Buffer): Promise<OcrPage[]>;
  extract(pages: OcrPage[]): Promise<unknown>;
}

export class PipelineError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PipelineError';
  }
}

const ocrEnvelope = z.object({
  pages: z.array(z.object({ index: z.number().int().nonnegative(), markdown: z.string() })),
});
const chatEnvelope = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable(),
    message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
  })).min(1),
});

type ClientOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 10_000;

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  const seconds = header === null ? NaN : Number(header);
  const fromHeader = Number.isFinite(seconds)
    ? seconds * 1000
    : header === null ? NaN : Date.parse(header) - Date.now();
  return Number.isFinite(fromHeader)
    ? Math.max(0, Math.min(MAX_RETRY_DELAY_MS, fromHeader))
    : Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt);
}

export function createMistralClient(config: MistralConfig, options: ClientOptions = {}): MistralClient {
  const request = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function post(endpoint: string, body: unknown): Promise<unknown> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await request(`https://api.mistral.ai/v1/${endpoint}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
          redirect: 'error',
        });
      } catch {
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new PipelineError('NETWORK_ERROR', 'Mistral est injoignable ou le délai a expiré après trois tentatives.');
      }
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        // Do not retain the provider's error body: it can echo request data or credentials.
        await response.body?.cancel();
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        const message = response.status === 401 || response.status === 403
          ? 'Accès Mistral refusé. Vérifiez la clé et les droits du compte.'
          : response.status === 429
            ? 'Mistral refuse les appels après trois tentatives (HTTP 429). Vérifiez le quota et l’accès API du compte, puis réessayez.'
            : `La requête Mistral a échoué (HTTP ${response.status}).`;
        throw new PipelineError(`HTTP_${response.status}`, message);
      }
      try {
        return await response.json();
      } catch {
        throw new PipelineError('INVALID_API_JSON', 'Mistral a renvoyé une réponse qui ne contient pas de JSON valide.');
      }
    }
    throw new PipelineError('NETWORK_ERROR', 'La requête Mistral a échoué.');
  }

  return {
    async ocr(pdf) {
      const payload = await post('ocr', {
        model: config.models.ocr,
        document: { type: 'document_url', document_url: `data:application/pdf;base64,${pdf.toString('base64')}` },
        include_image_base64: false,
      });
      const result = ocrEnvelope.safeParse(payload);
      if (!result.success) throw new PipelineError('INVALID_OCR_RESPONSE', 'La réponse OCR ne contient pas les pages attendues.');
      const pages = result.data.pages.map(({ index, markdown }) => ({ page: index + 1, markdown }));
      if (!pages.some(({ markdown }) => markdown.trim())) {
        throw new PipelineError('EMPTY_OCR', 'L’OCR n’a détecté aucun texte exploitable.');
      }
      if (new Set(pages.map(({ page }) => page)).size !== pages.length) {
        throw new PipelineError('INVALID_OCR_PAGES', 'Les numéros de page OCR sont dupliqués.');
      }
      return pages.sort((a, b) => a.page - b.page);
    },
    async extract(pages) {
      if (pages.reduce((size, page) => size + page.markdown.length, 0) > 100_000) {
        throw new PipelineError('OCR_TOO_LONG', 'Le texte OCR dépasse 100 000 caractères. Découpez le document avant de réessayer.');
      }
      const payload = await post('chat/completions', {
        model: config.models.chat,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: documentPrompt(pages) },
        ],
        temperature: 0,
        max_tokens: 16_384,
        response_format: { type: 'json_schema', json_schema: { name: 'invoice', schema: invoiceJsonSchema, strict: true } },
      });
      const result = chatEnvelope.safeParse(payload);
      if (!result.success) throw new PipelineError('INVALID_LLM_RESPONSE', 'La réponse du modèle ne contient pas le message attendu.');
      const choice = result.data.choices[0]!;
      if (choice.message.refusal || choice.finish_reason !== 'stop') {
        throw new PipelineError('INCOMPLETE_LLM_RESPONSE', 'La génération a été interrompue, tronquée ou refusée. Aucun JSON partiel n’a été accepté.');
      }
      if (!choice.message.content) throw new PipelineError('EMPTY_LLM_RESPONSE', 'Le modèle n’a renvoyé aucun contenu.');
      try {
        return JSON.parse(choice.message.content) as unknown;
      } catch {
        throw new PipelineError('INVALID_LLM_JSON', 'Le modèle n’a pas produit de JSON valide.');
      }
    },
  };
}
