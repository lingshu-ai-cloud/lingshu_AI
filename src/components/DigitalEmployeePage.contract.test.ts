import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  agentCursorPercent,
  agentUiActionFromEvent,
  buildTaskDeepLink,
  digitalEmployeeConfigFingerprint,
  type DigitalEmployeeConfig,
  type PlanTask,
  type WorkflowTask,
} from '../lib/digitalEmployees.js';
import { nodeDeepLink } from './WeeklyExecutionNodes.js';

const pageSource = fs.readFileSync('src/components/DigitalEmployeePage.tsx', 'utf8');
const reviewSource = fs.readFileSync('src/components/WeeklyReviewPanel.tsx', 'utf8');
const insightSource = fs.readFileSync('src/lib/reviewInsights.ts', 'utf8');
const packageSource = fs.readFileSync('src/components/WeeklyPackagePanel.tsx', 'utf8');
const productionSource = fs.readFileSync('src/components/ProductionProgressPanel.tsx', 'utf8');
const boardSource = fs.readFileSync('src/components/DeliveryBoard.tsx', 'utf8');
const libSource = fs.readFileSync('src/lib/digitalEmployees.ts', 'utf8');
const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const assistantSource = fs.readFileSync('src/components/GlobalAssistant.tsx', 'utf8');
const revisionSource = fs.readFileSync('src/components/ProductionRevisionPanel.tsx', 'utf8');

assert.match(pageSource, /自动交付语言/);
assert.match(pageSource, /相同 sceneId 翻译、配音、加字幕和配乐/);
assert.match(pageSource, /需要你观看成片并做判断/, 'the quality gate must explain the exact human decision');
assert.match(pageSource, /查看成片并处理/, 'the quality gate must expose a direct review action');
assert.match(pageSource, /nodeDeepLink\(selectedPlanTask, selectedTask, data\.run\.id, data\.deliveries\)/, 'the production scene must use the delivery-enriched project deep link');
assert.match(revisionSource, /当前待验收成片/, 'the revision workspace must put the final video before editing controls');
assert.match(revisionSource, /<video[^>]+aria-label="当前待验收成片"/, 'the revision workspace must render the actual final video');
assert.match(revisionSource, /成片通过，确认当前版本/, 'the revision workspace must allow the user to complete the human quality decision');

