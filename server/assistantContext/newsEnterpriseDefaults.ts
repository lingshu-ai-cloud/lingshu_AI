import { store } from '../storage/index.js';
import { object } from './businessScenes/readScope.js';

export type NewsEnterpriseDefaults = { industry?: string; market?: string; platforms?: string[] };
/** Only non-sensitive query dimensions. Never export accounts, customer records or credentials. */
export async function readNewsEnterpriseDefaults(tenantId: string): Promise<NewsEnterpriseDefaults> {
  const latest = async (collection: string) => {
    try {
      const result = await store.list(collection, { where: { tenant_id: tenantId }, page: 1, perPage: 1, sort: '-created_at' });
      return result.items[0]?.tenant_id === tenantId ? result.items[0] : undefined;
    } catch { return undefined; }
  };
  const [configRecord, goalRecord, planRecord] = await Promise.all([
    latest('digital_employee_configs'), latest('weekly_goals'), latest('weekly_plans'),
  ]);
  const config = object(configRecord?.config), snapshot = object(object(planRecord?.plan).configSnapshot);
  const platformNames = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(item => {
    const name = typeof item === 'string' ? item : object(item).platform;
    return typeof name === 'string' && name.trim() ? [name.trim().slice(0, 80)] : [];
  }) : [];
  const rawGoalPlatforms = goalRecord?.content_platforms;
  let goalPlatforms: unknown = rawGoalPlatforms;
  if (typeof rawGoalPlatforms === 'string') { try { goalPlatforms = JSON.parse(rawGoalPlatforms); } catch { goalPlatforms = []; } }
  const bounded = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 120) : '';
  return { industry: bounded(config.industry) || bounded(snapshot.industry),
    market: bounded(config.targetMarkets) || bounded(snapshot.targetMarkets),
    platforms: [...new Set([...platformNames(config.publishingTargets), ...platformNames(goalPlatforms), ...platformNames(snapshot.publishingTargets)])].slice(0, 12) };
}
