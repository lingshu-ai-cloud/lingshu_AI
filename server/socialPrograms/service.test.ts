import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { createSocialProgramService, SocialProgramError } from './service.js';

function memoryStore(): DataStore {
  const rows = new Map<string, Array<Record_>>();
  let counter = 0;
  return {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      const index = list.findIndex(row => row.id === id);
      if (index < 0) return false;
      list[index] = { ...list[index], ...structuredClone(data) };
      return true;
    },
    async delete(collection: string, id: string) {
      const list = rows.get(collection) ?? [];
      const remaining = list.filter(row => row.id !== id);
      rows.set(collection, remaining);
      return remaining.length !== list.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let items = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const field = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (descending ? -1 : 1));
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      const start = (page - 1) * perPage;
      return { items: structuredClone(items.slice(start, start + perPage)) as T[], totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / perPage)), page, perPage };
    },
  };
}

test('social program: one versioned operating chain from foundation to active weekly plan', async () => {
  const service = createSocialProgramService(memoryStore());
  const program = await service.createProgram('tenant-a', 'owner', {
    brandName: 'Aurelia', market: '美国', targetAudience: '敏感肌护肤消费者',
    candidatePlatforms: ['tiktok', 'instagram'], route: 'cold_start',
  });
  assert.equal(program.stage, 'needs_foundation');
  assert.equal(program.version, 1);
  await assert.rejects(
    service.updateProgram('tenant-a', 'owner', program.programId, { expectedVersion: 99, readiness: {} }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'version_conflict',
  );
  await assert.rejects(service.getProgram('tenant-b', program.programId), /社媒项目不存在/);

  const ready = await service.updateProgram('tenant-a', 'owner', program.programId, {
    expectedVersion: 1,
    readiness: {
      foundationConfirmed: true,
      benchmarkRoundComplete: true,
      conversionRouteConfirmed: true,
      accountPlaybooksConfirmed: true,
    },
  });
  assert.equal(ready.stage, 'needs_month_plan');

  const account = await service.createAccount('tenant-a', 'owner', program.programId, {
    platform: 'tiktok', displayName: 'Aurelia Skin Lab', businessRole: '消费者教育主账号',
    audiencePromise: '解释敏感肌屏障问题', contentPromise: '以可验证的产品证据做日常教育',
  });
  assert.equal(account.connectionId, null, 'business account must not impersonate an OAuth connection');

  const playbook = await service.savePlaybook('tenant-a', 'owner', program.programId, account.accountId, {
    expectedAccountVersion: 1, activate: true, audience: ['敏感肌'], pillars: ['屏障知识'],
    recurringFormats: ['桌面实测'], evidenceRules: ['产品参数只引用企业知识库'],
    conversionRoute: { entryType: 'profile_link', callToAction: '查看主页产品资料', qualificationFields: ['skin_type'] },
  });
  assert.equal(playbook.version, 1);
  assert.equal(playbook.status, 'active');

  const month = await service.saveMonthlyPlan('tenant-a', 'owner', program.programId, {
    expectedProgramVersion: ready.version, activate: true, month: '2026-10', objective: '验证屏障修护系列内容',
    accountIds: [account.accountId], successCriteria: ['账号内相对完播率提升'], contentMix: [{ format: '桌面实测', count: 4 }],
  });
  assert.equal(month.status, 'active');
  const afterMonth = await service.getProgram('tenant-a', program.programId);
  assert.equal(afterMonth.stage, 'ready_for_week');
  assert.equal(afterMonth.activeMonthlyPlanRef?.id, month.planId);

  const week = await service.saveWeeklyPlan('tenant-a', 'owner', program.programId, {
    expectedProgramVersion: afterMonth.version, activate: true, weekStart: '2026-10-05',
    monthlyPlanRef: afterMonth.activeMonthlyPlanRef,
    items: [{
      itemId: 'item-1', accountId: account.accountId, title: '面霜开盖使用痕迹实测', contentTask: '爆款裂变',
      cta: '查看主页产品资料', productMarketingProfileRef: { type: 'product_marketing_profile', id: 'p-1', version: 1 },
      referenceRefs: [{ type: 'reference_content', id: 'ref-1', version: 2 }],
      factRefs: [{ type: 'enterprise_product', id: 'product-1', version: 3 }], dueAt: null, approvalPolicy: 'user_confirm',
    }],
  });
  assert.equal(week.status, 'active');
  const executing = await service.getProgram('tenant-a', program.programId);
  assert.equal(executing.stage, 'executing');
  assert.equal(executing.activeWeeklyPlanRef?.id, week.planId);
});

test('social program: activation gates reject incomplete monthly and weekly plans', async () => {
  const service = createSocialProgramService(memoryStore());
  const program = await service.createProgram('tenant-a', 'owner', {
    brandName: 'Brand B', market: '加拿大', targetAudience: '零售买手', candidatePlatforms: ['youtube'], route: 'account_repair',
  });
  assert.equal(program.stage, 'needs_account_import');
  await assert.rejects(
    service.saveMonthlyPlan('tenant-a', 'owner', program.programId, {
      expectedProgramVersion: 1, activate: true, month: '2026-10', objective: '修复账号', accountIds: ['a'], successCriteria: ['有效询盘'],
    }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'activation_blocked',
  );
});
