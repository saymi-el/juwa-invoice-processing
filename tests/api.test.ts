import { describe, expect, it, vi } from 'vitest';
import { createMistralClient } from '../src/pipeline/api';

const config = { apiKey: 'test-secret-never-display', models: { ocr: 'ocr-test', chat: 'chat-test' } };
const pdf = Buffer.from('%PDF-1.4 test');
const pages = [{ page: 1, markdown: 'Facture de test' }];
const ocrResponse = () => Response.json({ pages: [{ index: 0, markdown: 'Facture de test' }] });

describe('Mistral HTTP client', () => {
  it('sends a base64 PDF to OCR and normalizes page numbers', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(ocrResponse());
    const client = createMistralClient(config, { fetch: request });
    expect(await client.ocr(pdf)).toEqual(pages);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://api.mistral.ai/v1/ocr');
    expect(init?.headers).toEqual({ Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'ocr-test', document: { type: 'document_url', document_url: `data:application/pdf;base64,${pdf.toString('base64')}` },
    });
  });

  it('retries HTTP 429 with a bounded Retry-After delay', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('rate limit', { status: 429, headers: { 'Retry-After': '9999' } }))
      .mockResolvedValueOnce(ocrResponse());
    const sleep = vi.fn(async (_ms: number) => undefined);
    expect(await createMistralClient(config, { fetch: request, sleep }).ocr(pdf)).toEqual(pages);
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it('does not retry HTTP 401 or expose its body', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(config.apiKey, { status: 401 }));
    const sleep = vi.fn(async (_ms: number) => undefined);
    const promise = createMistralClient(config, { fetch: request, sleep }).ocr(pdf);
    await expect(promise).rejects.toMatchObject({ code: 'HTTP_401' });
    await expect(promise).rejects.not.toThrow(config.apiKey);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops after three failed network attempts without logging the original error', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error(config.apiKey));
    const sleep = vi.fn(async (_ms: number) => undefined);
    const promise = createMistralClient(config, { fetch: request, sleep }).ocr(pdf);
    await expect(promise).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(promise).rejects.not.toThrow(config.apiKey);
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('rejects empty OCR text and malformed API envelopes', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ pages: [{ index: 0, markdown: '  ' }] }))
      .mockResolvedValueOnce(Response.json({ unexpected: true }));
    const client = createMistralClient(config, { fetch: request });
    await expect(client.ocr(pdf)).rejects.toMatchObject({ code: 'EMPTY_OCR' });
    await expect(client.ocr(pdf)).rejects.toMatchObject({ code: 'INVALID_OCR_RESPONSE' });
  });

  it('requests the strict invoice JSON schema and returns parsed content', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      choices: [{ finish_reason: 'stop', message: { content: '{"test":true}' } }],
    }));
    expect(await createMistralClient(config, { fetch: request }).extract(pages)).toEqual({ test: true });
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'invoice', strict: true } });
    expect(body.response_format.json_schema.schema.properties).toHaveProperty('totalHt');
    expect(body.messages[1].content).toContain('Facture de test');
  });

  it.each(['length', 'error', 'content_filter'])('rejects incomplete generations (%s)', async (finishReason) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      choices: [{ finish_reason: finishReason, message: { content: '{}' } }],
    }));
    await expect(createMistralClient(config, { fetch: request }).extract(pages))
      .rejects.toMatchObject({ code: 'INCOMPLETE_LLM_RESPONSE' });
  });

  it('rejects malformed JSON even after a normal completion', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      choices: [{ finish_reason: 'stop', message: { content: '{ broken' } }],
    }));
    await expect(createMistralClient(config, { fetch: request }).extract(pages))
      .rejects.toMatchObject({ code: 'INVALID_LLM_JSON' });
  });
});
