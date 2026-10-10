import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual dashboard projection without mounting React or fetching data.
const source = readFileSync(new URL('./SmartBusinessDashboard.tsx', import.meta.url), 'utf8');
const start = source.indexOf('function buildSmartBusinessDisplayModel(');
const end = source.indexOf('\nfunction PlanDataSourceBadge', start);
assert.ok(start >= 0 && end > start);
const performanceCalls: string[] = [];
const context: Record<string, any> = {
  platformOptions: ['tiktok', 'instagram', 'facebook', 'youtube'], platformLabels: { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' },
  engagingContentTitle: (value: string) => value,
  referencePlanForPublication: (plans: any[], plan: any) => plans.find(item => item.contentId === plan.masterContentId) || plan,
  inspirationReferenceForPlan: () => null,
  contentThumbnailUrl: () => '/cover.jpg',
  demoMetrics: () => ({ views: 0, likes: 0, comments: 0, shares: 0, interactions: 0, engagementRate: 0, source: 'demo' }),
  performanceForQueueItem: (item: any) => { performanceCalls.push(item.contentId); return { views: 111, likes: 1, comments: 0, shares: 0, interactions: 1, engagementRate: 1, hasPlatformData: true }; },
};
vm.createContext(context);
vm.runInContext(ts.transpileModule(`${source.slice(start, end)}\nglobalThis.build = buildSmartBusinessDisplayModel;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const build = context.build as (data: any) => any;
const master = (extra = {}) => ({ contentId: 'master', contentFamilyId: 'family', productionRole: 'master', productId: 'product', productName: '云朵泡沫卸妆蜜', theme: '真实主题', platform: 'tiktok', matrix: { accountId: 'tiktok-account' }, plannedPublishDate: '2026-10-11', duration: 30,
  planningEvidence: { referenceTitle: '真实爆款标题' }, ...extra });
const variant = (extra = {}) => ({ ...master(), contentId: 'variant', masterContentId: 'master', productionRole: 'platform_adaptation', platform: 'instagram', matrix: { accountId: 'instagram-account' }, publication: { title: '专属发布文案', caption: 'Instagram 文案', tags: [], status: 'confirmed' }, ...extra });
const queue = (extra = {}) => ({ id: 'queue', contentId: 'master', origin: 'weekly_plan', lineage: { goalId: 'goal', planId: 'plan' }, taskId: 'task', projectIds: ['project'], status: 'blocked', platform: 'tiktok', accountId: 'tiktok-account', productName: '云朵泡沫卸妆蜜', ...extra });
const overview = (plans: any[] = [master(), variant()], items: any[] = [queue()]) => ({
  config: { companyName: 'Aurelia', publishingTargets: [] }, goal: { id: 'goal', endsAt: '2026-10-18' },
  plan: { id: 'plan', businessPackage: { tasks: [{ templateId: 'production', videoPlans: plans }] } },
  run: { id: 'run', goal_id: 'goal', plan_id: 'plan' }, tasks: [{ id: 'task', run_id: 'run' }], contentQueue: { items }, deliveries: [], businessSnapshot: null,
});

for (const title of ['⚡ [object Object]｜云朵泡沫卸妆蜜', { unrelated: { nested: 'not a title' } }, null, undefined, 42, ['array title']]) {
  const result = build(overview([master({ publication: { title }, theme: '[object Object]' })]));
  assert.equal(result.contents[0].title, '云朵泡沫卸妆蜜｜真实爆款标题');
  assert.doesNotMatch(result.contents[0].title, /object Object/);
}
assert.equal(build(overview([master({ publication: { title: { text: '已有真实标题' } } })])).contents[0].title, '已有真实标题');
assert.equal(build(overview([master({ publication: { title: { title: { zh: '本地化标题' } } } })])).contents[0].title, '本地化标题');
assert.equal(build(overview([master({ publication: { title: '保留用户标题' } })])).contents[0].title, '保留用户标题');
const cyclic: Record<string, unknown> = {}; cyclic.title = cyclic;
assert.equal(build(overview([master({ publication: { title: cyclic }, theme: '真实主题' })])).contents[0].title, '真实主题', 'malformed cyclic object must not recurse forever');

{
  const data = overview(); const before = JSON.stringify(data); performanceCalls.length = 0;
  const result = build(data);
  assert.equal(result.contents[1].status, 'blocked', 'adaptation shows the exact shared master production blocker');
  assert.equal(result.contents[1].queueItem.id, 'queue');
  assert.equal(result.contents[1].platform, 'instagram');
  assert.equal(result.contents[1].accountId, 'instagram-account');
  assert.equal(result.contents[1].caption, 'Instagram 文案');
  assert.equal(result.contents[1].metrics.source, 'demo', 'master platform data must not be copied into another platform');
  assert.deepEqual(performanceCalls, ['master']);
  assert.equal(JSON.stringify(data), before, 'display must not rewrite publication or production data');
}
{
  const data = overview(undefined, [queue(), queue({ id: 'own-queue', contentId: 'variant', platform: 'instagram', accountId: 'instagram-account', status: 'completed' })]);
  assert.equal(build(data).contents[1].status, 'completed', 'a variant’s own execution status wins over shared production');
  const completedShared = build(overview(undefined, [queue({ status: 'completed' })]));
  assert.equal(completedShared.contents[1].status, 'completed');
  assert.equal(completedShared.totals.publishedCount, 1, 'sharing production must not multiply the legacy publication count');
  data.businessSnapshot = { social: { views: { value: null }, likes: { value: null }, comments: { value: null }, shares: { value: null }, saves: { value: null }, platformBreakdown: [] }, content: { publishedPosts: { value: 7 } } } as any;
  assert.equal(build(data).totals.publishedCount, 7, 'actual publishing receipt is authoritative and unchanged');
}
for (const extra of [{ masterContentId: 'unknown' }, { contentFamilyId: 'other' }, { productId: 'other' }]) {
  assert.equal(build(overview([master(), variant(extra)])).contents[1].status, 'planned', 'invalid or mismatched master linkage must not borrow status');
}
assert.equal(build(overview([master(), variant({ masterContentId: '' })])).contents[1].status, 'blocked', 'unique stable family supports legacy master-less linkage');
assert.equal(build(overview([master(), master({ contentId: 'duplicate' }), variant({ masterContentId: '' })])).contents[2].status, 'planned', 'ambiguous family must not select first master');
for (const change of [
  (data: any) => { data.contentQueue.items[0].lineage.goalId = 'foreign'; },
  (data: any) => { data.contentQueue.items[0].lineage.planId = 'old'; },
  (data: any) => { data.run.goal_id = 'foreign'; },
  (data: any) => { data.tasks[0].run_id = 'old'; },
  (data: any) => { data.contentQueue.items[0].contentId = 'other'; },
  (data: any) => { data.contentQueue.items.push(queue({ id: 'ambiguous' })); },
]) {
  const data = overview(); change(data);
  const result = build(data);
  assert.equal(result.contents[0].status, 'planned'); assert.equal(result.contents[1].status, 'planned');
}
console.log('Smart Business display title and shared-production tests passed');
