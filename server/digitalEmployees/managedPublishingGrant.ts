import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { managedPublishingGrantErrors } from '../../shared/contracts/managedPublishingGrant.js';
import type { DigitalEmployeeConfig } from './domain.js';

/** Future cycles must stay inside both the previous package and current consent. */
export function applyManagedPublishingGrant(pack: WeeklyPackage, config: DigitalEmployeeConfig, endsAt: string, now = new Date().toISOString()): { pack: WeeklyPackage; grantId?: string } {
  const next = structuredClone(pack);
  next.authorization.mode = 'each';
  const grant = config.managedPublishingGrant;
  if (!grant?.enabled || !grant.grantId || !grant.authorizedBy || managedPublishingGrantErrors(grant, config, new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(now))).length || endsAt > grant.validUntil || !next.tasks.some(task => task.templateId === 'publishing')) return { pack: next };
  const accounts = next.authorization.accountIds;
  if (!accounts.length || accounts.some(id => !grant.accountIds.includes(id)) || next.authorization.maxPublishItems > grant.maxPublishItems || next.authorization.maxPublishItems < 1) return { pack: next };
  next.authorization.mode = 'bounded';
  // This consent only covers publishing. Customer sends keep their own approval.
  next.authorization.customerIds = [];
  next.authorization.maxCustomerMessages = 0;
  return { pack: next, grantId: grant.grantId };
}
export function managedPublishingGrantCovers(pack: WeeklyPackage, config: DigitalEmployeeConfig, grantId: string, endsAt: string, now = new Date().toISOString()): boolean {
  const result = applyManagedPublishingGrant(pack, config, endsAt, now);
  return result.grantId === grantId && result.pack.authorization.mode === 'bounded';
}
