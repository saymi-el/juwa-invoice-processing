import { loadEnvFile } from 'node:process';

export type MistralConfig = { apiKey: string; models: { ocr: string; chat: string } };

export function loadConfig(envPath = '.env'): MistralConfig {
  try {
    loadEnvFile(envPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Impossible de lire le fichier .env. Vérifiez ses permissions et son format.');
    }
  }
  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  if (!apiKey) throw new Error('MISTRAL_API_KEY est absente. Complétez .env à partir de .env.example.');
  return {
    apiKey,
    models: {
      ocr: process.env.MISTRAL_OCR_MODEL?.trim() || 'mistral-ocr-latest',
      chat: process.env.MISTRAL_CHAT_MODEL?.trim() || 'mistral-small-latest',
    },
  };
}
