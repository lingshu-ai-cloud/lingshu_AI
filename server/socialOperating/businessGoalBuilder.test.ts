import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessGoalBuildInput, EnterpriseOperatingInput } from '../../shared/contracts/socialOperatingDecision.js';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { buildBusinessContentGoal } from './businessGoalBuilder.js';
import { analyzeEnterpriseOperatingChange } from './impactAnalysis.js';
import { createSocialOperatingDecisionService, SocialOperatingDecisionError } from './service.js';

function memoryStore(): DataStore {
  const rows = new Map<string, Record_[]>();
  let sequence = 0;
  return {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `row-${++sequence}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const items = rows.get(collection) ?? [];
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return false;
      items[index] = { ...items[index], ...structuredClone(data) };
      return true;
    },
    async delete(collection: string, id: string) {
      const items = rows.get(collection) ?? [];
      const next = items.filter(item => item.id !== id);
      rows.set(collection, next);
      return next.length !== items.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let items = (rows.get(collection) ?? []).filter(item => Object.entries(query.where ?? {}).every(([key, value]) => item[key] === value));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const key = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((a, b) => (Number(a[key]) - Number(b[key])) * (descending ? -1 : 1));
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      const start = (page - 1) * perPage;
      return { items: structuredClone(items.slice(start, start + perPage)) as T[], totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / perPage)), page, perPage };
    },
  };
}

const ref = (type: string, id: string, version: number) => ({ type, id, version });

function enterprise(version = 12): EnterpriseOperatingInput {
  return {
    ref: ref('enterprise_social_operating_defaults', 'factory-a', version),
    products: ['精华', '身体乳'], markets: ['北美', '东南亚'], audiences: ['私标品牌', '小批量品牌方'], languages: ['en'],
    publicFacts: [{ ref: ref('enterprise_fact', 'fact-moq', version), statement: '支持已核验的小批量打样流程' }],
    prohibitedClaims: ['固定交期', '医学功效'], weeklyBudgetCny: 1200, salesOwnerId: 'sales-1',
  };
}

function fixture(version = 12): BusinessGoalBuildInput {
  return {
    programRef: ref('social_program', 'program-a', 1), enterprise: enterprise(version),
    accounts: [
      { ref: ref('owned_social_account', 'account-tk', 2), accountId: 'account-tk', platform: 'tiktok', role: '核心账号', status: 'active', conversionRouteId: 'route-web' },
      { ref: ref('owned_social_account', 'account-ig', 1), accountId: 'account-ig', platform: 'instagram', role: '协同账号', status: 'planned', conversionRouteId: 'route-web' },
    ],
    conversionRoutes: [{ ref: ref('conversion_route', 'route-web', 3), routeId: 'route-web', kind: 'website', target: 'https://example.test/inquiry', verified: true }],
  };
}

const options = { version: 1, operator: { type: 'agent' as const, id: 'operating-agent' }, decidedAt: '2026-09-26T00:00:00.000Z' };

test('same normalized inputs and rule version produce exactly the same goal and decision', () => {
  const first = buildBusinessContentGoal(fixture(), options);
  const reordered = fixture();
  reordered.enterprise.products.reverse();
  reordered.enterprise.audiences.reverse();
  reordered.accounts.reverse();
  assert.deepEqual(buildBusinessContentGoal(reordered, options), first);
  assert.equal(first.goal.status, 'ready');
  assert.deepEqual(first.goal.evidence.map(item => item.state), ['fact', 'fact', 'fact', 'fact', 'inference']);
});

test('missing authoritative facts fails closed with unknown evidence and structured blockers', () => {
  const input = fixture();
  input.enterprise.publicFacts = [];
  input.enterprise.salesOwnerId = null;
  input.conversionRoutes[0]!.target = null;
  const { goal, decision } = buildBusinessContentGoal(input, options);
  assert.equal(goal.status, 'blocked');
  assert.equal(decision.outcome, 'blocked');
  assert.deepEqual(goal.blockers.map(item => item.code), ['public_facts_required', 'conversion_route_required', 'sales_owner_required']);
  assert.equal(goal.evidence.find(item => item.key === 'public_facts')?.state, 'unknown');
  assert.deepEqual(goal.conversionRouteIds, []);
});

test('enterprise knowledge v12 to v13 returns deterministic scoped impacts without mutating old work', () => {
  const previous = enterprise(12);
  const next = enterprise(13);
  next.markets = [...next.markets, '中东'];
  next.publicFacts = [{ ref: ref('enterprise_fact', 'fact-moq', 13), statement: '支持已核验的打样流程' }];
  const impacts = analyzeEnterpriseOperatingChange({ previous, next });
  assert.deepEqual(impacts.map(item => item.area), [
    'account_strategy', 'authorization_review', 'business_goal', 'content_facts', 'discovery_scope', 'weekly_planning',
  ]);
  assert.ok(impacts.every(item => item.handling === 'new_work_only' || item.handling === 'review_required'));
  assert.equal(previous.ref.version, 12);
});

test('service persists immutable versions, replays identical input, isolates tenants, and rejects stale versions', async () => {
  const service = createSocialOperatingDecisionService(memoryStore(), () => '2026-09-26T00:00:00.000Z');
  const first = await service.buildAndSave({ tenantId: 'tenant-a', operator: options.operator, input: fixture(), expectedVersion: 0 });
  assert.equal(first.created, true);
  const replay = await service.buildAndSave({ tenantId: 'tenant-a', operator: options.operator, input: fixture() });
  assert.equal(replay.created, false);
  assert.deepEqual(replay.goal, first.goal);
  await assert.rejects(service.getGoal('tenant-b', 'program-a', first.goal.goalId),
    (error: unknown) => error instanceof SocialOperatingDecisionError && error.code === 'business_goal_not_found');

  const changed = fixture(13);
  changed.enterprise.markets.push('中东');
  await assert.rejects(service.buildAndSave({ tenantId: 'tenant-a', operator: options.operator, input: changed, expectedVersion: 0 }),
    (error: unknown) => error instanceof SocialOperatingDecisionError && error.code === 'version_conflict');
  const second = await service.buildAndSave({
    tenantId: 'tenant-a', operator: options.operator, input: changed, expectedVersion: 1, previousEnterprise: enterprise(12),
  });
  assert.equal(second.goal.version, 2);
  assert.deepEqual(second.decision.impacts.map(item => item.area), [
    'account_strategy', 'authorization_review', 'business_goal', 'content_facts', 'discovery_scope', 'weekly_planning',
  ]);
  assert.equal((await service.getGoal('tenant-a', 'program-a', first.goal.goalId, 1)).version, 1);
  assert.equal((await service.getDecision('tenant-a', 'program-a', second.decision.decisionId)).subjectRef.version, 2);
});

test('business goal persistence resumes after interruption between decision and goal writes', async () => {
  const base = memoryStore();
  let failGoalOnce = true;
  let decisionCreates = 0;
  const faultStore: DataStore = {
    ...base,
    async create<T>(collection: string, data: Record<string, unknown>) {
      if (collection === 'social_operating_decisions') decisionCreates += 1;
      if (collection === 'social_business_content_goals' && failGoalOnce) {
        failGoalOnce = false;
        return null;
      }
      return base.create<T>(collection, data);
    },
  };
  let clockTick = 0;
  const service = createSocialOperatingDecisionService(faultStore, () => `2026-09-26T00:00:0${clockTick++}.000Z`);
  await assert.rejects(
    service.buildAndSave({ tenantId: 'tenant-a', operator: options.operator, input: fixture(), expectedVersion: 0 }),
    /business_goal_storage_unavailable/,
  );
  const recovered = await service.buildAndSave({ tenantId: 'tenant-a', operator: options.operator, input: fixture(), expectedVersion: 0 });
  assert.equal(recovered.created, true);
  assert.equal(recovered.goal.version, 1);
  assert.equal(decisionCreates, 1, 'retry reuses the already committed immutable decision');
  assert.deepEqual((await service.getDecision('tenant-a', 'program-a', recovered.decision.decisionId)), recovered.decision);
});
