/** A versioned management assumption, never a supplier settlement exchange rate. */
export const INTERNAL_BUDGET_FX = Object.freeze({
  version: 'usd-cny-budget-2026-10-30.v1',
  cnyPerUsd: 6.6,
  observedAt: '2026-10-29',
  sourceUrl: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
});

function nonnegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('internal_budget_amount_invalid');
  return value;
}

const roundUpMicros = (value: number) => {
  if (!Number.isFinite(value) || value * 1_000_000 > Number.MAX_SAFE_INTEGER)
    throw new Error('internal_budget_amount_overflow');
  return value === 0 ? 0 : Math.ceil(value * 1_000_000 - 1e-6) / 1_000_000;
};

/** Convert a CNY management estimate to USD, conservatively rounding up. */
export function budgetUsdFromCny(cny: number): number {
  return roundUpMicros(nonnegative(cny) / INTERNAL_BUDGET_FX.cnyPerUsd);
}

/** Compatibility projection for existing CNY-only production ledgers. */
export function budgetCnyFromUsd(usd: number): number {
  return roundUpMicros(nonnegative(usd) * INTERNAL_BUDGET_FX.cnyPerUsd);
}
