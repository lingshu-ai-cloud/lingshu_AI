import { budgetUsdFromCny, INTERNAL_BUDGET_FX } from '../../shared/contracts/internalBudgetFx.js';

export type InternalEstimateUnit = 'second' | 'image' | 'operation';
export interface InternalUnitPrice {
  version: string;
  provider: string;
  model: string;
  configuration: string;
  unit: InternalEstimateUnit;
  nativeCurrency: 'USD' | 'CNY';
  nativePricePerUnit: number;
  sourceRef: string;
  /** Calibrated rates are internal approximations, not supplier list prices. */
  basis: 'published_unit' | 'calibrated_unit';
}
export interface DeterministicCostLine {
  id: string;
  price: InternalUnitPrice;
  quantity: number;
  attempts: number;
}

const micros = (value: number) => {
  if (!Number.isFinite(value) || value * 1_000_000 > Number.MAX_SAFE_INTEGER)
    throw new Error('internal_usd_estimate_overflow');
  return value === 0 ? 0 : Math.ceil(value * 1_000_000 - 1e-6) / 1_000_000;
};
const text = (value: string) => typeof value === 'string' && value.trim() === value && value.length > 0;

/** Internal planning only. It does not grant a paid operation or debit points. */
export function estimateDeterministicTaskUsd(lines: readonly DeterministicCostLine[]) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('internal_usd_estimate_lines_required');
  const ids = new Set<string>();
  const items = lines.map(line => {
    const price = line.price;
    if (!text(line.id) || ids.has(line.id) || !price ||
      ![price.version, price.provider, price.model, price.configuration, price.sourceRef].every(text) ||
      !['second', 'image', 'operation'].includes(price.unit) ||
      !['USD', 'CNY'].includes(price.nativeCurrency) ||
      !['published_unit', 'calibrated_unit'].includes(price.basis) ||
      !Number.isFinite(price.nativePricePerUnit) || price.nativePricePerUnit <= 0 ||
      !Number.isFinite(line.quantity) || line.quantity <= 0 ||
      !Number.isSafeInteger(line.attempts) || line.attempts <= 0 ||
      (price.unit !== 'second' && !Number.isSafeInteger(line.quantity))) {
      throw new Error('internal_usd_estimate_line_invalid');
    }
    ids.add(line.id);
    const nativeAmount = line.quantity * line.attempts * price.nativePricePerUnit;
    const estimatedUsd = price.nativeCurrency === 'USD'
      ? micros(nativeAmount) : budgetUsdFromCny(nativeAmount);
    if (!Number.isSafeInteger(Math.round(estimatedUsd * 1_000_000)))
      throw new Error('internal_usd_estimate_overflow');
    return { id: line.id, provider: price.provider, model: price.model,
      configuration: price.configuration, unit: price.unit, quantity: line.quantity,
      attempts: line.attempts, priceVersion: price.version, basis: price.basis,
      sourceRef: price.sourceRef, nativeCurrency: price.nativeCurrency,
      nativeAmount: micros(nativeAmount), estimatedUsd };
  });
  return { currency: 'USD' as const, fxVersion: INTERNAL_BUDGET_FX.version,
    estimatedUsd: micros(items.reduce((total, item) => total + item.estimatedUsd, 0)), items };
}

/** Preserve the provider's original charge; USD is a management equivalent. */
export function normalizeProviderReceiptUsd(receipt: {
  amount: number; currency: 'USD' | 'CNY'; receiptRef: string;
}) {
  if (!Number.isFinite(receipt.amount) || receipt.amount < 0 || !text(receipt.receiptRef) ||
    !['USD', 'CNY'].includes(receipt.currency)) throw new Error('internal_usd_receipt_invalid');
  return { nativeAmount: receipt.amount, nativeCurrency: receipt.currency,
    receiptRef: receipt.receiptRef, usdEquivalent: receipt.currency === 'USD'
      ? micros(receipt.amount) : budgetUsdFromCny(receipt.amount),
    fxVersion: INTERNAL_BUDGET_FX.version };
}

/** An overrun is evidence for recalibrating future prices, not a retroactive debit. */
export function compareEstimateWithReceipt(estimatedUsd: number, actualUsd: number) {
  if (![estimatedUsd, actualUsd].every(value => Number.isFinite(value) && value >= 0))
    throw new Error('internal_usd_comparison_invalid');
  return { exceeded: actualUsd > estimatedUsd,
    differenceUsd: micros(Math.abs(actualUsd - estimatedUsd)),
    coverageRatio: actualUsd === 0 ? null : estimatedUsd / actualUsd };
}
