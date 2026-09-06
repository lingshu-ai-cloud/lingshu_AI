import assert from 'node:assert/strict';
import fs from 'node:fs';
import { store } from '../storage/index.js';
import { buildBusinessSnapshot } from './businessSnapshot.js';

const source = fs.readFileSync('server/digitalEmployees/businessSnapshot.ts', 'utf8');
assert.match(source, /store\.list<GenericRecord>\('customer_segments'/, 'weekly review must read persisted customer segment snapshots');
assert.match(source, /store\.list<GenericRecord>\('followup_batches'/, 'weekly review must use the canonical follow-up batch collection');
assert.match(source, /store\.list<GenericRecord>\('followup_batch_items'/, 'weekly review must use per-customer follow-up items');
assert.doesNotMatch(source, /store\.list<GenericRecord>\('outreach_(?:batches|recipients)'/, 'outreach aliases must not create a second source of truth');
assert.match(source, /customersWithVerifiedAiReply[\s\S]*?providerMessageId/, 'AI reception metrics must require an actual WhatsApp provider receipt');
assert.match(source, /outreachSent:\s*metric\([\s\S]*?provider_message_id/, 'proactive outreach metrics must require a provider message id');
assert.match(source, /filter\(connectedAccount\)/, 'account readiness and counts must ignore disconnected accounts');
assert.match(source, /completedWorkHasReceipt/, 'completed content metrics must require a verifiable render receipt');
assert.match(source, /weekPosts\.filter\(hasPublishedReceipt\)/, 'published content metrics must require a platform/provider receipt');
assert.match(source, /connectedMetricSnapshots/, 'social performance must exclude snapshots from disconnected accounts');
assert.match(source, /published\.reduce\([\s\S]{0,160}item\.inquiries/, 'inquiry totals must only use posts with provider receipts');

type FixtureRecord = { id: string; [key: string]: unknown };
const fixtures = new Map<string, FixtureRecord[]>();
const originalList = store.list;

(store as unknown as { list: typeof store.list }).list = (async (collection: string) => {
  const items = fixtures.get(collection) ?? [];
  return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: 500 };
}) as typeof store.list;

try {
  const tenantId = 'digital-employee-business-snapshot-empty-fixture';
  const now = new Date('2026-09-03T00:00:00.000Z');
  const empty = await buildBusinessSnapshot(tenantId, { startsAt: '2026-08-31', endsAt: '2026-09-06' }, now);

  assert.equal(empty.range.timeZone, 'Asia/Shanghai');
  assert.equal(empty.readiness.length, 7, 'first login must inventory every required business source');
  assert.equal(empty.readiness.find(item => item.key === 'social_accounts')?.status, 'empty');
  assert.equal(empty.readiness.find(item => item.key === 'customers')?.status, 'empty');
  assert.equal(empty.customer.total.status, 'unavailable', 'no real customer source must be marked unavailable, not presented as a measured KPI');
  assert.equal(empty.content.publishedPosts.status, 'unavailable', 'no connected social account must not be rendered as a measured zero');
  assert.equal(empty.content.publishedPosts.value, null, 'missing publishing receipts must be represented as missing, not zero');
  assert.equal(empty.content.inquiries.value, null, 'downstream publishing attribution must stay missing without a connected account');
  assert.equal(empty.customer.segmentSnapshots.status, 'pending', 'missing segment snapshots must be shown as pending');
  assert.equal(empty.customer.outreachBatches.status, 'pending', 'missing follow-up batches must be shown as waiting for data');
  assert.equal(empty.attribution.status, 'pending', 'cross-module attribution must remain pending without both posts and customers');
  assert.ok(empty.dataGaps.some(item => item.includes('客户分层快照')));
  assert.ok(empty.dataGaps.some(item => item.includes('批量跟进批次')));

  fixtures.set('social_accounts', [
    { id: 'account-disconnected', tenantId, platform: 'instagram', status: 'expired' },
    { id: 'account-connected', tenantId, platform: 'facebook', status: 'connected' },
  ]);
  fixtures.set('studio_projects', [
    { id: 'project-mock', tenant_id: tenantId, title: '示例项目', status: 'published', updated_at: '2026-09-03T00:00:00.000Z', spec: { source: 'demo_data', renderOutputPath: 'https://example.test/demo.mp4' } },
    { id: 'project-legitimate-demo', tenant_id: tenantId, title: 'Product demo video', status: 'draft', updated_at: '2026-09-03T00:00:00.000Z', spec: { source: 'manual' } },
    { id: 'project-no-render', tenant_id: tenantId, title: '真实项目', status: 'published', updated_at: '2026-09-03T00:00:00.000Z', spec: { automation: { managedBy: 'digital_employee', stage: 'completed', quality: { passed: true }, renderOutputPath: '/missing/output.mp4' } } },
  ]);
  const truthfulResources = await buildBusinessSnapshot(tenantId, { startsAt: '2026-08-31', endsAt: '2026-09-06' }, now);
  assert.equal(truthfulResources.social.accountCount.value, 1, 'only currently connected accounts are operationally ready');
  assert.equal(truthfulResources.content.contentProjects.value, 2, 'explicit demo/mock projects must be excluded without hiding a legitimate product demo');
  assert.equal(truthfulResources.content.completedWorks.value, 0, 'a completed status without an accessible render is not a completed work');
  assert.equal(truthfulResources.readiness.find(item => item.key === 'content_projects')?.status, 'incomplete', 'empty drafts and missing render receipts must not make content production ready');
  assert.equal(truthfulResources.readiness.find(item => item.key === 'content_projects')?.count, 0, 'content readiness must count only projects with truthful inputs or advanceable output');

  fixtures.set('trend_videos', [
    { id: 'metadata-only', tenantId, title: '仅元数据', aiAnalysis: { analysisMode: 'metadata', analysisQuality: 'metadata' } },
  ]);
  const metadataOnly = await buildBusinessSnapshot(tenantId, { startsAt: '2026-08-31', endsAt: '2026-09-06' }, now);
  assert.equal(metadataOnly.readiness.find(item => item.key === 'viral_library')?.status, 'incomplete', 'metadata-only videos must not make the viral library ready');
  assert.equal(metadataOnly.readiness.find(item => item.key === 'viral_library')?.count, 0, 'viral readiness count must represent exact analyses, not collected URLs');
  assert.ok(metadataOnly.dataGaps.some(item => item.includes('全片精确分析')));

  fixtures.set('trend_videos', [
    { id: 'metadata-only', tenantId, title: '仅元数据', aiAnalysis: { analysisMode: 'metadata', analysisQuality: 'metadata' } },
    { id: 'exact-video', tenantId, title: '精确分析', aiAnalysis: { analysisMode: 'exact', analysisQuality: 'video', gemini: { summary: '真实全片分析' } } },
  ]);
  fixtures.set('studio_projects', [
    { id: 'project-with-material', tenant_id: tenantId, title: '已选真实素材', status: 'draft', updated_at: '2026-09-03T00:00:00.000Z', spec: { source: 'manual', selectedMaterialIds: ['material-real-1'] } },
    { id: 'project-mock-material', tenant_id: tenantId, title: '误选测试素材', status: 'draft', updated_at: '2026-09-03T00:00:00.000Z', spec: { source: 'manual', selectedMaterialIds: ['mock-0627'] } },
  ]);
  const actionableResources = await buildBusinessSnapshot(tenantId, { startsAt: '2026-08-31', endsAt: '2026-09-06' }, now);
  assert.equal(actionableResources.readiness.find(item => item.key === 'viral_library')?.status, 'ready');
  assert.equal(actionableResources.readiness.find(item => item.key === 'viral_library')?.count, 1);
  assert.equal(actionableResources.readiness.find(item => item.key === 'content_projects')?.status, 'ready');
  assert.equal(actionableResources.readiness.find(item => item.key === 'content_projects')?.count, 1, 'mock material identifiers must not count as a truthful selection');

  fixtures.set('scheduled_tasks', [{
    id: 'automation-1', tenant_id: tenantId, name: '早间爆款采集', enabled: true,
    cron_expr: '0 9 * * *', cron_label: '每天 09:00',
  }]);
  fixtures.set('posts', [
    { id: 'post-1', tenant_id: tenantId, title: '产品内容发布', platform: 'tiktok', published_at: '2026-09-03T02:00:00.000Z', stats: { status: 'scheduled' } },
    { id: 'post-fake-published', tenant_id: tenantId, title: '仅状态成功', platform: 'facebook', published_at: '2026-09-03T01:00:00.000Z', inquiries: 99, deals: 9, stats: { status: 'published' } },
    { id: 'post-receipt', tenant_id: tenantId, title: '真实发布', platform: 'facebook', published_at: '2026-09-03T01:30:00.000Z', inquiries: 2, deals: 1, stats: { status: 'published', publishResults: { 'account-connected': { postId: 'provider-post-1' } } } },
  ]);
  fixtures.set('tenant_orders', [
    { id: 'order-paid', tenant_id: tenantId, order: { buyer: 'Buyer', product: 'Switch', amount: 100, status: '已付款', sourcePostId: 'post-receipt', orderDate: '2026-09-03' } },
    { id: 'order-refunded', tenant_id: tenantId, order: { buyer: 'Buyer', product: 'Switch', amount: 100, status: '退款', sourcePostId: 'post-receipt', orderDate: '2026-09-03' } },
    { id: 'order-unattributed', tenant_id: tenantId, order: { buyer: 'Buyer', product: 'Switch', amount: 100, status: '已付款', orderDate: '2026-09-03' } },
    { id: 'order-old', tenant_id: tenantId, order: { buyer: 'Buyer', product: 'Switch', amount: 100, status: '已付款', sourcePostId: 'post-receipt', orderDate: '2026-08-01' } },
  ]);
  fixtures.set('followup_batches', [{
    id: 'batch-1', tenant_id: tenantId, run_id: 'run-1', status: 'approved', created_at: '2026-09-03T00:00:00.000Z',
  }]);
  fixtures.set('followup_batch_items', [{
    id: 'item-1', tenant_id: tenantId, batch_id: 'batch-1', customer_name: '客户 A', status: 'approved',
    scheduled_at: '2026-09-03T03:00:00.000Z', created_at: '2026-09-03T00:00:00.000Z',
  }]);

  const scheduled = await buildBusinessSnapshot(tenantId, { startsAt: '2026-08-31', endsAt: '2026-09-06' }, now);
  assert.deepEqual(
    scheduled.next24Hours.map(item => item.kind),
    ['automation', 'publish', 'followup'],
    'the next-24-hours view must merge and sort Scheduler, publishing, and customer work',
  );
  assert.equal(scheduled.content.scheduledPosts.value, 1);
  assert.equal(scheduled.content.publishedPosts.value, 1, 'only the post with a provider receipt is published');
  assert.equal(scheduled.content.inquiries.value, 2, 'unreceipted post counters must not inflate inquiries');
  assert.equal(scheduled.content.deals.value, 1, 'only in-period nonrefunded tenant orders attributed to receipted posts count as deals');
  assert.equal(scheduled.customer.outreachBatches.status, 'available');
  assert.equal(scheduled.customer.followupDrafts.value, 1);

  fixtures.set('studio_projects', [
    { id: 'clone-digital', title: '双属性作品', status: 'completed', updated_at: '2026-09-03T00:00:00Z', spec: { mode: 'clone', presenterMode: 'digital', videoPath: 'https://example.com/video.mp4' } },
    { id: 'unfinished-digital', title: '尚未生成', status: 'draft', updated_at: '2026-09-03T00:00:00Z', spec: { mode: 'product', presenterMode: 'digital' } },
    { id: 'no-receipt', title: '无回执', status: 'completed', updated_at: '2026-09-03T00:00:00Z', spec: { mode: 'clone' } },
    { id: 'old', title: '周期外作品', status: 'completed', updated_at: '2026-08-01T00:00:00Z', spec: { mode: 'clone', videoPath: 'https://example.com/old.mp4' } },
  ]);
  const production = (await buildBusinessSnapshot(tenantId, { startsAt: '2026-08-31', endsAt: '2026-09-06' }, now)).content.production!;
  assert.equal(production.status, 'available');
  assert.equal(production.projects.length, 3, 'exclude projects outside selected period');
  assert.equal(production.projects.filter(item => item.completed).length, 1, 'status alone and planned digital presenters are not completed videos');
  assert.equal(production.projects[0].route, 'clone');
  assert.equal(production.projects[0].digitalPresenter, true, 'a clone video may also use a digital presenter');
  assert.equal(production.projects[0].approved, false, 'render completion does not imply editorial approval');
  const fixtureList = store.list;
  store.list = (async (collection: string, ...args: any[]) => {
    if (collection === 'studio_projects') throw new Error('storage unavailable');
    return (fixtureList as any)(collection, ...args);
  }) as typeof store.list;
  assert.equal((await buildBusinessSnapshot(tenantId, undefined, now)).content.production?.status, 'unavailable', 'read failures must not become measured zero production');
} finally {
  (store as unknown as { list: typeof store.list }).list = originalList;
}

console.log('digital employee business snapshot tests passed');
