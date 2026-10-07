import assert from 'node:assert/strict';
import { buildDirectorContextView } from './DirectorTaskContext';
import type { DigitalEmployeeDeepLink, DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { applyDirectorDecision } from '../lib/directorDecision';

const overview = {
  goal: { title: '西班牙市场获客', startsAt: '2026-09-14', endsAt: '2026-09-20' },
  plan: { businessPackage: {
    directorPlan: { currency: 'CNY', productionBudget: 1000, paidMediaBudget: 2000, productionReserved: 200, productionSpent: 300, originalTarget: 2, platformVersionTarget: 4, publishTarget: 6, collectionBrief: '采集安装问答', qualityStandard: '主张有实拍证据', progress: [{ id: 'p1', title: '热点筛选', status: 'approved', result: '保留安装问题', nextStep: '完成脚本', owner: 'director', updatedAt: '2026-09-15', estimatedCost: 0, actualCost: 0 }] },
    tasks: [{ templateId: 'production', videoPlans: [{ contentId: 'content-2', route: 'product', productName: 'CNC bracket', theme: '安装应用', buyerProblem: '如何选择安装规格？', evidenceRequirement: '展示孔距测量', directorStatus: 'script_approved', estimatedCost: 120, language: 'es', duration: 30, platform: 'youtube', materialIds: [], referenceId: '', presenter: 'material', heygenAvatarId: '', avatarConsent: false, voice: 'v1' }] }],
  } },
  tasks: [{ id: 'task-1', task_key: 'content_mode_routing', title: '编排脚本', status: 'running', blocked_reason: '', output: { orders: [{ videoPlan: { contentId: 'content-2' }, scripts: { es: { version: 2, hash: 'abcdef123456' } } }] } }],
} as unknown as DigitalEmployeeOverview;
const link = { page: 'scriptLibrary', runId: 'run-1', taskId: 'task-1', businessRef: { taskKey: 'content_mode_routing', contentId: 'content-2' } } satisfies DigitalEmployeeDeepLink;

const view = buildDirectorContextView(overview, link);
assert.ok(view);
assert.equal(view.scope, 'content');
assert.equal(view.content?.buyerProblem, '如何选择安装规格？');
assert.equal(view.content?.evidenceRequirement, '展示孔距测量');
assert.equal(view.productionBudget - view.productionSpent - view.productionReserved, 500);
assert.deepEqual([view.originalTarget, view.platformVersionTarget, view.publishTarget], [2, 4, 6]);
assert.equal(view.stage, '详细选题与经营排期');
assert.equal(view.status, '进行中');
assert.equal(view.progress[0]?.nextStep, '完成脚本');
assert.deepEqual(view.scriptVersions, [{ language: 'es', version: 2, hash: 'abcdef123456' }]);

const weekly = buildDirectorContextView(overview, { ...link, businessRef: { taskKey: 'viral_analysis', contentId: 'missing' } });
assert.equal(weekly?.scope, 'week');
const pack = overview.plan!.businessPackage!;
const adjusted = applyDirectorDecision({ pack, contentId: 'content-2', decision: 'adjust', reason: 'insufficient_evidence', now: '2026-09-15T00:00:00.000Z' });
assert.equal(adjusted.pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.[0]?.directorStatus, 'candidate');
assert.match(adjusted.pack.directorPlan?.progress.at(-1)?.result || '', /证据不足/);
const abandoned = applyDirectorDecision({ pack, contentId: 'content-2', decision: 'abandon', reason: 'buyer_mismatch', now: '2026-09-15T00:00:00.000Z' });
const replacement = abandoned.pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.[0];
assert.match(replacement?.contentId || '', /^auto-/);
assert.equal(replacement?.theme, '等待编导 Agent 自动补位');
assert.equal(abandoned.pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.length, 1, 'abandon must preserve the weekly output slot');
console.log('director task context mapping tests passed');
