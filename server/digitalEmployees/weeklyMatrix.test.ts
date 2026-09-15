import assert from 'node:assert/strict';
import { bindMatrixVideo, fillMatrixVideos, matrixIssues, matrixScopeIssues, normalizeMatrixPlan, type MatrixAccountPlan } from '../../src/lib/weeklyMatrix.js';
import { normalizeVideoPlan } from '../../src/lib/videoCreationPlan.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { normalizePackage, validatePackage } from './weeklyPackage.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { buildContentBatchPlan } from './contentBatchPlan.js';
import { expandContentOrdersByLanguage } from './contentProduction.js';
import { buildPublishingApprovalPackage as buildPublishingApprovalPackageRaw } from './publishingExecution.js';
import type { FrozenPublishSourceClaim } from '../publishing/publishSourceClaim.js';

const buildPublishingApprovalPackage = (input: Parameters<typeof buildPublishingApprovalPackageRaw>[0]) => buildPublishingApprovalPackageRaw(input, {
  sourceClaim: (_tenantId, project, videoPath) => ({ schemaVersion: 1, sourceKind: 'digital_employee_project', projectId: project.id, sourceVideoPath: videoPath, deliveryVideoPath: videoPath, generationKind: 'digital_employee', generationProvenance: 'digital_employee', qualityStatus: 'passed', publishable: true, generationRecordId: project.id, sourceFingerprint: `fixture:${project.id}:${videoPath}` }) satisfies FrozenPublishSourceClaim,
});
import { summarizeWeeklyMatrix } from './weeklyMatrixReview.js';

const row = (id: string, overrides: Partial<MatrixAccountPlan> = {}): MatrixAccountPlan => ({ accountId: id, platform: 'facebook', audience: '批发买家', productName: '产品 A', language: 'en', objective: '获得合作咨询', contentDirection: '产品选型', cta: '联系业务人员', weeklyCount: 1, sourceProjectIds: [], ...overrides });
const rows = [row('a'), row('b', { language: 'es', audience: '零售买家', objective: '增加互动', contentDirection: '使用场景' })];
const targets = rows.map(r => ({ accountId: r.accountId, platform: r.platform, accountLabel: r.accountId }));
const base: WeeklyPackage = { revision: 1, maturity: 'growing', participation: 'agent', matrixPlan: rows, authorization: { mode: 'each', accountIds: ['a', 'b'], maxPublishItems: 2, customerIds: [], maxCustomerMessages: 0 }, tasks: [{ templateId: 'publishing', title: '发布', dueAt: '2026-09-20', ownerId: '', ownerName: '', notes: '', sourceProjectIds: [] }] };
const filled = fillMatrixVideos(base, {}, '2026-09-20');
assert.equal(base.tasks.length, 1, 'editing a draft must not mutate the saved package');
assert.deepEqual(matrixIssues(filled), []);
assert.deepEqual(fillMatrixVideos(filled, {}, '2026-09-20'), filled, 'repeated sync must not duplicate deliverables');
const multiple = fillMatrixVideos({ ...base, matrixPlan: [row('a', { weeklyCount: 3 })] }, {}, '2026-09-20');
assert.equal(new Set(multiple.tasks.find(t => t.templateId === 'production')!.videoPlans!.map(plan => plan.theme)).size, 3, 'several videos for one account need distinct editable theme directions');
const pack = normalizePackage(JSON.parse(JSON.stringify(filled)));
const plans = pack.tasks.find(t => t.templateId === 'production')!.videoPlans!;
assert.deepEqual(plans.map(p => [p.matrix?.accountId, p.language]), [['a', 'en'], ['b', 'es']]);
assert.ok(matrixScopeIssues(pack, [targets[0]], ['facebook']).length, 'foreign/unselected accounts must fail');
assert.ok(matrixScopeIssues(pack, targets, ['youtube']).length, 'goal platform scope must be checked');
assert.throws(() => normalizeMatrixPlan(Array(31).fill(rows[0])));
assert.ok(matrixIssues({ ...pack, matrixPlan: [rows[0], rows[0]] }).length);
assert.ok(matrixIssues({ ...pack, authorization: { ...pack.authorization, accountIds: ['a'] } }).length);
assert.ok(matrixIssues({ ...pack, matrixPlan: [row('a', { weeklyCount: 2 }), rows[1]] }).length);
const edited = normalizeVideoPlan({ ...plans[0], theme: '手工确认主题', materialIds: ['asset-a'] });
assert.equal(bindMatrixVideo(edited, row('a', { audience: '新受众' })).theme, '手工确认主题');
assert.deepEqual(bindMatrixVideo(edited, row('a', { productName: '产品 B' })).materialIds, [], 'changing product must not retain old product material bindings');
assert.equal(bindMatrixVideo(edited).matrix?.accountId, '', 'unbinding explicitly makes content production-only');

