import type { DataStore, Record_ } from '../storage/datastore.js';
import { socialJson, socialObject } from '../starter198/socialContentValidation.js';
import { legacyWeeklyPlanHash } from './legacyWeeklyContentActions.js';
import { enterpriseProfileFromKnowledgeBinding } from '../digitalEmployees/configuration.js';
import { enterpriseProductIdentity } from '../lib/enterpriseProductIdentity.js';
import { isDigitalEmployeeOperatingGoal } from '../digitalEmployees/overviewGoalScope.js';
const object = (value: unknown) => socialObject(socialJson(value)) ?? {};

/** Reads the same goal/plan/run lineage used by the visible business calendar. */
export async function readLegacyWeeklyPackages(store: DataStore, tenantId: string) {
  const rows = await store.list<Record_>('workflow_runs', { where: { tenant_id: tenantId }, sort: '-started_at', perPage: 500 });
  if (rows.totalItems !== rows.items.length) throw new Error('legacy_week_context_incomplete');
  const packages: Array<Record<string, unknown>> = [];
  for (const run of rows.items) {
    if (run.tenant_id !== tenantId || !['running', 'waiting_external', 'waiting_approval', 'waiting_human'].includes(String(run.status))) continue;
    const [plan, goal] = await Promise.all([store.getById<Record_>('weekly_plans', String(run.plan_id)), store.getById<Record_>('weekly_goals', String(run.goal_id))]);
    if (!plan || !goal || plan.status !== 'approved' || plan.tenant_id !== tenantId || goal.tenant_id !== tenantId || plan.goal_id !== goal.id || !isDigitalEmployeeOperatingGoal({ metric: goal.metric, scope: goal.scope }) || packages.some(p => p.planId === plan.id)) continue;
    const body = object(plan.plan), pack = object(body.businessPackage), version = Number(pack.revision);
    if (!Number.isSafeInteger(version) || version < 1) continue;
    const platforms = socialJson(goal.content_platforms);
    const profile = enterpriseProfileFromKnowledgeBinding(body.knowledgeBinding, { allowLegacy: false });
    packages.push({ model: 'legacy', programId: goal.id, packageId: plan.id, packageVersion: version, goalId: goal.id, planId: plan.id, planVersion: version, runId: run.id, expectedPlanHash: legacyWeeklyPlanHash(body), title: `${String(goal.title || '当前周任务')} · 第 ${version} 版`, platforms: (Array.isArray(platforms) ? platforms : []).filter(p => ['tiktok', 'instagram', 'facebook', 'youtube', 'linkedin'].includes(String(p))), allowedProductIds: (profile?.products?.items ?? []).map(enterpriseProductIdentity), name: String(goal.title || '当前周任务') });
  }
  return packages;
}
