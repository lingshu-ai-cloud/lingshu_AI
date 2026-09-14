import type { MoneyAmount, QuoteCurrency } from './types.js';

export interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
const CURRENCY_DIGITS: Readonly<Record<string, number>> = Object.freeze({
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
});

function pow10(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > 30) throw new RangeError('decimal scale out of range');
  return 10n ** BigInt(value);
}

function normalized(value: ExactDecimal): ExactDecimal {
  let { coefficient, scale } = value;
  if (coefficient === 0n) return { coefficient: 0n, scale: 0 };
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

export function parseExactDecimal(value: unknown, label = 'decimal'): ExactDecimal {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${label} must be a decimal string`);
  const source = String(value).trim();
  if (source.length > 48) throw new RangeError(`${label} is too large`);
  const match = DECIMAL_PATTERN.exec(source);
  if (!match) throw new TypeError(`${label} must be a non-negative base-10 decimal`);
  const fractional = match[2] ?? '';
  if (fractional.length > 12) throw new RangeError(`${label} supports at most 12 decimal places`);
  return normalized({ coefficient: BigInt(source.replace('.', '')), scale: fractional.length });
}

export function addDecimal(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return normalized({
    coefficient: left.coefficient * pow10(scale - left.scale) + right.coefficient * pow10(scale - right.scale),
    scale,
  });
}

export function subtractDecimal(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  const result = left.coefficient * pow10(scale - left.scale) - right.coefficient * pow10(scale - right.scale);
  if (result < 0n) throw new RangeError('negative commercial amount');
  return normalized({ coefficient: result, scale });
}

export function multiplyDecimalByInteger(value: ExactDecimal, multiplier: number | bigint): ExactDecimal {
  const integer = typeof multiplier === 'bigint' ? multiplier : BigInt(multiplier);
  if (integer < 0n) throw new RangeError('negative multiplier');
  return normalized({ coefficient: value.coefficient * integer, scale: value.scale });
}

export function multiplyDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return normalized({ coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale });
}

export function multiplyByBps(value: ExactDecimal, bps: number): ExactDecimal {
  if (!Number.isSafeInteger(bps) || bps < 0) throw new RangeError('basis points must be a non-negative integer');
  return normalized({ coefficient: value.coefficient * BigInt(bps), scale: value.scale + 4 });
}

export function compareDecimal(left: ExactDecimal, right: ExactDecimal): number {
  const scale = Math.max(left.scale, right.scale);
  const a = left.coefficient * pow10(scale - left.scale);
  const b = right.coefficient * pow10(scale - right.scale);
  return a === b ? 0 : a < b ? -1 : 1;
}

export function decimalToString(value: ExactDecimal): string {
  const exact = normalized(value);
  if (exact.scale === 0) return exact.coefficient.toString();
  const digits = exact.coefficient.toString().padStart(exact.scale + 1, '0');
  return `${digits.slice(0, -exact.scale)}.${digits.slice(-exact.scale)}`;
}

export function currencyDigits(currency: QuoteCurrency): number {
  return CURRENCY_DIGITS[currency.toUpperCase()] ?? 2;
}

/** Round non-negative rational numerator/denominator using half-up semantics. */
export function roundDivideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('invalid non-negative division');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** Convert an exact base-currency decimal through an immutable FX rate snapshot. */
export function decimalToMoney(
  baseAmount: ExactDecimal,
  quoteCurrency: QuoteCurrency,
  fxRate: ExactDecimal,
): MoneyAmount {
  const digits = currencyDigits(quoteCurrency);
  const numerator = baseAmount.coefficient * fxRate.coefficient * pow10(digits);
  const denominator = pow10(baseAmount.scale + fxRate.scale);
  const minor = roundDivideHalfUp(numerator, denominator);
  return moneyFromMinor(quoteCurrency, minor);
}

export function moneyFromMinor(currency: QuoteCurrency, minor: bigint): MoneyAmount {
  if (minor < 0n) throw new RangeError('negative money');
  const digits = currencyDigits(currency);
  const source = minor.toString().padStart(digits + 1, '0');
  return {
    currency,
    minorUnits: minor.toString(),
    decimal: digits === 0 ? source : `${source.slice(0, -digits)}.${source.slice(-digits)}`,
  };
}

export function addMoney(...items: MoneyAmount[]): MoneyAmount {
  if (items.length === 0) throw new RangeError('money list cannot be empty');
  const currency = items[0].currency;
  if (items.some(item => item.currency !== currency || !/^\d+$/.test(item.minorUnits))) {
    throw new TypeError('money currency/units mismatch');
  }
  return moneyFromMinor(currency, items.reduce((sum, item) => sum + BigInt(item.minorUnits), 0n));
}