const config = normalizeDigitalEmployeeConfig({ companyName: '测试公司', focusProducts: '产品 A', enabledWorkflows: ['product_content', 'content_publish'], publishingTargets: targets, videoLanguages: ['en', 'zh'], socialCadence: '' });
const goal = normalizeWeeklyGoal({ contentPlatforms: ['facebook'], videoPlans: plans, startsAt: '2026-09-14', endsAt: '2026-09-20' }, config);
assert.deepEqual(validatePackage(pack, goal, config), []);
const batch = buildContentBatchPlan({ goalId: 'goal', goal, config, evidence: { products: [{ id: 'prod', name: '产品 A', materialIds: ['material'] }], exactAnalysisIds: [], materialIds: ['material'] }, versions: { configVersion: 1, policyVersion: '1', factsVersion: '1' } });
assert.equal(batch.status, 'planned', batch.blocker);
assert.deepEqual(batch.orders.map(o => [o.accountId, o.cta, o.languages]), [['a', rows[0].cta, ['en']], ['b', rows[1].cta, ['es']]]);
const directedPlans = plans.map((plan, index) => index ? plan : normalizeVideoPlan({ ...plan, buyerProblem: '如何核对安装尺寸', evidenceRequirement: '真实卡尺测量与产品型号同框' }));
const directedBatch = buildContentBatchPlan({ goalId: 'goal', goal: { ...goal, videoPlans: directedPlans }, config, evidence: { products: [{ id: 'prod', name: '产品 A', materialIds: ['material'] }], exactAnalysisIds: [], materialIds: ['material'] }, versions: { configVersion: 1, policyVersion: '1', factsVersion: '1' } });
assert.ok(directedBatch.orders[0].constraints.includes('必须回答的买家问题：如何核对安装尺寸'));
assert.ok(directedBatch.orders[0].constraints.includes('必须呈现并核验的证据：真实卡尺测量与产品型号同框'));
const orders = expandContentOrdersByLanguage(batch.orders, config);
assert.equal(orders.length, 2, 'matrix languages must not expand to global language defaults');
const projects = orders.map((order, i) => ({ id: `project-${i}`, status: 'completed', spec: { contentOrder: order, renderOutputPath: `/final-${i}.mp4` } }));
const input = { tenantId: 'weekly-matrix-test', projects, targets, goalPlatforms: ['facebook' as const], allowRealPublishing: false, matrixPlan: rows, now: new Date('2026-09-14T01:00:00Z'), scheduling: { startsAt: '2026-09-14', endsAt: '2026-09-20', timezone: 'Asia/Shanghai' as const } };
const publishing = buildPublishingApprovalPackage(input);
assert.deepEqual(publishing.items.map(p => [p.sourceProjectId, p.accountIds]), [['project-0', ['a']], ['project-1', ['b']]], 'two accounts on one platform must not cross-publish');
assert.equal(publishing.items[0].scheduledAt, publishing.items[1].scheduledAt, 'each account has an independent calendar');
const datedProjects = [{ ...projects[0], spec: { ...projects[0].spec, contentOrder: { ...(projects[0].spec as any).contentOrder, videoPlan: { ...plans[0], plannedPublishDate: '2026-09-18' } } } }];
assert.equal(buildPublishingApprovalPackage({ ...input, projects: datedProjects, matrixPlan: [rows[0]] }).items[0].scheduledAt, '2026-09-18T12:00:00.000Z', 'confirmed matrix date must reach the publishing approval subject');
assert.equal(buildPublishingApprovalPackage({ ...input, targets: [] }).items.length, 0);
assert.equal(buildPublishingApprovalPackage({ ...input, projects: [{ id: 'unassigned', spec: { renderOutputPath: '/final.mp4' } }] }).items.length, 0, 'unassigned works must never be broadcast in matrix mode');
const reused = { id: 'existing', status: 'completed', spec: { renderOutputPath: '/existing.mp4' } };
const reuseRows = rows.map(r => ({ ...r, sourceProjectIds: ['existing'] }));
assert.deepEqual(buildPublishingApprovalPackage({ ...input, projects: [reused], matrixPlan: reuseRows }).items.map(p => p.accountIds), [['a'], ['b']], 'explicit reusable-work assignments can target several accounts');
assert.notEqual(buildPublishingApprovalPackage({ ...input, projects: [reused], matrixPlan: [reuseRows[0]] }).contentHash, buildPublishingApprovalPackage({ ...input, projects: [reused], matrixPlan: reuseRows }).contentHash, 'account changes must change the approval subject');
assert.equal(buildPublishingApprovalPackage({ ...input, matrixPlan: undefined, projects: [reused] }).items.flatMap(item => item.accountIds).length, 2, 'legacy packages retain their approved distribution model');
const multilingual = { ...reused, spec: { languageRenderOutputs: { en: { status: 'done', path: '/en.mp4' }, es: { status: 'done', path: '/es.mp4' } } } };
assert.deepEqual(buildPublishingApprovalPackage({ ...input, projects: [multilingual], matrixPlan: reuseRows }).items.map(item => [item.accountIds[0], item.videoPath]), [['a', '/en.mp4'], ['b', '/es.mp4']], 'existing multilingual works must use the account language');
assert.throws(() => buildPublishingApprovalPackage({ ...input, projects: [{ ...reused, spec: { lang: 'en', renderOutputPath: '/en.mp4' } }], matrixPlan: reuseRows }), /语言与账号安排不一致/);
const secondPlatform = { accountId: 'yt', accountLabel: 'YouTube', platform: 'youtube' as const };
assert.deepEqual(buildPublishingApprovalPackage({ ...input, matrixPlan: undefined, scheduling: undefined, projects: [multilingual], targets: [targets[0], secondPlatform], goalPlatforms: ['facebook', 'youtube'] }).items.map(item => [item.videoPath, item.platform]), [['/en.mp4','facebook'],['/en.mp4','youtube'],['/es.mp4','facebook'],['/es.mp4','youtube']], 'legacy approved item ordering must stay stable');

