import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { buildOperatingContext, formatOperatingContext, OPERATING_CONTEXT_LIMITS } from './operatingContext.js';

function fake(handler: (collection: string, query?: ListQuery) => Promise<{ items: Record_[]; totalItems: number }>): Pick<DataStore, 'list'> {
  return { async list<T>(collection: string, query?: ListQuery) {
    const result = await handler(collection, query);
    return { ...result, items: result.items as T[], totalPages: 1, page: 1, perPage: 4 };
  } };
}

test('tenant queries are bounded, records whitelisted and sources preserve empty versus failure', async () => {
  const seen: string[] = [];
  const context = await buildOperatingContext('tenant-a', { question: '全面经营状况', now: new Date('2026-10-10T01:00:00Z'), dataStore: fake(async (collection, query) => {
    assert.deepEqual(query?.where, { tenant_id: 'tenant-a' });
    assert.equal(query?.page, 1);
    assert.equal(query?.perPage, 4);
    seen.push(collection);
    if (collection === 'workflow_runs') throw new Error('secret connection detail');
    if (collection === 'weekly_goals') return { items: [{ id: 'goal', tenant_id: 'tenant-a', title: '目标', target: 100, secret: 'TOKEN', customer_email: 'PRIVATE', objective: 'a'.repeat(1_000) }], totalItems: 20 };
    if (collection === 'starter_social_metric_submissions') return { items: [{ id: 'metric', tenant_id: 'tenant-a', status: 'needs_confirmation', method: 'manual', metrics: { views: 0, inquiries: null, secret: 'TOKEN' }, captured_at: '2025-01-01' }], totalItems: 1 };
    return { items: [], totalItems: 0 };
  }) });
  assert.equal(context.generatedAt, '2026-10-10T01:00:00.000Z');
  assert.equal(seen.length, 14);
  const goal = context.sources.find(source => source.collection === 'weekly_goals')!;
  assert.equal(goal.state, 'available');
  assert.equal(goal.truncated, true);
  assert.equal(goal.records[0].sourceRef, 'weekly_goals/goal');
  assert.equal((goal.records[0].facts.objective as string).length, OPERATING_CONTEXT_LIMITS.fieldChars);
  assert.equal(context.sources.find(source => source.collection === 'workflow_runs')!.state, 'unavailable');
  assert.equal(context.sources.find(source => source.collection === 'workflow_runs')!.totalItems, null);
  assert.equal(context.sources.find(source => source.collection === 'workflow_tasks')!.state, 'empty');
  const formatted = formatOperatingContext(context);
  assert.ok(!formatted.includes('TOKEN') && !formatted.includes('PRIVATE') && !formatted.includes('connection detail'));
  assert.ok(formatted.includes('"views":0') && formatted.includes('"inquiries":null'));
  assert.ok(formatted.includes('needs_confirmation'));
});

test('tenant isolation fails closed even if storage ignores filter', async () => {
  const context = await buildOperatingContext('tenant-a', { dataStore: fake(async () => ({ items: [{ id: 'foreign', tenant_id: 'tenant-b', title: 'PRIVATE' }], totalItems: 1 })) });
  assert.ok(context.sources.every(source => source.state === 'unavailable' && source.records.length === 0));
  assert.ok(!formatOperatingContext(context).includes('PRIVATE'));
  await assert.rejects(buildOperatingContext(''), /tenant_required/);
});

test('source timeout is parallel and failed reads never become zero', async () => {
  const started = Date.now();
  const context = await buildOperatingContext('tenant-a', { timeoutMs: 25, dataStore: fake(() => new Promise(() => {})) });
  assert.ok(Date.now() - started < 500);
  assert.ok(context.sources.every(source => source.state === 'unavailable' && source.totalItems === null));
});

