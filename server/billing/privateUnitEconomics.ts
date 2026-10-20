import type { ProductPointSection } from '../../shared/pointsPolicy.js';

/** Internal-only commercial terms. Never serialize this type from a customer route. */
export interface MonthlyPlanCommercialTerms {
  planId: string;
  monthlyPriceCny: number;
  allocations: Record<ProductPointSection, number>;
}

/** Internal-only add-on terms. The UI should receive a sanitized product catalog instead. */
export interface AddonCommercialTerms {
  sku: string;
  sellingPriceCny: number;
  points: number;
}

export interface ProviderCostReceipt {
  amount: number;
  currency: string;
  /** Audited exchange rate: one unit of receipt currency equals this many CNY. */
  cnyPerCurrencyUnit: number;
  fxSource: string;
  fxQuotedAt: string;
}

const finitePositive = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`private_unit_economics_${field}_invalid`);
  return value;
};

const safeMoney = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export function planPointPriceCny(terms: MonthlyPlanCommercialTerms): number {
  const totalPoints = Object.values(terms.allocations).reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(totalPoints) || totalPoints <= 0) throw new Error('private_unit_economics_plan_points_invalid');
  return safeMoney(finitePositive(terms.monthlyPriceCny, 'plan_price') / totalPoints);
}

export function addonPointPriceCny(terms: AddonCommercialTerms): number {
  if (!Number.isSafeInteger(terms.points) || terms.points <= 0) throw new Error('private_unit_economics_addon_points_invalid');
  return safeMoney(finitePositive(terms.sellingPriceCny, 'addon_price') / terms.points);
}

/** Enforces the business rule that out-of-plan capacity costs more per point. */
export function assertAddonPremium(input: {
  plan: MonthlyPlanCommercialTerms;
  addons: AddonCommercialTerms[];
}): { planCnyPerPoint: number; addonCnyPerPoint: Record<string, number> } {
  const planCnyPerPoint = planPointPriceCny(input.plan);
  const addonCnyPerPoint: Record<string, number> = {};
  for (const addon of input.addons) {
    const sku = addon.sku.trim();
    if (!sku || addonCnyPerPoint[sku] !== undefined) throw new Error('private_unit_economics_addon_sku_invalid');
    const price = addonPointPriceCny(addon);
    if (price <= planCnyPerPoint) throw new Error('private_unit_economics_addon_premium_required');
    addonCnyPerPoint[sku] = price;
  }
  return { planCnyPerPoint, addonCnyPerPoint };
}

/** Converts a provider receipt to CNY without changing the customer price book. */
export function providerCostCny(receipt: ProviderCostReceipt): number {
  const currency = receipt.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || !receipt.fxSource.trim() || !Number.isFinite(Date.parse(receipt.fxQuotedAt))) {
    throw new Error('private_unit_economics_fx_evidence_invalid');
  }
  return safeMoney(
    finitePositive(receipt.amount, 'provider_amount')
      * finitePositive(receipt.cnyPerCurrencyUnit, 'fx_rate'),
  );
}

/** Private profitability signal used for route/model optimization, never for customer deduction. */
export function evaluateUnitEconomics(input: {
  deliveredPoints: number;
  sellingCnyPerPoint: number;
  providerCostCny: number;
}) {
  if (!Number.isSafeInteger(input.deliveredPoints) || input.deliveredPoints < 0) throw new Error('private_unit_economics_delivered_points_invalid');
  if (!Number.isFinite(input.sellingCnyPerPoint) || input.sellingCnyPerPoint < 0) throw new Error('private_unit_economics_selling_rate_invalid');
  if (!Number.isFinite(input.providerCostCny) || input.providerCostCny < 0) throw new Error('private_unit_economics_provider_cost_invalid');
  const recognizedRevenueCny = safeMoney(input.deliveredPoints * input.sellingCnyPerPoint);
  const grossProfitCny = safeMoney(recognizedRevenueCny - input.providerCostCny);
  const grossMarginRatio = recognizedRevenueCny > 0 ? safeMoney(grossProfitCny / recognizedRevenueCny) : null;
  return { recognizedRevenueCny, providerCostCny: safeMoney(input.providerCostCny), grossProfitCny, grossMarginRatio };
}
