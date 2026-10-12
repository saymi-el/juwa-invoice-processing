import type { InvoiceResult, NumberField, TextField } from '../shared/schema';

export type SourcedField = TextField | NumberField;
export const statusLabels: Record<InvoiceResult['status'], string> = {
  ok: 'Contrôles passés', review: 'À vérifier', error: 'Échec',
};

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(value);
}

export function formatAmount(value: number, currency: string | null): string {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return formatNumber(value);
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(value);
}

export function formatDate(value: string): string {
  // Do not silently normalize impossible dates such as February 31.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return value;
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export function evidenceLabel(field: SourcedField): string {
  return [field.page ? `Page ${field.page}` : 'Page non identifiée',
    field.evidence ?? 'Aucun extrait source disponible'].join(' · ');
}

export function fieldLabel(path: string): string {
  const names: Record<string, string> = {
    supplier: 'Fournisseur', invoiceNumber: 'Numéro de facture', date: 'Date de facture',
    currency: 'Devise', items: 'Lignes de facture', totalHt: 'Total HT', totalTtc: 'Total TTC',
    vatRate: 'Taux de TVA', vatAmount: 'Montant TVA', description: 'Désignation',
    quantity: 'Quantité', unitPrice: 'Prix unitaire', lineTotal: 'Montant HT de la ligne',
  };
  const item = /^items\.(\d+)\.(\w+)$/.exec(path);
  if (item?.[1] && item[2]) return `Ligne ${Number(item[1]) + 1} · ${names[item[2]] ?? item[2]}`;
  return names[path] ?? path;
}