for (const label of ['今天要做', '生产与交付', '任务执行', '复盘']) {
  assert.match(pageSource, new RegExp(label), `Digital Employee workspace must expose the ${label} view`);
}
for (const label of ['全链路经营', '内容增长', '客户转化', 'Facebook', 'Instagram', 'TikTok', 'YouTube']) {
  assert.match(pageSource, new RegExp(label), `business-line navigation must expose ${label}`);
}
assert.match(pageSource, /businessLine=\{businessLine\}[\s\S]{0,120}contentPlatform=\{contentPlatform\}/, 'overview and review panels must receive the shared business-line context');
assert.match(pageSource, /<DeliveryBoard[\s\S]{0,200}tasks=\{data\.run \? visibleTasks : \[\]\}/, 'the execution center must feed business-line-filtered persisted tasks into the kanban without fabricating pre-run tasks');
assert.match(insightSource, /knowledgeCandidates/, 'review must retain reviewable knowledge candidates');
assert.match(libSource, /contentPlatforms:[\s\S]{0,100}facebook[\s\S]{0,100}youtube/, 'weekly goals must persist the selected content-platform scope');
assert.doesNotMatch(pageSource, /aria-label="经营视角切换"[\s\S]{0,200}fixed bottom-5/, 'business-line switching must not cover dashboard content');
for (const label of ['生产与交付', '爆款裂变成片', '数字人成片', '待审核作品', '发布执行', '客户跟进执行']) {
  assert.match(productionSource, new RegExp(label), `production view must expose ${label}`);
}
for (const period of ['本周', '上周', '本月', '上月']) {
  assert.match(productionSource, new RegExp(period), `production view must support ${period}`);
}
assert.doesNotMatch(productionSource, /流量转化漏斗|平台贡献/, 'production must not duplicate the home results dashboard');
assert.doesNotMatch(pageSource, /<NextActionBanner[\s\S]{0,500}workspaceView === ["']today["']/, 'the overview must not mix its data center with the old task-oriented hero');
assert.match(pageSource, /Agent 设置/, 'Agent settings must remain available as a secondary management entry');
assert.match(pageSource, /workspaceView === "overview" && <BusinessLineNav/, 'legacy business filters belong only to production; review has insight categories');
assert.doesNotMatch(pageSource, /frontend_preview|BUSINESS_PREVIEW|PreviewExecutionPanel|示例数据预览中|查看示例数据/, 'the production cockpit must not contain or expose synthetic operating receipts');
assert.doesNotMatch(pageSource, /<dt className="inline text-slate-400">(?:目标版本|计划锁定配置)/, 'the operating context strip must not expose technical record metadata');
assert.match(libSource, /configSnapshot\?: DigitalEmployeeConfig/, 'the plan API contract must retain its immutable config snapshot');
assert.match(pageSource, /useState<WorkspaceView>\(["']today["']\)/, 'regular login must land on Today Overview by default');
assert.match(pageSource, /workspaceView === ["']today["'][\s\S]{0,5000}<TodayFocusPanel/, 'Today view must prioritize one next action before detailed operating data');
assert.match(pageSource, /workspaceView === ["']overview["'][\s\S]{0,5000}<ProductionProgressPanel/, 'Business progress must keep detailed operating data in a dedicated view');
assert.match(pageSource, /workspaceView === ["']live["'][\s\S]{0,25000}<ProductionScene/, 'Live Production must have its own render branch');
assert.match(pageSource, /workspaceView === ["']review["'][\s\S]{0,5000}<WeeklyReviewPanel/, 'Weekly Review must have its own render branch');
assert.match(pageSource, /workspaceView === ["']rules["'][\s\S]{0,8000}(?:OnboardingPanel|approvalPolicy|\u89c4\u5219)/, 'Rules and Permissions must have its own render branch');

for (const capability of ['\u793e\u5a92\u5b9a\u65f6\u4efb\u52a1', '\u4f7f\u7528\u7206\u6b3e', '\u7206\u6b3e\u88c2\u53d8', '\u4ea7\u54c1\u751f\u6210', '\u5185\u5bb9\u53d1\u5e03', '\u5ba2\u6237\u5206\u5c42', '\u6279\u91cf\u8ddf\u8fdb']) {
  assert.match(pageSource, new RegExp(capability), `task-flow map must expose ${capability}`);
}
assert.match(pageSource, /\u6570\u5b57\u5458\u5de5\u4efb\u52a1\u6d41\u8f6c\u56fe/, 'the business-native task-flow diagram must remain visible');
assert.match(pageSource, /displayedReadiness\.map[\s\S]{0,5000}item\.status === ["']ready["']/, 'first login must render readiness from saved facts and the latest business snapshot instead of inventing it');
assert.match(packageSource, /确认范围并启动/, 'first-run goal approval must expose the package scope confirmation');
assert.match(pageSource, /statusSourceLabel\[task\.statusSource\]/, 'plan preview must translate each task status source instead of collapsing every task to a generic placeholder');
assert.match(pageSource, /\/api\/overseas\/enterprise\/profile/, 'focus products must be loaded from the tenant enterprise knowledge profile');
assert.match(pageSource, /aria-multiselectable="true"/, 'focus product selector must expose a multi-select listbox');
assert.match(pageSource, /搜索企业知识库产品或型号/, 'focus product selector must support searching product names and models');

for (const label of ['\u8fd0\u884c\u4e2d', '\u9700\u8981\u6211\u51b3\u5b9a', '\u4eca\u65e5\u5b8c\u6210', '\u672a\u6765 24 \u5c0f\u65f6', '\u6570\u636e\u7f3a\u53e3']) {
  assert.match(pageSource, new RegExp(label), `Today Overview must include ${label}`);
}
assert.match(pageSource, /businessSnapshot/, 'today and weekly views must use the server business snapshot');
assert.match(pageSource, /status === ["']available["'][\s\S]{0,500}metric\?\.value/, 'business metrics may show numbers only when their source is available');
assert.match(pageSource, /\u5feb\u7167\u7f3a\u5931\uff0c\u4e0d\u80fd\u5224\u5b9a\u4e3a\u96f6\u7f3a\u53e3/, 'missing snapshots must not be presented as zero');

assert.match(pageSource, /Agent \u5b9e\u65f6\u751f\u4ea7\u73b0\u573a/, 'regular login must expose the live Agent production scene');
assert.match(pageSource, /displayedReadiness[\s\S]{0,3000}profileConfirmed[\s\S]{0,1200}knowledgeProducts\.length/, 'onboarding readiness must immediately reflect enterprise and product facts saved on the current page');
assert.match(pageSource, /\u6267\u884c\u4f9d\u636e/, 'the production scene must expose facts and execution evidence');
assert.doesNotMatch(pageSource, /\u601d\u8003\u4f9d\u636e|chain[_ -]?of[_ -]?thought/i, 'the UI must not claim to expose private model reasoning');
assert.match(pageSource, /EventTimeline/, 'the live scene must render persisted events');
assert.match(pageSource, /\u4e2d\u95f4\u4ea7\u7269/, 'the live scene must render intermediate task outputs');
assert.match(boardSource, /function DeliveryBoard/, 'execution center must render a real task kanban');
assert.match(boardSource, /onOpenTask\(\{ \.\.\.selected\.link!.*deliveryId: selected\.id/, 'delivery detail must open its resource-specific business page');
assert.match(pageSource, /onClick=\{\(\) => onOpenTask\(link\)\}/, 'clicking a task card must enter the mapped business workspace');
assert.match(pageSource, /task\.business_line[\s\S]{0,200}task\.business_domain/, 'business-line classification must prefer persisted fields');
assert.doesNotMatch(pageSource, /function taskBusinessLine[\s\S]{0,800}task_key/, 'task classification must not guess from task-key text');
assert.match(pageSource, /现场画面流尚未接入/, 'live view must disclose when real Agent UI telemetry is unavailable');
assert.match(pageSource, /不生成假鼠标动画/, 'the UI must not simulate fake mouse activity');
assert.match(libSource, /payload\?\.uiAction/, 'the Agent operation feed must consume persisted worker UI events');
const uiAction = agentUiActionFromEvent({ id: 'event-ui', run_id: 'run-1', task_id: 'task-1', sequence: 1, type: 'agent.ui.click', level: 'info', summary: '点击生成', occurred_at: new Date().toISOString(), payload: { uiAction: { kind: 'click', label: '点击生成', x: 640, y: 360, viewportWidth: 1280, viewportHeight: 720 } } });
assert.deepEqual(agentCursorPercent(uiAction), { left: 50, top: 50 }, 'worker pixel coordinates must map to a stable monitor cursor position');

for (const label of ['\u7ea0\u504f\u5f53\u524d\u4efb\u52a1', '\u4ec5\u672c\u6b21', '\u957f\u671f\u89c4\u5219\u5019\u9009', '\u91cd\u8dd1\u4e0b\u6e38\u4efb\u52a1', '\u4eba\u5de5\u5b8c\u6574\u63a5\u7ba1', '\u4ea4\u8fd8\u6570\u5b57\u5458\u5de5']) {
  assert.match(pageSource, new RegExp(label), `human control must expose ${label}`);
}
assert.match(pageSource, /digitalEmployeeApi\.correctTask\(/, 'submitting a correction must call the persisted correction endpoint');
assert.match(libSource, /correctTask:[\s\S]{0,350}instruction:[\s\S]{0,100}scope:[\s\S]{0,100}rerunDownstream/, 'correction API must preserve all three contract fields');

assert.match(insightSource, /status === 'available'/, 'review findings must use available receipts');
assert.match(pageSource, /\u6279\u51c6\u7684\u662f\u9010\u5ba2\u8349\u7a3f\u6279\u6b21\uff0c\u4e0d\u7b49\u4e8e\u6d88\u606f\u5df2\u7ecf\u53d1\u51fa/, 'batch approval must not be presented as delivery');
assert.match(pageSource, /\u53d1\u9001\u6267\u884c\u670d\u52a1\u5f53\u524d\u4e3a\u624b\u52a8\u89e6\u53d1\u6a21\u5f0f/, 'the batch panel must distinguish manual mode from a ready automatic worker');
assert.match(pageSource, /\u771f\u5b9e\u53d1\u9001\u56de\u6267/, 'the batch panel must wait for provider evidence');
assert.match(pageSource, /\u53d1\u9001\u5df2\u5230\u671f\u5ba2\u6237/, 'manual-only mode must expose an explicit due-item dispatch action');
assert.match(pageSource, /digitalEmployeeApi\.dispatchFollowupBatch/, 'the manual dispatch action must call the worker route');

assert.match(pageSource, /function ConversionFunnelChart/, 'overview must render a dedicated funnel chart');
assert.match(pageSource, /尚无可用数据，接入后显示真实数量与阶段比例/, 'the conversion visualization must explain missing data instead of fabricating a funnel');
assert.doesNotMatch(pageSource, /Agent \u7ecf\u8425\u8d21\u732e/, 'overview must remove the redundant Agent contribution action area');
for (const label of ['本期值得行动', '全部洞察', '判断依据', '建议下一步', '执行与交付记录']) {
  assert.ok(reviewSource.includes(label), `review must expose ${label}`);
}
assert.doesNotMatch(reviewSource, /经营归因|下周优先动作|方法论沉淀/, 'review must remove redundant generic advice sections');

function task(taskKey: string, kind = 'execution'): WorkflowTask {
  return {
    id: `task-${taskKey}`,
    run_id: 'run-1',
    task_key: taskKey,
    title: taskKey,
    description: '',
    agent_role: 'planner',
    kind,
    status: 'pending',
    sequence: 1,
    priority: 'medium',
    requires_approval: false,
    depends_on: [],
    output: {},
    blocked_reason: '',
    owner_id: '',
    updated_at: '2026-09-03T00:00:00.000Z',
  };
}

const collectionLink = buildTaskDeepLink(task('scheduled_source_collection'), undefined, 'run-1');
assert.deepEqual(
  { page: collectionLink.page, view: collectionLink.view, runId: collectionLink.runId, taskId: collectionLink.taskId },
  { page: 'scheduled', view: undefined, runId: 'run-1', taskId: 'task-scheduled_source_collection' },
  'scheduled source collection must deep-link to Scheduler with run and task context',
);

const publishPlan: PlanTask = {
  key: 'publishing_calendar', title: 'Publishing calendar', description: '', agentRole: 'publishing', kind: 'activation', sequence: 9,
  priority: 'high', requiresApproval: false, dependsOn: ['content_release_approval'], expectedMinutes: 1,
  businessDomain: 'publishing', capabilityKey: 'publishing.calendar', destination: 'smartAssets', destinationView: 'publish',
  statusSource: 'posts.stats.status', executionMode: 'observe', externalEffect: 'schedule',
};
const publishLink = buildTaskDeepLink(task('publishing_calendar', 'activation'), publishPlan, 'run-2');
assert.equal(publishLink.page, 'smartAssets');
assert.equal(publishLink.view, 'publish', 'publishing calendar must not be confused with Scheduler');
assert.equal(publishLink.businessRef.capabilityKey, 'publishing.calendar');
assert.equal(publishLink.businessRef.statusSource, 'posts.stats.status');

const contentLink = buildTaskDeepLink(task('content_production', 'production'), undefined, 'run-content');
assert.equal(contentLink.page, 'smartAssets');
assert.equal(contentLink.view, 'create');
assert.equal(contentLink.studioPanel, 'projects', 'content production must enter the task project list instead of a remembered draft');

const qualityLink = buildTaskDeepLink({
  ...task('content_quality_gate', 'analysis'),
  status: 'failed',
  business_refs: [{ type: 'studio_project', id: 'failed-project', stage: 'blocked' }],
}, undefined, 'run-content');
assert.equal(qualityLink.page, 'smartAssets');
assert.equal(qualityLink.studioPanel, 'projects', 'quality failures must enter the task project list');
assert.equal(qualityLink.businessRef.entityId, 'failed-project', 'quality failures must open the affected project');
assert.equal(qualityLink.businessRef.deliveryId, 'studio_project:failed-project');

const recoveredQualityLink = nodeDeepLink(
  { key: 'content_quality_gate', title: '质量门', description: '', agentRole: 'content', kind: 'analysis', sequence: 7, priority: 'high', requiresApproval: false, dependsOn: ['content_production'], expectedMinutes: 1 },
  task('content_quality_gate', 'analysis'),
  'run-content',
  [{ id: 'studio_project:legacy-project', taskIds: ['task-content_quality_gate'], taskId: 'task-content_production', runId: 'run-content', kind: '内容成片', title: '旧运行成片', subject: '', acceptance: '', stage: '', column: 'human', reason: '', exception: true, updatedAt: '2026-09-03T00:00:00.000Z', artifacts: [], steps: [], actionLabel: '修正制作内容', effect: '', metrics: [] }],
);
assert.equal(recoveredQualityLink.businessRef.entityId, 'legacy-project', 'legacy quality tasks recover their project from the delivery board');

const customerLink = buildTaskDeepLink(task('followup_batch_draft'), undefined, 'run-3');
assert.equal(customerLink.page, 'conversion', 'customer segmentation and follow-up must open the existing customer workspace');
assert.equal(customerLink.businessRef.taskKey, 'followup_batch_draft');

assert.match(libSource, /workflowRunId:\s*link\.runId/, 'Studio navigation must carry an explicit workflow run id');
assert.match(libSource, /workflowTaskId:\s*link\.taskId/, 'Studio navigation must carry an explicit workflow task id');
assert.match(libSource, /CustomEvent\(["']lingshu:navigate["'],\s*\{\s*detail:\s*navigationDetail\s*\}\)/, 'deep-link navigation must emit the full workflow/business reference');
assert.match(appSource, /setSmartAssetsView\(detail\.view === ["']publish["'] \? ["']publish["'] : ["']create["']\)/, 'the application shell must honor create versus publish deep links');

for (const label of ['已启用', '未启用', '依赖客户分层', '至少启用一条工作流', '保存为后续运行规则']) {
  assert.match(pageSource, new RegExp(label), `workflow configuration must explain ${label}`);
}
assert.match(pageSource, /素材不足时允许生成 AI 画面/, 'generated visuals must require an explicit user-facing opt-in');
assert.match(pageSource, /allowGeneratedVisuals:\s*false/, 'generated visuals must default to fail-closed');
assert.match(pageSource, /禁止虚构产品外观、参数与效果/, 'the opt-in must still explain its product-truthfulness boundary');
assert.match(pageSource, /setWorkspaceView\(["']live["']\)[\s\S]{0,500}setSelectedTaskId/, 'approving a plan must focus the live production scene');
assert.match(pageSource, /scrollIntoView\([\s\S]{0,120}behavior:\s*["']smooth["']/, 'first-run transitions must focus the next required panel');
assert.doesNotMatch(pageSource, /setProductStepSaved\(Boolean\(form\.focusProducts\.trim\(\)\)\)/, 'saving the enterprise profile must not skip explicit focus-product confirmation');
assert.match(pageSource, /digitalEmployeeOnboarding:\s*\{\s*profileConfirmedAt:/, 'the first-step confirmation must be persisted instead of living only in component memory');
assert.match(pageSource, /digitalEmployeeOnboarding:\s*\{\s*productSelectionConfirmedAt:[\s\S]{0,160}continuedWithoutProducts:\s*true/, 'the explicit no-product decision must survive a refresh without inventing a product');
assert.match(pageSource, /if \(profile\.digitalEmployeeOnboarding\?\.profileConfirmedAt\) setProfileConfirmed\(true\)/, 'persisted onboarding progress must restore step two after a remount');
assert.match(pageSource, /!data\?\.config \|\|[\s\S]{0,250}viewGoalId \|\|[\s\S]{0,250}!run/, 'first-time onboarding must not subscribe to an obsolete run stream');
assert.match(pageSource, /overviewRequestVersionRef/, 'late overview responses must be versioned so they cannot overwrite a completed mutation');
assert.doesNotMatch(pageSource, /第四步/, 'onboarding must end after Agent rules are confirmed in step three');
assert.doesNotMatch(pageSource, /rulesStepSaved/, 'onboarding must not keep a redundant fourth-step state');
assert.match(pageSource, /activeRun && newGoal[\s\S]{0,120}setNewGoal\(false\)/, 'an active run must close any duplicate goal form');
assert.match(pageSource, /完成或取消当前运行后才能制定下一周目标/, 'the UI must explain why a second active goal is unavailable');
assert.match(pageSource, /requiredReadiness[\s\S]{0,300}firstMissingReadiness/, 'plan approval must derive its blocker from real resource readiness');
assert.match(packageSource, /issues.length > 0/, 'invalid packages must block launch and explain missing dependencies');
assert.match(pageSource, /<WeeklyPackagePanel/, 'the execution view must expose the editable weekly business package');
assert.doesNotMatch(pageSource, /required\.add\(["'](?:products|viral_library|customers)["']\)/, 'new tenants must not be blocked from starting merely because products, inspiration, or customers are still empty');

for (const label of ['重试任务', '跳过并继续', '登记人工完成', '任务受阻，需要处理']) {
  assert.match(pageSource, new RegExp(label), `blocked-task controls must expose ${label}`);
}
assert.equal(
  (pageSource.match(/<BlockedTaskActions/g) || []).length,
  1,
  'the selected task must render exactly one retry/skip/manual-complete action block',
);
for (const endpoint of ['retryTask', 'skipTask', 'completeTask']) {
  assert.match(libSource, new RegExp(`${endpoint}:[\\s\\S]{0,250}/tasks/`), `${endpoint} must call the canonical task route`);
}
assert.match(pageSource, /const saved = await onSubmit[\s\S]{0,500}纠偏尚未登记/, 'correction input must only clear after a persisted success');
assert.match(libSource, /digitalEmployee\.returnContext/, 'business deep links must persist a return-to-live context');
assert.match(pageSource, /consumeDigitalEmployeeReturnContext/, 'returning from a business workspace must restore the production task context');
assert.match(pageSource, /完成业务操作后返回“数字员工”即可继续/, 'business CTAs must tell the user how to return');
assert.match(reviewSource, /liveReview/, 'an active run must use the server live review rather than fake a final review');
assert.match(reviewSource, /本轮仍在运行，以下为阶段性发现/, 'the review view must label active-run results as provisional');
assert.match(productionSource, /aria-label="生产统计周期"/, 'the overview period selector must expose an accessible group label');
assert.match(productionSource, /aria-pressed=\{period === id\}/, 'the selected overview period must be machine-readable');
assert.match(pageSource, /dispatch\?\.blocked_reason/, 'the follow-up truth panel must display the server preflight field from dispatch preflight');
assert.match(pageSource, /manualFollowupSendAllowed/, 'the manual send CTA must be gated by the tenant/provider authorization facts');
assert.match(pageSource, /真实发送未就绪/, 'the UI must state that real sending is unavailable instead of implying it only waits for time or receipt');
assert.doesNotMatch(pageSource, /sticky top-2 z-40/, 'workspace navigation must scroll with the page instead of covering operating data');
assert.match(assistantSource, /page === 'digitalEmployees'[\s\S]{0,100}mode === 'breathing'[\s\S]{0,100}z-\[35\]/, 'the idle assistant must stay below Digital Employee core navigation');

const fingerprintConfig: DigitalEmployeeConfig = {
  companyName: '灵枢', industry: '制造', primaryBusiness: '设备', targetMarkets: '美国', customerProfile: '经销商',
  autonomyMode: 'managed', approvalOwner: '负责人', constraints: ['真实发布必须审批'], team: ['planner'],
  primaryGoal: 'leads', focusProducts: '产品 A', enabledWorkflows: ['scheduled_social'], socialCadence: '每天 09:00',
  followupCadence: '每周五', reviewSchedule: '每周五 17:30',
  publishingTargets: [], allowGeneratedVisuals: false, allowRealPublishing: false, allowRealCustomerMessages: false,
  approvalPolicy: { contentPublish: true, batchFollowup: true, commercialCommitment: true },
  agentApprovalPolicies: {
    business: { activatePlan: true, changeGoalScope: true },
    industry: { addUnverifiedSource: true, expandCollectionScope: true },
    content: { contentPublish: true, factualClaims: true },
    customer: { batchFollowup: true, commercialCommitment: true },
  },
};
const fingerprint = digitalEmployeeConfigFingerprint(fingerprintConfig);
assert.match(fingerprint, /^CFG-[0-9A-F]{6}$/, 'a persisted config snapshot must have a compact deterministic display identifier');
assert.equal(digitalEmployeeConfigFingerprint({ ...fingerprintConfig }), fingerprint, 'equivalent config snapshots must keep the same display identifier');
assert.notEqual(digitalEmployeeConfigFingerprint({ ...fingerprintConfig, targetMarkets: '德国' }), fingerprint, 'material config changes must produce a different display identifier');

console.log('DigitalEmployeePage contract tests passed');

for (const key of ['content_release_approval', 'publishing_calendar', 'platform_publish']) {
  const stale = { ...task(key, 'activation'), destination: 'smartAssets' as const, destination_view: 'create' as const };
  assert.equal(buildTaskDeepLink(stale, undefined, 'run-publish').view, 'publish', `${key} must open publishing despite an obsolete create destination`);
}
