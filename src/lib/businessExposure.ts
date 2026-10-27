export interface OrganicExposure {
  impressions: number | null;
  accountId: string;
  timezone: string;
  since: string;
  until: string;
  excludesPaid: true;
}
/** Only mutually exclusive impression counts with the same account/window/timezone can be added. */
export function businessExposure(organic: OrganicExposure | undefined, paid: { impressions: number | null; accountId: string; timezone: string; since: string; until: string } | undefined) {
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const paidValue = valid(paid?.impressions) ? paid.impressions : null;
  const aligned = !!organic && !!paid && organic.excludesPaid === true && ['accountId', 'timezone', 'since', 'until'].every(key => organic[key as keyof OrganicExposure] === paid[key as keyof typeof paid]);
  const organicValue = aligned && valid(organic?.impressions) ? organic.impressions : null;
  return { paid: paidValue, organic: organicValue, total: organicValue !== null && paidValue !== null ? organicValue + paidValue : null, aligned };
}