const posts = [
  { id: 'post-a', platform: 'facebook', wa_link: 'https://wa.me/example', inquiries: 0, stats: { sourceProjectId: 'project-0', targetAccountIds: ['a'], status: 'published', publishResults: { a: { status: 'published', platformPostId: 'receipt-a' } }, views: 0, likes: 0, comments: 0, shares: 0 } },
  { id: 'post-b', platform: 'facebook', stats: { sourceProjectId: 'project-1', targetAccountIds: ['b'], status: 'scheduled' } },
];
const review = summarizeWeeklyMatrix(rows, projects, posts);
assert.deepEqual(review.map(r => [r.produced, r.published, r.views, r.inquiries]), [[1, 1, 0, 0], [1, 0, null, null]], 'real zero, missing data and unconfirmed publication must remain distinct');
assert.equal(summarizeWeeklyMatrix(rows, projects, [...posts, { ...posts[0], id: 'duplicate-receipt' }])[0].published, 1);
assert.match(summarizeWeeklyMatrix(rows, projects, [], false)[0].recommendation, /制作安排已完成/, 'content-only packages must not be marked incomplete for missing publication');
const grouped = { id: 'group', platform: 'facebook', stats: { sourceProjectId: 'existing', targetAccountIds: ['a', 'b'], views: 100, publishResults: { a: { status: 'published', platformPostId: 'only-a' } } } };
assert.deepEqual(summarizeWeeklyMatrix(reuseRows, [reused], [grouped]).map(r => [r.published, r.views]), [[1, null], [0, null]], 'grouped metrics and one account receipt must not leak to the other account');
console.log('Weekly matrix planning → production → account publishing → review tests passed');
