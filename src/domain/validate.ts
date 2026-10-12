import Decimal from 'decimal.js';
import type { Check, Invoice, NumberField, OcrPage, TextField, Warning } from '../shared/schema';
import { lineAmount, roundMoney, sumMoney } from './money';
import { evidenceAppearsOnPage, evidenceHasCurrency, evidenceHasDate, evidenceHasNumber, evidenceHasText, isCalendarDate } from './provenance';

type Field = NumberField | TextField;

function fieldsOf(invoice: Invoice): Array<{ path: string; field: Field; required: boolean }> {
  const result: Array<{ path: string; field: Field; required: boolean }> = [
    { path: 'supplier', field: invoice.supplier, required: true },
    { path: 'invoiceNumber', field: invoice.invoiceNumber, required: true },
    { path: 'date', field: invoice.date, required: true },
    { path: 'currency', field: invoice.currency, required: true },
    { path: 'totalHt', field: invoice.totalHt, required: true },
    { path: 'totalTtc', field: invoice.totalTtc, required: true },
    { path: 'vatAmount', field: invoice.vatAmount, required: false },
    { path: 'vatRate', field: invoice.vatRate, required: false },
  ];
  invoice.items.forEach((item, index) => {
    for (const [key, field] of Object.entries(item)) {
      result.push({ path: `items.${index}.${key}`, field, required: key !== 'lineTotal' });
    }
  });
  return result;
}

/** Schema validity, OCR provenance and accounting checks are separate responsibilities. */
export function validateInvoice(input: Invoice, pages: OcrPage[]): {
  invoice: Invoice; warnings: Warning[]; checks: Check[];
} {
  const invoice = structuredClone(input);
  const warnings: Warning[] = [];
  const checks: Check[] = [];
  const warn = (code: string, field: string, message: string, page: number | null,
    source: Warning['source'] = 'validation'): void => {
    warnings.push({ code, field, message, page, source });
  };
  for (const uncertainty of invoice.uncertainties) {
    warn('EXTRACTION_UNCERTAIN', uncertainty.field, uncertainty.message, null, 'extraction');
  }

  const uncertainPaths = new Set(invoice.uncertainties.map((item) => item.field));
  for (const { path, field, required } of fieldsOf(invoice)) {
    if (uncertainPaths.has(path)) field.value = null;
    if (field.value === null) {
      if (required) warn('MISSING_FIELD', path, 'Information absente ou insuffisamment lisible.', field.page);
      continue;
    }
    const page = pages.find((candidate) => candidate.page === field.page);
    if (!page || !field.evidence || !evidenceAppearsOnPage(page.markdown, field.evidence)) {
      warn('UNSUPPORTED_EVIDENCE', path, 'Valeur écartée : extrait justificatif absent de la page OCR indiquée.', field.page);
      field.value = null;
    } else if (typeof field.value === 'number' && !evidenceHasNumber(field.evidence, field.value)) {
      warn('UNSUPPORTED_NUMBER', path, 'Valeur écartée : nombre introuvable dans son extrait justificatif.', field.page);
      field.value = null;
    } else if (typeof field.value === 'string') {
      if (path === 'date') {
        if (!isCalendarDate(field.value)) {
          warn('INVALID_DATE', path, 'Date invalide : une vérification du document est nécessaire.', field.page);
          field.value = null;
        } else if (!evidenceHasDate(field.evidence, field.value)) {
          warn('UNSUPPORTED_DATE', path, 'Date écartée : différente de l’extrait ou format non reconnu (ISO, jour/mois/année ou mois français attendus).', field.page);
          field.value = null;
        }
      } else if (path === 'currency') {
        if (!/^[A-Z]{3}$/.test(field.value)) {
          warn('INVALID_CURRENCY', path, 'Devise non reconnue au format ISO à trois lettres.', field.page);
          field.value = null;
        } else if (!evidenceHasCurrency(field.evidence, field.value)) {
          warn('UNSUPPORTED_CURRENCY', path, 'Devise écartée : code ou symbole non étayé. Un dollar seul est ambigu.', field.page);
          field.value = null;
        }
      } else if (!evidenceHasText(field.evidence, field.value)) {
        warn('UNSUPPORTED_TEXT', path, 'Valeur écartée : texte introuvable dans son extrait après normalisation.', field.page);
        field.value = null;
      }
    }
  }

  if (invoice.items.length === 0) warn('NO_ITEMS', 'items', 'Aucune ligne exploitable extraite.', null);
  for (const page of pages) {
    if (/(?:Ã.|Â.|â€|\uFFFD|■)/.test(page.markdown)) {
      warn('OCR_ENCODING', 'document', 'Le texte OCR contient des caractères suspects. Vérifier le PDF original.', page.page);
    }
  }

  const compare = (code: string, field: string, label: string, expected: number | null, actual: number | null): void => {
    const difference = expected === null || actual === null ? null : roundMoney(new Decimal(actual).minus(expected));
    const status: Check['status'] = difference === null ? 'skipped' : Math.abs(difference) <= 0.01 ? 'pass' : 'fail';
    const message = status === 'skipped' ? 'Contrôle impossible : données nécessaires absentes ou incertaines.'
      : status === 'pass' ? 'Les montants concordent, à un centime près.'
        : `Écart de ${difference?.toFixed(2)} entre le montant indiqué et le montant calculé.`;
    checks.push({ code, field, label, status, expected, actual, difference, message });
    if (status !== 'pass') warn(status === 'fail' ? 'AMOUNT_MISMATCH' : 'CHECK_SKIPPED', field,
      `${label} : ${message}`, null, 'business');
  };

  const computedLines: Array<number | null> = [];
  invoice.items.forEach((item, index) => {
    const expected = item.quantity.value === null || item.unitPrice.value === null ? null
      : lineAmount(item.quantity.value, item.unitPrice.value);
    computedLines.push(expected);
    // Printed line amounts are optional; a missing amount still prevents this particular check.
    compare('LINE_TOTAL', `items.${index}.lineTotal`, `Ligne ${index + 1} : quantité × prix unitaire`, expected, item.lineTotal.value);
  });
  const allComputed = computedLines.length > 0 && computedLines.every((value): value is number => value !== null);
  compare('COMPUTED_SUM_HT', 'totalHt', 'Somme des lignes recalculées / total HT',
    allComputed ? sumMoney(computedLines) : null, invoice.totalHt.value);
  const printed = invoice.items.map((item) => item.lineTotal.value);
  const allPrinted = printed.length > 0 && printed.every((value): value is number => value !== null);
  compare('PRINTED_SUM_HT', 'totalHt', 'Somme des montants imprimés / total HT',
    allPrinted ? sumMoney(printed) : null, invoice.totalHt.value);

  const { totalHt, totalTtc, vatAmount, vatRate } = invoice;
  compare('HT_TAX_TTC', 'totalTtc', 'Total HT + TVA / total TTC',
    totalHt.value !== null && vatAmount.value !== null ? sumMoney([totalHt.value, vatAmount.value]) : null,
    totalTtc.value);
  compare('VAT_RATE', 'vatAmount', 'TVA / taux indiqué',
    totalHt.value !== null && vatRate.value !== null
      ? roundMoney(new Decimal(totalHt.value).times(vatRate.value).div(100)) : null,
    vatAmount.value);

  return { invoice, warnings, checks };
}
