import Decimal from 'decimal.js';

// Interpret OCR evidence only. Model output itself must already contain JSON numbers.
export function parseAmount(input: string): number | null {
  let value = input.trim().replace(/(?:EUR|USD|GBP|€|\$|£|%)/gi, '').trim();
  value = value.replace(/[\s\u00a0\u202f]/g, '');
  if (!/^[+-]?\d+(?:[.,]\d+)*$/.test(value)) return null;
  if (value.includes(',') && value.includes('.')) {
    const decimal = value.lastIndexOf(',') > value.lastIndexOf('.') ? ',' : '.';
    value = value.replace(decimal === ',' ? /\./g : /,/g, '').replace(',', '.');
  } else if (value.includes(',')) {
    if ((value.match(/,/g) ?? []).length > 1) return null;
    value = value.replace(',', '.');
  }
  try {
    const amount = new Decimal(value);
    return amount.isFinite() ? amount.toNumber() : null;
  } catch { return null; }
}

export function roundMoney(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

export function sumMoney(values: number[]): number {
  return roundMoney(values.reduce((sum, value) => sum.plus(value), new Decimal(0)));
}

export function lineAmount(quantity: number, unitPrice: number): number {
  return roundMoney(new Decimal(quantity).times(unitPrice));
}
