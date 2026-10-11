import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createMistralClient } from './api';
import { loadConfig } from './config';
import { runBatch } from './runner';

const HELP = `Usage : npm run pipeline -- --input input --output public/results.json

Options :
  --input   Dossier de PDF (par défaut : input ; sans sous-dossiers)
  --output  JSON de résultats (par défaut : public/results.json)
  --help    Afficher cette aide, sans appeler Mistral

Configurez MISTRAL_API_KEY dans .env (voir .env.example).
Codes de sortie : 0 = lot traité, 2 = au moins une facture en échec,
1 = configuration, dossier d’entrée ou écriture de sortie impossible.
Les avertissements de cohérence ne sont pas des échecs techniques.`;

export async function main(args = process.argv.slice(2)): Promise<number> {
  let output: string;
  let input: string;
  try {
    const { values } = parseArgs({ args, options: {
      input: { type: 'string', default: 'input' },
      output: { type: 'string', default: 'public/results.json' },
      help: { type: 'boolean', default: false },
    }, strict: true, allowPositionals: false });
    if (values.help) { console.log(HELP); return 0; }
    input = resolve(values.input!);
    output = resolve(values.output!);
    if (!output.toLowerCase().endsWith('.json')) throw new Error();
  } catch {
    console.error('Arguments invalides. La sortie doit être un fichier .json. Consultez --help.');
    return 1;
  }
  let config;
  try { config = loadConfig(); }
  catch (error) { console.error((error as Error).message); return 1; }

  let batch;
  try {
    batch = await runBatch({
      inputDir: input, client: createMistralClient(config), models: config.models,
      onProgress: (result, index, total) => console.log(`[${index}/${total}] ${result.fileName} : ${result.status}`),
    });
  } catch {
    console.error('Impossible de traiter le dossier. Vérifiez son existence et la présence de fichiers PDF.');
    return 1;
  }
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(batch, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, output);
  } catch {
    console.error('Impossible d’écrire les résultats. Vérifiez le chemin et les permissions.');
    return 1;
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  const failed = batch.invoices.filter(({ status }) => status === 'error').length;
  console.log(`${batch.invoices.length} facture(s) traitée(s), ${failed} échec(s). Résultats : ${output}`);
  return failed > 0 ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
