import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { recommendPackage, compilePackage } from './weeklyPackage.js';
import { enterpriseFactContentHash, type EnterpriseProfile } from '../routes/enterprise.js';
const rows = new Map<string, any[]>(); let seq = 0; let failTasks = false;
const original = { ...store }, originalFetch = globalThis.fetch;
Object.assign(store, {
  async getById(c: string, id: string) { return structuredClone(rows.get(c)?.find(row => row.id === id) || null); },
  async list(c: string, query: any) { let items = (rows.get(c) || []).filter(row => Object.entries(query?.where || {}).every(([key, value]) => row[key] === value)); if (query?.sort) { const key = query.sort.replace(/^-/, ''); items = items.slice().sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) * (query.sort.startsWith('-') ? -1 : 1)); } return { items: structuredClone(items), page: 1, totalPages: 1, totalItems: items.length, perPage: 100 }; },
  async create(c: string, value: any) { if (c === 'workflow_tasks' && failTasks) { failTasks = false; return null; } if (c === 'durable_operation_leases' && rows.get(c)?.some(row => row.tenant_id === value.tenant_id && row.lease_scope === value.lease_scope && row.subject_id === value.subject_id)) throw Error('unique lease'); const row = { ...structuredClone(value), id: `row-${++seq}` }; rows.set(c, [...(rows.get(c) || []), row]); return structuredClone(row); },
  async update(c: string, id: string, value: any) { const row = rows.get(c)?.find(item => item.id === id); if (!row) return false; Object.assign(row, structuredClone(value)); return true; },
  async compareAndSwap(c: string, id: string, expected: Record<string, unknown>, value: Record<string, unknown>) { const row = rows.get(c)?.find(item => item.id === id); if (!row || Object.entries(expected).some(([key, candidate]) => !isDeepStrictEqual(row[key], candidate))) return false; Object.assign(row, structuredClone(value)); return true; },
  async delete(c: string, id: string) { const old = rows.get(c) || []; rows.set(c, old.filter(row => row.id !== id)); return old.length !== rows.get(c)!.length; },
} satisfies DataStore);
globalThis.fetch = async () => { throw Error('No external network allowed'); };
try {
  const { continueManagedOperatingCycle, approveGoalForReview } = await import('../routes/digitalEmployees.js');
  const { runManagedOperatingContinuations } = await import('./runtimeOrchestrator.js');
  const config = normalizeDigitalEmployeeConfig({ companyName: 'Tenant', industry: 'Tools', primaryBusiness: 'A', focusProducts: 'A', autonomyMode: 'automatic', allowRealPublishing: true, publishingTargets: [{ platform: 'youtube', accountId: 'a', accountLabel: 'A' }], managedPublishingGrant: { enabled: true, grantId: 'grant', authorizedBy: 'actor', accountIds: ['a'], maxPublishItems: 3, validUntil: '2099-02-01' }, productionOnboarding: { schemaVersion: 'fixed-yield.production-onboarding.v1', contact: { kind: 'none', value: '', primaryCta: '' }, presenterPolicy: 'local_video_only', output: { primaryLanguage: 'en', aspectRatio: '9:16', resolution: '1080p' }, includeOneRevision: true, confirmedAt: '2026-10-01T00:00:00Z' } });
  const input = normalizeWeeklyGoal({ startsAt: '2098-12-29', endsAt: '2099-01-04', contentPlatforms: ['youtube'] }, config);
  const pack = recommendPackage(input, config);
  pack.tasks = pack.tasks.filter(task => task.templateId !== 'director');
  const preparedMasters = (pack.tasks.find(task => task.templateId === 'production')?.videoPlans || []).filter(plan => plan.productionRole !== 'platform_adaptation');
  pack.detailGeneration = { status: 'ready', startedAt: '2026-10-01T00:00:00Z', generatedAt: '2026-10-01T00:01:00Z', estimatedMinutes: 2, usageCostCny: null, readyCount: preparedMasters.length, blockedCount: 0, blockers: [] };
  for (const plan of preparedMasters) {
    plan.estimatedCost = 12.5;
    plan.estimatedCostRange = { minCny: 10, maxCny: 15, basis: 'verified_storyboard_provider_envelope' };
    plan.preproduction = { version: 1, status: 'ready', generatedAt: '2026-10-01T00:01:00Z', benchmark: { status: 'not_applicable', referenceId: '', title: '', account: '', views: '', thumbnailUrl: '', sourceUrl: '', hook: '', shotSummary: [] }, materials: { status: 'ready', items: [], blockers: [], pendingShootTaskIds: [] }, readiness: { canStart: true, blockers: [] }, confidence: { onTimeRate: null, effectLevel: 'insufficient', reasons: [] } };
  }
  if (pack.directorPlan) pack.directorPlan = { ...pack.directorPlan, productionBudgetMode: 'protected', productionBudgetMin: preparedMasters.length * 10, productionBudget: preparedMasters.length * 15, productionBudgetMax: preparedMasters.length * 15 };
  const profile = { company: { name: 'Tenant', industry: 'Tools', mainMarkets: 'US', founded: '2020', description: 'Tool manufacturer' }, products: { categories: 'Tools', priceRange: '', moq: '100', certifications: '', highlights: 'Factory direct', items: [{ id: 'product-a', name: 'A', sku: 'A-1', category: 'Tools', highlights: 'Factory direct' }] }, brand: { name: 'Tenant', tone: 'Professional', style: '', taboos: '', usp: 'Factory direct' }, knowledge: '', dataGovernance: { aiAccessEnabled: true } } as EnterpriseProfile;
  profile.factVersion = { id: 'facts-1', revision: 1, contentHash: enterpriseFactContentHash(profile), confirmedAt: '2026-10-01T00:00:00Z', confirmedBy: 'actor' };
  const tenant = 'managed-cycle-test';
  const seed = () => { rows.clear(); rows.set('digital_employee_configs', [{ id: 'config', tenant_id: tenant, status: 'active', config }]); rows.set('tenant_profiles', [{ id: 'profile', tenant_id: tenant, profile }]); rows.set('studio_production_defaults', [{ id: 'presenter-defaults', tenant_id: tenant, payload: { defaultPresenterId: 'presenter-1', presenters: [{ id: 'presenter-1', name: 'Presenter', avatarId: 'avatar-1', voiceId: 'voice-1', authorized: true }] } }]); rows.set('weekly_goals', [{ id: 'source', tenant_id: tenant, business_line: 'content_growth', title: 'Source', objective: 'Product content', scope: 'A', content_platforms: ['youtube'], metric: 'content', baseline: 0, target: 1, unit: 'item', constraints: [], starts_at: input.startsAt, ends_at: input.endsAt, status: 'completed', owner_id: 'actor', version: 1 }]); rows.set('weekly_plans', [{ id: 'source-plan', tenant_id: tenant, goal_id: 'source', status: 'approved', plan: structuredClone({ ...compilePackage(pack, input, config), configSnapshot: config }) }]); rows.set('workflow_runs', [{ id: 'source-run', tenant_id: tenant, goal_id: 'source', plan_id: 'source-plan', status: 'succeeded', started_at: '2026-01-01T00:00:00Z' }]); rows.set('weekly_reviews', [{ id: 'review', tenant_id: tenant, run_id: 'source-run', status: 'generated', summary: { nextPlanRecommendations: ['Explain the product clearly'] } }]); };
  seed();
  const now = new Date('2099-01-05T01:00:00Z');
  assert.equal(await continueManagedOperatingCycle(tenant, 'source-run', new Date('2099-01-04T01:00:00Z')), null);
  rows.get('digital_employee_configs')![0].config = { ...config, managedPublishingGrant: undefined };
  assert.equal((await runManagedOperatingContinuations(now)).continued, 0);
  assert.equal(rows.get('weekly_goals')!.length, 1);
  rows.get('digital_employee_configs')![0].config = config;
  failTasks = true;
  const failed = await runManagedOperatingContinuations(now);
  assert.equal(failed.errors.length, 1);
  assert.equal(rows.get('weekly_goals')!.length, 2);
  assert.equal(rows.get('workflow_runs')!.filter(run => run.status === 'initializing').length, 1);
  const recovered = await runManagedOperatingContinuations(now);
  assert.equal(recovered.errors.length, 0, JSON.stringify(recovered.errors));
  assert.equal(recovered.continued, 1);
  assert.equal(rows.get('weekly_goals')!.length, 2, 'restart recovers the same goal');
  assert.equal(rows.get('workflow_runs')!.length, 2, 'restart recovers the same run');
  const targetPlan = rows.get('weekly_plans')!.find(plan => plan.id !== 'source-plan');
  assert.equal(targetPlan.plan.managedPublishingGrantId, 'grant');
  assert.equal(rows.get('workflow_tasks')!.some(task => task.task_key === 'followup_dispatch'), false);
  await Promise.all([continueManagedOperatingCycle(tenant, 'source-run', now), continueManagedOperatingCycle(tenant, 'source-run', now)]);
  assert.equal(rows.get('weekly_goals')!.length, 2, 'concurrent retries never clone twice');
  assert.equal(await continueManagedOperatingCycle('other-tenant', 'source-run', now), null);
  const nextRun = rows.get('workflow_runs')!.find(run => run.id !== 'source-run');
  const nextGoal = rows.get('weekly_goals')!.find(goal => goal.id !== 'source');
  nextRun.status = 'succeeded'; nextGoal.status = 'completed';
  rows.get('weekly_reviews')!.push({ id: 'review-next', tenant_id: tenant, run_id: nextRun.id, status: 'generated', summary: {} });
  assert.equal((await runManagedOperatingContinuations(new Date('2099-01-12T01:00:00Z'))).continued, 1);
  assert.equal(rows.get('weekly_goals')!.length, 3, 'the second completed cycle automatically starts a third without a user board');

  seed();
  rows.set('workflow_runs', []);
  rows.get('weekly_goals')![0].status = 'draft';
  rows.get('weekly_plans')![0].status = 'draft';
  const configuredOnboarding = rows.get('digital_employee_configs')![0].config.productionOnboarding;
  const confirmedBy = profile.factVersion!.confirmedBy;
  delete rows.get('digital_employee_configs')![0].config.productionOnboarding;
  rows.get('weekly_plans')![0].plan.configSnapshot = { ...rows.get('weekly_plans')![0].plan.configSnapshot, productionOnboarding: undefined };
  profile.factVersion!.confirmedBy = 'system';
  const blocked = await approveGoalForReview(tenant, 'actor', 'source', pack.revision, []);
  assert.equal(blocked.status, 409);
  assert.equal((blocked.body as { error?: string }).error, 'production_onboarding_preflight_blocked');
  assert.equal(rows.get('workflow_runs')!.length, 0, 'failed onboarding preflight must not create a run');
  assert.equal(rows.get('weekly_goals')![0].status, 'draft', 'failed onboarding preflight must not activate the goal');
  assert.equal(rows.get('weekly_plans')![0].status, 'draft', 'failed onboarding preflight must not approve the plan');
  profile.factVersion!.confirmedBy = confirmedBy;
  rows.get('digital_employee_configs')![0].config.productionOnboarding = configuredOnboarding;
  rows.get('weekly_plans')![0].plan.configSnapshot = { ...rows.get('weekly_plans')![0].plan.configSnapshot, productionOnboarding: configuredOnboarding };
  const first = await approveGoalForReview(tenant, 'actor', 'source', pack.revision, []);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(rows.get('weekly_plans')![0].plan.managedPublishingGrantId, 'grant', 'first cycle binds explicit consent without waiting for next week');
  assert.equal(rows.get('weekly_plans')![0].plan.businessPackage.authorization.mode, 'bounded');
  console.log('Background managed continuation: no user board, no early run, legacy defaults, durable concurrency and partial-write recovery passed');
} finally { Object.assign(store, original); globalThis.fetch = originalFetch; }
