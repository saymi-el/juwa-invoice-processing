import { readFile } from 'node:fs/promises';
import { batchSchema } from '../src/shared/schema';
import references from '../examples/reference-inputs.json';

const file = process.argv[2] ?? 'public/results.json';
try {
  const batch = batchSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  if (batch.mode !== 'mistral') {
    throw new Error('Ce lot est une démonstration. Il ne prouve pas une extraction Mistral réelle.');
  }
  let mismatches = 0;
  for (const expected of references) {
    const result = batch.invoices.find((invoice) => invoice.fileName === expected.fileName);
    const invoice = result?.invoice;
    const errors: string[] = [];
    if (!result || !invoice || result.status === 'error') errors.push('résultat absent ou en échec');
    else {
      if (invoice.invoiceNumber.value !== expected.invoiceNumber) errors.push('numéro');
      if (invoice.date.value !== expected.date) errors.push('date');
      if (!invoice.supplier.value) errors.push('fournisseur');
      for (const key of ['totalHt', 'totalTtc', 'vatRate', 'vatAmount'] as const) {
        if (invoice[key].value !== expected[key]) errors.push(key);
      }
      if (invoice.items.length !== expected.items.length) errors.push('nombre de lignes');
      expected.items.forEach((item, index) => {
        const actual = invoice.items[index];
        if (!actual?.description.value) errors.push(`désignation ligne ${index + 1}`);
        for (const key of ['quantity', 'unitPrice', 'lineTotal'] as const) {
          if (actual?.[key].value !== item[key]) errors.push(`${key} ligne ${index + 1}`);
        }
      });
      if (expected.fileName.includes('botanica')) {
        for (const code of ['LINE_TOTAL', 'COMPUTED_SUM_HT', 'PRINTED_SUM_HT']) {
          if (!result.checks.some((check) => check.code === code && check.status === 'fail')) errors.push(`anomalie ${code} non signalée`);
        }
      }
    }
    mismatches += errors.length;
    console.log(`${expected.fileName} : ${errors.length ? `à vérifier (${errors.join(', ')})` : 'valeurs contrôlées conformes à la référence'}`);
  }
  console.log('Cette comparaison numérique ne remplace pas la relecture du PDF, des noms et des désignations.');
  process.exitCode = mismatches ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Impossible de lire les résultats.');
  process.exitCode = 1;
}
