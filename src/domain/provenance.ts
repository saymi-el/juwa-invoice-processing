import { parseAmount } from './money';

const withoutAccents = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = (text: string): string => withoutAccents(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function evidenceHasText(evidence: string, value: string): boolean {
  const normalized = words(value);
  return normalized.length > 0 && ` ${words(evidence)} `.includes(` ${normalized} `);
}

export function evidenceHasNumber(evidence: string, value: number): boolean {
  // Keep decimal and thousands separators together; parseAmount handles their order.
  const tokens = evidence.match(/[+-]?\d+(?:(?:[ \u00a0\u202f]\d{3})|(?:[.,]\d+))*/g) ?? [];
  return tokens.some((token) => parseAmount(token) === value);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

const frenchMonths: Record<string, number> = {
  janvier: 1, janv: 1, fevrier: 2, fevr: 2, mars: 3, avril: 4, avr: 4, mai: 5,
  juin: 6, juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9,
  octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12,
};
const asIso = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function evidenceHasDate(evidence: string, value: string): boolean {
  const candidates = [...evidence.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  for (const match of evidence.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})\b/g)) {
    let year = Number(match[3]);
    // Explicit pivot for two-digit dates: 00–69 => 2000–2069, 70–99 => 1970–1999.
    if (match[3]!.length === 2) year += year < 70 ? 2000 : 1900;
    candidates.push(asIso(year, Number(match[2]), Number(match[1])));
  }
  for (const match of withoutAccents(evidence).matchAll(/\b(\d{1,2})(?:er)?\s+([a-z]+)\.?\s+(\d{4})\b/g)) {
    const month = frenchMonths[match[2]!];
    if (month) candidates.push(asIso(Number(match[3]), month, Number(match[1])));
  }
  return candidates.some((candidate) => isCalendarDate(candidate) && candidate === value);
}

export function evidenceHasCurrency(evidence: string, value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value)) return false;
  if (new RegExp(`\\b${value}\\b`, 'i').test(evidence)) return true;
  if (value === 'EUR') return evidence.includes('€');
  if (value === 'GBP') return evidence.includes('£');
  // A bare dollar sign can refer to USD, CAD, AUD, etc. It is insufficient evidence.
  if (value === 'USD') return /\bUS\s*\$/i.test(evidence);
  return false;
}