test('large payload remains bounded valid JSON without silently marking complete', async () => {
  const context = await buildOperatingContext('tenant-a', { question: '全面经营状况', dataStore: fake(async () => ({ totalItems: 100, items: Array.from({ length: 10 }, (_, index) => ({ id: `row-${index}`, tenant_id: 'tenant-a', title: '字'.repeat(1_000), objective: '字'.repeat(1_000), status: 'active', created_at: '字'.repeat(1_000), updated_at: '字'.repeat(1_000), blocked_reason: '字'.repeat(1_000), task_id: '字'.repeat(1_000), run_id: '字'.repeat(1_000), goal_id: '字'.repeat(1_000), version: 1, payload: { reason: '字'.repeat(1_000) } })) })) });
  const formatted = formatOperatingContext(context);
  assert.ok(formatted.length <= OPERATING_CONTEXT_LIMITS.promptChars);
  const parsed = JSON.parse(formatted.slice(formatted.indexOf('\n') + 1));
  assert.ok(parsed.sources.every((source: { truncated: boolean; records: unknown[] }) => source.truncated && source.records.length <= 4));
});

test('relevance selection reads only matching categories and combines multi-intent questions', async () => {
  const dataStore = fake(async () => ({ items: [], totalItems: 0 }));
  const progress = await buildOperatingContext('tenant-a', { dataStore });
  assert.equal(progress.selection, 'progress');
  assert.equal(progress.sources.length, 5);
  assert.ok(!progress.sources.some(source => source.collection.includes('metric')));
  const performance = await buildOperatingContext('tenant-a', { dataStore, question: '这周效果如何，询盘情况怎么样' });
  assert.equal(performance.selection, 'performance');
  assert.ok(performance.sources.some(source => source.collection === 'starter_social_metric_submissions'));
  assert.ok(!performance.sources.some(source => source.collection === 'workflow_tasks'));
  const combined = await buildOperatingContext('tenant-a', { dataStore, question: '目标和任务进度如何' });
  assert.equal(combined.selection, 'combined');
  assert.ok(combined.sources.some(source => source.collection === 'weekly_goals'));
  assert.ok(combined.sources.some(source => source.collection === 'workflow_tasks'));
});

test('sales and platform evidence preserve truthfulness states without contacts or provider secrets', async () => {
  const context = await buildOperatingContext('tenant-a', { question: '询盘成交与发布效果', dataStore: fake(async collection => {
    if (collection === 'posts') return { items: [{ id: 'post', tenant_id: 'tenant-a', platform: 'youtube', wa_link: 'PRIVATE_PHONE', stats: { status: 'needs_attention', publishResults: { account1: { status: 'unknown', platformPostId: 'video-1', error: 'SECRET' }, account2: { status: 'failed', error: 'SECRET' } }, accessToken: 'SECRET' } }], totalItems: 1 };
    if (collection === 'tenant_orders') return { items: [{ id: 'order', tenant_id: 'tenant-a', order: { status: 'refunded', amount: 100, refundAmount: 100, buyer: 'PRIVATE_BUYER', owner: 'PRIVATE_OWNER', sourceRef: 'PRIVATE_PHONE', customerId: 'PRIVATE_CUSTOMER' } }], totalItems: 1 };
    if (collection === 'starter_quote_inquiries') return { items: [{ id: 'inquiry', tenant_id: 'tenant-a', quantity: 10, test_record: true, status: 'received', source_reference_hint: 'PRIVATE_EMAIL' }], totalItems: 1 };
    return { items: [], totalItems: 0 };
  }) });
  const prompt = formatOperatingContext(context);
  assert.ok(!prompt.includes('PRIVATE') && !prompt.includes('SECRET'));
  assert.ok(prompt.includes('"status":"unknown"') && prompt.includes('"status":"failed"'));
  assert.ok(prompt.includes('"refundAmount":100') && prompt.includes('"test_record":true'));
  assert.ok(prompt.includes('询盘不是成交') && prompt.includes('不能说成功'));
});
