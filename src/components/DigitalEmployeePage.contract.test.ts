import { readDigitalEmployeeApplicationSources } from '../../tests/fixtures/digitalEmployeeApplicationSources.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  agentCursorPercent,
  agentUiActionFromEvent,
  buildTaskDeepLink,
  digitalEmployeeApi,
  digitalEmployeeConfigFingerprint,
  enterpriseFactsRebuildInput,
  type DigitalEmployeeConfig,
  type PlanTask,
  type WorkflowTask,
} from '../lib/digitalEmployees.js';
import { DigitalEmployeeApiError } from '../lib/digitalEmployeeApi.js';
import { nodeDeepLink } from './WeeklyExecutionNodes.js';

const pageShellSource = fs.readFileSync('src/components/DigitalEmployeePage.tsx', 'utf8');
const configuredWorkspaceSource = fs.readFileSync('src/components/ConfiguredDigitalEmployeeWorkspace.tsx', 'utf8');
const pageSource = pageShellSource + '\n' + configuredWorkspaceSource;
assert.match(pageShellSource, /const overviewData: DigitalEmployeeOverview = data \|\| \{[\s\S]{0,300}businessSnapshot: null/, 'failed or unconfigured tenants must still mount an explicit empty overview');
assert.match(pageShellSource, /const configuredData: DigitalEmployeeOverview = overviewData\.config \? overviewData : \{ \.\.\.overviewData, config: EMPTY_CONFIG \}/, 'unconfigured tenants must still mount the complete overview with explicit empty data');
assert.match(pageShellSource, /<ConfiguredDigitalEmployeeWorkspace[\s\S]{0,180}data: configuredData/, 'configured and unconfigured tenants must share the same overview surface');
assert.match(pageShellSource, /ConfiguredDigitalEmployeeWorkspace, statusLabel/, 'assistant context and configured workspace must share one task status vocabulary');
const weeklyStartValidationSource = fs.readFileSync('src/lib/weeklyStartValidation.ts', 'utf8');
const weeklyStartConflictAlertSource = fs.readFileSync('src/components/WeeklyStartConflictAlert.tsx', 'utf8');
const onboardingPanelSource = fs.readFileSync('src/components/smartBusiness/DigitalEmployeeOnboardingPanel.tsx', 'utf8');
const onboardingStepsSource = fs.readFileSync('src/components/smartBusiness/DigitalEmployeeOnboardingSteps.tsx', 'utf8');
assert.match(pageSource, /import \{ OnboardingPanel \} from '\.\/smartBusiness\/DigitalEmployeeOnboardingPanel'/, 'the page must mount the extracted onboarding state and save boundary');
assert.match(pageSource, /<OnboardingPanel[\s\S]{0,800}onSave=/, 'the extracted onboarding panel must keep the page-owned save callback');
assert.doesNotMatch(pageSource, /function OnboardingPanel\(/, 'the oversized page must not retain a second onboarding implementation');
const onboardingProductImportSource = fs.readFileSync('src/components/smartBusiness/onboardingProductImport.ts', 'utf8');
const enterpriseOnboardingContractSource = fs.readFileSync('shared/contracts/enterpriseOnboarding.ts', 'utf8');
const enterpriseOnboardingConfirmationSource = fs.readFileSync('server/digitalEmployees/enterpriseOnboardingConfirmation.ts', 'utf8');
const enterpriseOnboardingDraftRouteSource = fs.readFileSync('server/routes/enterpriseOnboardingDraft.ts', 'utf8');
const batchFollowupSource = fs.readFileSync('src/components/smartBusiness/BatchFollowupTruthPanel.tsx', 'utf8');
const todayFocusSource = fs.readFileSync('src/components/smartBusiness/DigitalEmployeeTodayFocusPanel.tsx', 'utf8');
const weeklyPlanConfirmationSource = fs.readFileSync('src/components/WeeklyPlanConfirmationCard.tsx', 'utf8');
const weeklyGoalPanelSource = fs.readFileSync('src/components/smartBusiness/WeeklyGoalPanel.tsx', 'utf8');
const smartBusinessSource = fs.readFileSync('src/components/SmartBusinessDashboard.tsx', 'utf8');
const businessDataReviewSource = fs.readFileSync('src/components/smartBusiness/BusinessDataReview.tsx', 'utf8');
const businessDataReviewModelSource = fs.readFileSync('src/components/smartBusiness/BusinessDataReview.model.ts', 'utf8');
const socialPlatformIconSource = fs.readFileSync('src/components/SocialPlatformIcon.tsx', 'utf8');
const smartBusinessModelSource = fs.readFileSync('src/components/smartBusiness/smartBusinessDisplayModel.ts', 'utf8');
const weeklyPlanPresentationSource = fs.readFileSync('src/components/smartBusiness/WeeklyPlanPresentation.tsx', 'utf8');
const taskPreviewCardsSource = fs.readFileSync('src/components/smartBusiness/TaskPreviewCards.tsx', 'utf8');
const smartBusinessFeatureSource = smartBusinessSource + smartBusinessModelSource + taskPreviewCardsSource;
const presentationPolicySource = fs.readFileSync('src/lib/digitalEmployeePresentationPolicy.ts', 'utf8');
const digitalEmployeeWorkspaceSource = fs.readFileSync('src/components/smartBusiness/DigitalEmployeeWorkspace.tsx', 'utf8');
const matrixScheduleSource = fs.readFileSync('src/components/smartBusiness/MatrixWorkSchedule.tsx', 'utf8');
const agentWeeklyCalendarSource = fs.readFileSync('src/components/smartBusiness/AgentWeeklyCalendar.tsx', 'utf8');
const restoredAgentWorkCalendarSource = fs.readFileSync('src/components/smartBusiness/RestoredAgentWorkCalendar.tsx', 'utf8');
const connectedAgentCalendarSource = fs.readFileSync('src/components/smartBusiness/ConnectedAgentCalendar.tsx', 'utf8');
const initialOperatingPlanSource = fs.readFileSync('src/components/InitialOperatingPlanDialog.tsx', 'utf8');
const socialContentStageOnboardingSource = fs.readFileSync('src/components/socialContent/SocialContentStageOnboarding.tsx', 'utf8');
const initialPreparationSource = fs.readFileSync('src/components/InitialPreparationStatusPanel.tsx', 'utf8');
const weeklyPlanCalendarSource = fs.readFileSync('src/components/smartBusiness/WeeklyPlanCalendar.tsx', 'utf8');
const accountRailSource = fs.readFileSync('src/components/SmartOperationsAccountRail.tsx', 'utf8');
const nextRoundRecommendationsSource = fs.readFileSync('src/components/NextRoundRecommendationsSection.tsx', 'utf8');
const planHistorySource = fs.readFileSync('src/components/PlanHistoryDialog.tsx', 'utf8');
const socialPerformanceSource = fs.readFileSync('src/lib/socialPerformance.ts', 'utf8');
const inspirationSource = fs.readFileSync('src/components/InspirationDashboard.tsx', 'utf8');
const inspirationReferenceResolverSource = fs.readFileSync('src/components/inspiration/inspirationReferenceResolver.ts', 'utf8');
const competitorAccountsSource = fs.readFileSync('src/components/CompetitorAccountsModal.tsx', 'utf8');
const reviewSource = fs.readFileSync('src/components/WeeklyReviewPanel.tsx', 'utf8');
const insightSource = fs.readFileSync('src/lib/reviewInsights.ts', 'utf8');
const packageSource = fs.readFileSync('src/components/WeeklyPackagePanel.tsx', 'utf8');
const productionSource = fs.readFileSync('src/components/ProductionProgressPanel.tsx', 'utf8');
const liveSceneSource = fs.readFileSync('src/components/ProductionTaskScene.tsx', 'utf8');
const boardSource = fs.readFileSync('src/components/DeliveryBoard.tsx', 'utf8');
const libSource = fs.readFileSync('src/lib/digitalEmployees.ts', 'utf8');
const digitalEmployeeNavigationSource = fs.readFileSync('src/lib/digitalEmployeeNavigation.ts', 'utf8');
const digitalEmployeeApiSource = fs.readFileSync('src/lib/digitalEmployeeApi.ts', 'utf8');
const weeklyWorkStatusAdapterSource = fs.readFileSync('src/lib/weeklyWorkStatus.ts', 'utf8');
const weeklyWorkStatusSource = fs.readFileSync('shared/weekly-work-status.mjs', 'utf8');
assert.match(weeklyWorkStatusAdapterSource, /import \{ weeklyWorkStatus as project \} from '\.\.\/\.\.\/shared\/weekly-work-status\.mjs'/, 'the desktop weekly status must use the shared authoritative projection');
assert.match(weeklyWorkStatusAdapterSource, /return project\(data\)/, 'the desktop adapter must delegate the complete overview to the shared projection');
const weeklyWorkEventsSource = fs.readFileSync('src/lib/weeklyWorkEvents.ts', 'utf8');
const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const appPageSlotSource = fs.readFileSync('src/AppPageSlot.tsx', 'utf8');
const layoutSource = fs.readFileSync('src/components/Layout.tsx', 'utf8');
const assistantSource = fs.readFileSync('src/components/GlobalAssistant.tsx', 'utf8');
const assistantPanelSource = fs.readFileSync('src/components/assistant/AssistantConversationPanel.tsx', 'utf8');
const assistantBubblesSource = fs.readFileSync('src/components/assistant/AssistantConversationBubbles.tsx', 'utf8');
const assistantSendSource = fs.readFileSync('src/components/assistant/useAssistantSend.ts', 'utf8');
const assistantRuntimeSource = fs.readFileSync('src/components/assistant/globalAssistantRuntime.ts', 'utf8');
const assistantRoutingSource = assistantSource + assistantRuntimeSource;
const assistantStoreSource = fs.readFileSync('src/stores/assistantStore.ts', 'utf8');
const revisionSource = fs.readFileSync('src/components/ProductionRevisionPanel.tsx', 'utf8');
const videoPlanEditorSource = fs.readFileSync('src/components/VideoPlanEditor.tsx', 'utf8');
const taskPackagePresetSource = fs.readFileSync('src/lib/weeklyTaskPackagePresets.ts', 'utf8');
const executionStatusSource = fs.readFileSync('src/components/AgentExecutionStatus.tsx', 'utf8');
const digitalEmployeeRouteSource = readDigitalEmployeeApplicationSources();
const enterpriseRouteSource = fs.readFileSync('server/routes/enterprise.ts', 'utf8');
const enterpriseProfileContractsSource = fs.readFileSync('server/routes/enterpriseProfileContracts.ts', 'utf8');
const enterpriseProfileStoreSource = fs.readFileSync('server/routes/enterpriseProfileStore.ts', 'utf8');
const onboardingGuideFrameSource = onboardingStepsSource.slice(
  onboardingStepsSource.indexOf('const applicationGuideSteps'),
  onboardingStepsSource.indexOf('export function OnboardingEnterpriseStep'),
);
const firstOnboardingSource = onboardingStepsSource.slice(
  onboardingStepsSource.indexOf('export function OnboardingEnterpriseStep'),
  onboardingStepsSource.indexOf('export function OnboardingProductsStep'),
);
const productTableOnboardingSource = onboardingStepsSource.slice(
  onboardingStepsSource.indexOf('export function OnboardingProductsStep'),
  onboardingStepsSource.indexOf('export function OnboardingMarketStep'),
);
const currentPlanSource = configuredWorkspaceSource.slice(
  configuredWorkspaceSource.indexOf('const weeklyCommandCenter ='),
  configuredWorkspaceSource.indexOf('<Modal open={healthDialogOpen}'),
);
const weeklyCommandCenterSource = weeklyPlanPresentationSource.slice(
  weeklyPlanPresentationSource.indexOf('export function WeeklyCommandCenter'),
  weeklyPlanPresentationSource.indexOf('export function WeeklyPlanDetailsDrawer'),
);
const homeSource = smartBusinessSource.slice(
  smartBusinessSource.indexOf('function HomeView'),
  smartBusinessSource.indexOf('const matrixRoleLabel'),
);
const publishingCalendarSource = smartBusinessSource.slice(
  smartBusinessSource.indexOf('function WeeklyPublishingCalendar'),
  smartBusinessSource.indexOf('const matrixRoleLabel'),
);
const weeklyPlanControlsSource = pageSource.slice(
  pageSource.indexOf('const weeklyPlanControls'),
  pageSource.indexOf('const weeklyCommandCenter =', pageSource.indexOf('const weeklyPlanControls')),
);
const matrixViewSource = smartBusinessSource.slice(
  smartBusinessSource.indexOf('function MatrixView'),
  smartBusinessSource.indexOf('function openTaskPreviewPage'),
);
const dashboardRoutesSource = smartBusinessSource.slice(smartBusinessSource.indexOf('export default function SmartBusinessDashboard'));
const workspaceTabsSource = fs.readFileSync('src/components/smartBusiness/BusinessOverviewTabs.tsx', 'utf8');
const initialPlanSaveSource = fs.readFileSync('src/components/digitalEmployeeConfigurationAction.ts', 'utf8');
assert.match(pageSource, /createDigitalEmployeeConfigurationAction\(\{[\s\S]{0,240}recoverEnterpriseFactsChanged/, 'the page must wire the existing recovery and state callbacks into the configuration action');
const enterpriseFactsRecoverySource = fs.readFileSync('src/components/digitalEmployeeFactRecovery.ts', 'utf8');
assert.match(pageSource, /createDigitalEmployeeFactRecovery\(\{[\s\S]{0,240}setWeeklyPlanOpen/, 'the page must wire its existing state and in-flight registry into fact recovery');
const mutationActionSource = pageSource.slice(
  pageSource.indexOf('const act'),
  pageSource.indexOf('const goal =', pageSource.indexOf('const act')),
);
const weeklyLaunchSource = fs.readFileSync('src/components/digitalEmployeeWeeklyLaunch.ts', 'utf8');
assert.match(pageSource, /createDigitalEmployeeWeeklyLaunch\(\{[\s\S]{0,240}recoverEnterpriseFactsChanged/, 'the page must pass its existing recovery and state callbacks to weekly launch');
const weeklyStartFailureSource = weeklyLaunchSource.slice(
  weeklyLaunchSource.indexOf('const reportWeeklyStartFailure'),
  weeklyLaunchSource.indexOf('const publishWeeklyWorkUpdate'),
);
const weeklyWorkUpdateSource = weeklyLaunchSource.slice(
  weeklyLaunchSource.indexOf('const publishWeeklyWorkUpdate'),
  weeklyLaunchSource.indexOf('const presentConfirmedWeeklyExecution'),
);
const confirmWeeklyPlanSource = weeklyLaunchSource.slice(weeklyLaunchSource.indexOf('const launchWeeklyPlan'));
const controlWeeklyWorkSource = pageSource.slice(
  pageSource.indexOf('const controlWeeklyWork'),
  pageSource.indexOf('const weeklyControlLabel', pageSource.indexOf('const controlWeeklyWork')),
);

const assistantContextSource = pageSource.slice(
  pageSource.indexOf("const selectedContentItem = selectedContentItemId"),
  pageSource.indexOf('const requestOverviewRange', pageSource.indexOf("const selectedContentItem = selectedContentItemId")),
);
assert.match(assistantContextSource, /sourcePage: 'digitalEmployees'/, '数字员工必须显式标记灵小枢上下文来源，避免隐藏页面覆盖当前对象');
for (const reference of ['goalId', 'planId', 'runId', 'taskId', 'contentId', 'viewKey']) {
  assert.match(assistantContextSource, new RegExp(`${reference}:`), `数字员工上下文必须同步 ${reference}`);
}
assert.match(assistantContextSource, /selectedContentItem[\s\S]{0,240}内容制作进度/, '打开日历内容时必须把灵小枢切到该内容的制作进度上下文');
assert.match(assistantContextSource, /viewGoalId \? '历史' : '本周'/, '查看历史周时必须明确历史目标，不能继续显示当前周任务');

const factRebuildDetails = {
  expectedGoalVersion: 4,
  sourcePlanId: 'source-plan-a',
  expectedFactsVersion: 'facts-v3',
  expectedSourcePlanDigest: 'a'.repeat(64),
};
const factRebuildV4 = enterpriseFactsRebuildInput({ id: 'goal/事实-a', version: 4 }, factRebuildDetails);
assert.deepEqual(
  enterpriseFactsRebuildInput({ id: 'goal/事实-a', version: 4 }, factRebuildDetails),
  factRebuildV4,
  'the same complete recovery intent must reuse one durable rebuild request identity',
);
assert.match(factRebuildV4.requestId, /^[A-Za-z0-9_-]{8,120}$/, 'fact rebuild request ids must satisfy the server idempotency-key contract');
assert.equal(factRebuildV4.expectedGoalVersion, 4, 'a rebuild must carry the exact goal version observed by the page');
assert.deepEqual(
  { expectedGoalVersion: factRebuildV4.expectedGoalVersion, sourcePlanId: factRebuildV4.sourcePlanId, expectedFactsVersion: factRebuildV4.expectedFactsVersion, expectedSourcePlanDigest: factRebuildV4.expectedSourcePlanDigest },
  factRebuildDetails,
  'a rebuild must echo the source-plan identity, frozen fact version and exact source-plan digest supplied by the conflict',
);
assert.notEqual(
  enterpriseFactsRebuildInput({ id: 'goal/事实-a', version: 4 }, { ...factRebuildDetails, expectedFactsVersion: 'facts-v3b' }).requestId,
  factRebuildV4.requestId,
  'a different fact binding at the same goal version must receive a distinct idempotency identity',
);
assert.notEqual(
  enterpriseFactsRebuildInput({ id: 'goal/事实-a', version: 4 }, { ...factRebuildDetails, expectedSourcePlanDigest: 'c'.repeat(64) }).requestId,
  factRebuildV4.requestId,
  'a different source-plan payload at the same goal version must receive a distinct idempotency identity',
);
assert.notEqual(
  enterpriseFactsRebuildInput({ id: 'goal/事实-a', version: 5 }, { ...factRebuildDetails, expectedGoalVersion: 5 }).requestId,
  factRebuildV4.requestId,
  'a newly observed goal version must not reuse an older rebuild identity',
);
for (const missingField of ['expectedGoalVersion', 'sourcePlanId', 'expectedFactsVersion', 'expectedSourcePlanDigest']) {
  const incompleteDetails: Record<string, unknown> = { ...factRebuildDetails };
  delete incompleteDetails[missingField];
  assert.throws(
    () => enterpriseFactsRebuildInput({ id: 'goal/事实-a', version: 4 }, incompleteDetails),
    /invalid_enterprise_facts_rebuild_target/,
    `missing ${missingField} evidence must disable automatic recovery`,
  );
}
assert.throws(
  () => enterpriseFactsRebuildInput({ id: 'goal/事实-a', version: 4 }, { ...factRebuildDetails, expectedGoalVersion: 5 }),
  /invalid_enterprise_facts_rebuild_target/,
  'a conflict for another observed goal version must disable automatic recovery',
);
assert.throws(
  () => enterpriseFactsRebuildInput({ id: 'goal/事实-a', version: 4 }, { ...factRebuildDetails, expectedSourcePlanDigest: 'not-a-sha256' }),
  /invalid_enterprise_facts_rebuild_target/,
  'malformed source-plan evidence must disable automatic recovery',
);

assert.match(pageSource, /制定本周目标/, 'Smart Operations must retain the editor for a genuinely new weekly goal');
assert.match(onboardingPanelSource, /allocateWeeklyPublishingTargets\(selectedPublishingTargets, platformPublishCounts\)/, 'Agent settings must persist structured per-account shares of the platform quota');
assert.match(weeklyGoalPanelSource, /const configuredTargetPlatforms = weeklyPublishingPlatforms\(config\.publishingTargets, config\.socialCadence\)/, 'weekly planning must prefer the user-selected publishing platforms over the four-platform profile');
assert.match(onboardingPanelSource, /weeklyPublishingTotal/, 'the displayed weekly total and the saved cadence must share one computed source');
assert.match(weeklyPlanCalendarSource, /本周发布日历/, 'weekly planning must use the compact publishing calendar');
for (const deprecated of ['生成免费任务总纲', '免费的周任务总纲', '步骤 1 · 免费', '步骤 2 · Agent 预分析']) {
  assert.doesNotMatch(pageSource, new RegExp(deprecated), `Smart Operations must remove the deprecated free/paid two-step copy: ${deprecated}`);
}
for (const label of ['全部账号', 'YouTube', 'Instagram', 'Facebook', 'TikTok']) {
  assert.match(accountRailSource, new RegExp(label), `the Smart Operations account rail must expose ${label}`);
}
assert.match(accountRailSource, /targets\.map\(account =>/, 'the account rail must render one flat list of real or planned accounts');
assert.doesNotMatch(accountRailSource, /platforms\.map\(/, 'the account rail must not group accounts into duplicate platform sections');
assert.match(accountRailSource, /overflow-x-auto/, 'the account selector must stay compact above the schedule instead of squeezing it from the left');
assert.doesNotMatch(accountRailSource, /lg:sticky|lg:grid-cols-\[220px/, 'the account selector must not reserve a fixed desktop sidebar');
assert.doesNotMatch(pageSource, /workspaceView === "matrix" \? "lg:grid-cols-\[220px/, 'the matrix workspace must keep the schedule at full width');
for (const label of ['爆款视频预览', '素材组合预览', '效果置信度', '任务不能开始']) {
  assert.match(smartBusinessFeatureSource, new RegExp(label), `content task cards must expose ${label}`);
}
assert.match(matrixScheduleSource, /Agent 任务看板/, 'the overview schedule section must retain only the Agent task board');
assert.doesNotMatch(matrixScheduleSource, /<LsCalendar|发布日历/, 'the publishing calendar must not be duplicated inside the Agent task board');
assert.doesNotMatch(weeklyCommandCenterSource, /<LsCalendar|WeeklyContentProgressPanel|本周发布日历/, 'the weekly-plan metrics must not duplicate the publishing calendar');
assert.doesNotMatch(digitalEmployeeWorkspaceSource, /aria-label="数字员工视图"|<Segmented/, 'the Digital Employee monitor must not split production and publishing into first-level pages');
assert.match(digitalEmployeeWorkspaceSource, /<DigitalEmployeeHomeWork data=\{data\} onNavigate=\{onNavigate\}/, 'the Digital Employee workspace must retain only the three-column current-work surface');
assert.doesNotMatch(digitalEmployeeWorkspaceSource, /数字员工生产指挥舱|发布与投流|客服承接|InitialPreparationStatusPanel/, 'the employee schedule must remove every wrapper panel around the requested three columns');
assert.doesNotMatch(digitalEmployeeWorkspaceSource, /异常与待处理/, '异常不得成为脱离内容工程的独立固定模块');
assert.doesNotMatch(digitalEmployeeWorkspaceSource, /数字员工实时状态|四位数字员工正在如何协作|data-agent-running|Agent 协作在线/, 'overview must not duplicate Agent status outside content projects');
assert.doesNotMatch(digitalEmployeeWorkspaceSource, /LoaderCircle/, 'removed Agent status cards must not leave decorative running indicators behind');
assert.match(pageSource, /!\["live", "matrix"\]\.includes\(workspaceView\)[\s\S]{0,700}setInterval\(reconcile, 15_000\)/, '任务执行与员工排期都必须用实时流加低频权威回读校准状态');
assert.match(matrixViewSource, /publishingCalendar=\{<WeeklyPublishingCalendar data=\{data\} onRefresh=\{onRefresh\}\/>\}/, 'the publishing calendar must be injected into the Digital Employee workspace');
assert.match(matrixViewSource, /<DigitalEmployeeWorkspace[^>]*onOpenAgentSettings=\{onOpenAgentSettings\}/, 'the Digital Employee workspace must receive the settings action');
assert.match(restoredAgentWorkCalendarSource, /identity: \{ kind: 'agent', role: task\.agent \}/, 'employee schedule cards must use the responsible Agent icon instead of a missing cover');
assert.match(restoredAgentWorkCalendarSource, /<LsCalendar[\s\S]{0,700}taskBoard[\s\S]{0,1000}detailsLayout="custom"[\s\S]{0,100}renderDetails=\{renderDetails\}/, 'Agent video production must use the shared task calendar with its custom detail drawer');
assert.match(restoredAgentWorkCalendarSource, /productionStageContract/, 'task details must explain the deterministic production handoff contract');
for (const label of ['主 Agent', '辅助 Agent', '交付时间', '交付内容', '交付形式', '当前进度']) {
  assert.match(restoredAgentWorkCalendarSource, new RegExp(label), `Agent schedule details must expose ${label}`);
}
assert.match(restoredAgentWorkCalendarSource, /<Steps direction="vertical"/, 'Agent progress must read top-to-bottom as one real workflow');
assert.match(dashboardRoutesSource, /view === "matrix"[\s\S]{0,1000}<MatrixView[^>]*onOpenAgentSettings=\{onOpenAgentSettings\}/, 'the dashboard matrix route must retain the settings action');
assert.match(pageSource, /onOpenAgentSettings=\{\(\) => setWorkspaceView\("rules"\)\}/, 'the employee-schedule settings action must open the existing full settings page');
assert.match(publishingCalendarSource, /<h3[^>]*>发布日历<\/h3>[\s\S]{0,160}<Tag>\{calendarEvents\.length\} 项发布<\/Tag>/, 'the Digital Employee publishing view must use the same titled workspace shell as employee scheduling');
assert.match(publishingCalendarSource, /<LsCalendar[^>]*label="本周发布日历"[^>]*initialView="timeGridWeek"[^>]*\bshowAllEvents\b[^>]*fixedHeight="auto"[^>]*onMoveEvent=/, 'the publishing calendar must show explicit publish times and support durable drag rescheduling');
assert.doesNotMatch(publishingCalendarSource, /eventCardMode="media"|density="compact"|\bflush\b/, 'the publishing view must use the employee calendar card density and spacing');
assert.doesNotMatch(matrixScheduleSource, /gridTemplateColumns|group-hover:max-h-72/, 'calendar must not retain a handwritten or hover-only schedule');
assert.match(matrixScheduleSource, /<AgentWorkMonitor/, 'the Agent task board must retain the detailed work monitor');
assert.doesNotMatch(smartBusinessSource, /数字员工协作状态|四位数字员工协作状态/, 'the dashboard must not create a separate Digital Employee section');
assert.doesNotMatch(pageSource, /aria-label="开启或关闭智能经营"|智能经营已开启|已停止新计划/, 'the redundant Smart Operations switch must not remain beside the weekly task control');

assert.match(assistantRuntimeSource, /(?:export )?const PRIMARY_ASSISTANT_THREAD: OrbitAgentId = 'business'/, '灵小枢必须保持一个统一的主对话线程');
assert.match(assistantPanelSource, /activeAgentLabel="灵小枢"/, '唯一主入口必须使用灵小枢身份');
assert.match(assistantSource, /const agentId = PRIMARY_ASSISTANT_THREAD/, '页面专业 Agent 只能作为内部路由上下文，不能拆成多个对话入口');
assert.doesNotMatch(assistantSource, /const SKILL_AGENTS|策略助手|唤醒助手|统筹 Agent/, '灵小枢不应恢复旧助手、放射式 Agent 入口或重复的统筹 Agent');
assert.match(assistantStoreSource, /\['business', 'director', 'content', 'customer'\]/, '灵小枢应只维护四个现有子 Agent 的独立会话');
assert.match(assistantSource, /const currentPageAgent = useMemo\(\(\) => orbitIdForPage\(page\)/, '灵小枢必须根据当前工作区选择内部专业 Agent 上下文');
assert.match(assistantBubblesSource, /<AssistantDecisionCenter[\s\S]{0,420}page=\{page\}[\s\S]{0,700}variant="summary"/, '灵小枢默认对话必须展示当前页面真实待办的概要气泡');
assert.match(assistantSource, /openAgent\(currentPageAgent, 'chat'\)/, '点击灵小枢应直接进入单列对话，不恢复 Agent 选择器或强制打开详情');
for (const question of ['查看当前进度', '查看数字员工排期', '查看需要我处理的任务']) {
  assert.match(assistantContextSource, new RegExp(question), `生产中的灵小枢上下文必须提供推荐问题：${question}`);
}
assert.match(pageSource, /weeklyPlanNavigation\?: \{ goalId: string; planId: string; requestId: number \}/, '周计划导航必须携带准确目标和重复点击序号');
assert.match(pageSource, /next\.goal\?\.id !== target\.goalId \|\| next\.plan\?\.id !== target\.planId/, '打开编辑器前必须同时核对目标与计划编号');
assert.match(pageSource, /目标周计划已更新或不再是当前计划/, '计划不匹配必须明确提示，不能回退打开别的计划');
assert.match(pageSource, /setViewGoalId\(""\);[\s\S]{0,300}setWeeklyPlanOpen\(false\)[\s\S]{0,220}请先核对平台、产量、预算和排期/, '准确定位后必须回到当前经营页并要求先核对计划，不得复用已删除的详情页');
assert.match(assistantRoutingSource, /page === 'smartAssets'\) return 'content'/, '内容制作页应高亮内容 Agent');
assert.match(assistantRoutingSource, /page === 'socialInspiration'[\s\S]{0,160}return 'director'/, '灵感与脚本页面应高亮编导 Agent');
assert.match(assistantRoutingSource, /page === 'conversion'[\s\S]{0,220}return 'customer'/, '客户页面应高亮客服 Agent');
assert.match(assistantSource, /const openAgent[\s\S]{0,160}const agentId = PRIMARY_ASSISTANT_THREAD/, '所有页面入口保持统一主线程');
assert.match(assistantSource, /send\(kickoff\.text, orbitIdForAgent\(kickoff\.agent, currentPageAgent\)\)/, '专业工作流启动仍应进入对应 Agent');
assert.match(assistantSendSource, /strategyRequest \? '' : await loadLiveIntegrationFacts\(\)/, '经营回答不能重新注入客户端账号事实');
assert.match(assistantSendSource, /if \(!currentScope\(\)\) return/, '跨身份异步响应必须被丢弃');

assert.match(onboardingPanelSource, /输出内容语言/);
assert.match(onboardingPanelSource, /需要输出的语言/);
assert.match(pageSource, /<SmartBusinessDashboard data=\{data\} view=\{dashboardView\}/, 'Smart Operations must mount the active dashboard');
assert.match(smartBusinessSource, /<ProductionTaskScene runId=\{data\.run\.id\} taskId=\{item\.taskId\} embedded\/>/, 'the active dashboard must use the shared production scene');
assert.match(revisionSource, /当前待验收成片/, 'the revision workspace must put the final video before editing controls');
assert.match(revisionSource, /<video[^>]+aria-label="当前待验收成片"/, 'the revision workspace must render the actual final video');
assert.match(revisionSource, /成片通过，确认当前版本/, 'the revision workspace must allow the user to complete the human quality decision');

for (const label of ['经营总览', '数字员工', '数据复盘']) {
  assert.match(pageSource, new RegExp(label), `Digital Employee workspace must expose the ${label} view`);
}
assert.match(pageSource, /<GoalPanel config=\{data\.config\}[\s\S]{0,120}businessLine=\{businessLine\} contentPlatform=\{contentPlatform\}/, 'the weekly goal editor must retain business-line and platform context');
assert.match(smartBusinessSource, /data\.tasks/, 'the active dashboard must use persisted tasks');
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
for (const oldView of ['TodayNextAction', 'BusinessLoopMap', 'ResourcePreflightPanel', 'NextActionBanner', 'DraftPlanPreview']) {
  assert.doesNotMatch(pageSource, new RegExp(`(?:function|<)${oldView}\\b`), `the unmounted ${oldView} view must not be mistaken for a delivered workspace`);
}
assert.match(pageSource, /Agent 设置/, 'Agent settings must remain available as a secondary management entry');
assert.doesNotMatch(pageSource + onboardingPanelSource + onboardingStepsSource, /通用设置|本 Agent 审批红线|总体审批红线/, 'Agent settings must hide general settings and every per-Agent approval-redline panel');
assert.match(onboardingPanelSource, /useState<"business" \| "director" \| "content" \| "customer">\("business"\)/, 'Agent settings must enter the business Agent settings directly');
assert.match(onboardingPanelSource, /仅生成内容时的每周草稿数/, 'business Agent settings must keep a draft-only fallback when no publishing platform is selected');
assert.match(onboardingPanelSource, /本周总计/, 'business Agent settings must expose the exact sum of the selected platform quotas');
assert.match(onboardingPanelSource, /默认向所有已连接账号和平台发布/, 'business Agent settings must default to every connected account and platform');
assert.match(onboardingPanelSource, /每周发布/, 'business Agent settings must expose per-platform publishing counts');
assert.match(onboardingPanelSource, /建议平台[\s\S]{0,500}建议来源[\s\S]{0,500}建议关键词/, 'director settings must collect platform, source and keyword recommendations');
assert.match(onboardingPanelSource, /实际搜索范围以已批准的灵感范围为准/, 'director recommendations must defer to the approved discovery scope');
assert.match(onboardingPanelSource, /输出内容语言/, 'content Agent settings must retain only its output-language requirement');
assert.doesNotMatch(appSource, /SocialOperatingSummary/, 'Smart Business must not render the redundant social-operation background bar');
assert.match(appPageSlotSource, /page === 'traffic'[\s\S]{0,1200}initialView="publish"[\s\S]{0,300}visibleModes=\{\['publish'\]\}[\s\S]{0,200}showModeTabs=\{false\}/, 'publishing must not keep the redundant publish/account top-level tabs');
assert.doesNotMatch(matrixViewSource, /<AccountActivity|<AccountHealthPanel/, 'the matrix must retain account configuration, not duplicate health and pure numeric data');
for (const label of ['发布日历', '投流速览', '询盘诊断']) assert.match(workspaceTabsSource, new RegExp(label), `retained standalone business modules must preserve ${label}`);
assert.equal((workspaceTabsSource.match(/^\s*\{ key: '(?:calendar|ads|inquiries)'/gm) || []).length, 3, 'retained standalone business modules must preserve exactly three views');
assert.doesNotMatch(workspaceTabsSource, /内容队列/, 'the removed content queue must not remain a navigation tab');
assert.doesNotMatch(smartBusinessSource, /function QueueView|view === "queue"/, 'the removed content queue must not retain a render branch');
assert.doesNotMatch(smartBusinessSource, /本周统一数据口径|One weekly plan/i, 'the three views must not repeat the weekly-plan summary already shown in the command center');
for (const label of ['参考估算', '真实回传']) assert.match(smartBusinessSource, new RegExp(label), `missing performance data must keep its source label: ${label}`);
assert.match(weeklyCommandCenterSource, /buildSmartBusinessDisplayModel\(data\)/, 'the weekly command center must derive account, video and cost counts from the shared weekly-plan model');
assert.doesNotMatch(smartBusinessSource, /演示数据/, 'the product UI must not expose the deprecated demo-data wording');
assert.doesNotMatch(pageSource, /id: "live", label: "周计划"/, 'the repetitive standalone weekly-plan tab must be removed');
assert.doesNotMatch(pageSource, /删除旧任务/, 'the weekly command center must not expose a destructive old-task action');
assert.match(layoutSource, /\{accountMenuOpen && \([\s\S]{0,1800}新手引导/, 'the beginner guide must live in the expanded user menu');
assert.doesNotMatch(layoutSource, /aria-label="主导航"[\s\S]{0,900}新手引导/, 'the beginner guide must not remain in the primary navigation');
assert.match(layoutSource, /lingshu:open-digital-employee-guide/, 'the user-menu guide entry must open the Digital Employee guide');
assert.match(pageSource, /addEventListener\('lingshu:open-digital-employee-guide'/, 'Smart Business must respond to the sidebar guide entry');
assert.doesNotMatch(pageSource, /SMART OPERATIONS/, 'the redundant Smart Operations masthead must be removed');
assert.match(weeklyPlanControlsSource, /查看当前周计划/, 'the current-plan controls must expose the user-requested read-only current plan action');
assert.doesNotMatch(weeklyPlanControlsSource, /Agent 设置/, 'Agent settings must not remain in the weekly-plan header');
assert.match(weeklyPlanControlsSource, /历史计划[\s\S]{0,1500}weeklyControlLabel/, 'the current-plan controls must retain history and the primary execution action');
assert.match(currentPlanSource, /actions=\{weeklyPlanControls\}/, 'the current-plan header must receive the weekly-plan controls');
assert.match(weeklyCommandCenterSource, /<h2[^>]*>周经营计划<\/h2>/, 'the weekly-plan header must retain its concise title');
assert.match(weeklyCommandCenterSource, /aria-label="智能经营控制"/, 'the weekly-plan header must retain management controls');
assert.match(weeklyCommandCenterSource, /周经营计划[\s\S]{0,1800}aria-label="智能经营控制"/, 'the weekly-plan visual date range must keep the management controls in the same header');
assert.match(weeklyCommandCenterSource, /WeeklyRangeVisual/, 'the weekly-plan header must visualize its operating range instead of appending a raw date string');
assert.match(weeklyCommandCenterSource, /周经营计划[\s\S]{0,500}<WeeklyRangeVisual/, 'the compact week range must remain in the same title row instead of consuming its own line');
assert.match(publishingCalendarSource, /initialView="timeGridWeek"[^>]*\bshowAllEvents\b[^>]*fixedHeight="auto"[^>]*workspaceMode="expanded"[^>]*firstDay=\{display\.startsAt \? calendarWeekday\(display\.startsAt\) : 1\}/, 'the weekly publishing calendar must use the same hourly workspace as employee scheduling');
assert.doesNotMatch(smartBusinessSource, />各平台计划与完成</, 'the overview must not add a low-value platform summary chart');
assert.match(currentPlanSource, /WeeklyCommandCenter/, 'the full weekly command center must replace the simplified current-plan summary');
assert.match(currentPlanSource, /notice=\{publishingSetupRequired[\s\S]{0,1200}配置发布账号[\s\S]{0,1200}detailGeneration\?\.blockedCount/, 'the weekly-plan header must surface publishing setup before the existing content-readiness fallback');
assert.match(pageSource, /publishingSetupRequired[\s\S]{0,900}内容生产可以继续，系统不会把未连接账号当成已就绪/, 'publishing readiness must warn early without falsely blocking independent content production');
assert.doesNotMatch(pageSource, /WeeklyPlanDetailsDrawer[\s\S]{0,500}onOpenPublishingSetup=\{openPublishingAccountSetup\}/, 'the detailed weekly plan must not repeat publishing-account setup warnings');
for (const label of ['制定周计划', '确认并开始生产', '暂停周任务', '继续周任务']) assert.match(pageSource, new RegExp(label), `the merged weekly control must support ${label}`);
assert.match(currentPlanSource, /<WeeklyCommandCenter[\s\S]{0,500}onMetricClick=\{goal \? metric =>/, 'the blank weekly state must retain the complete six-metric command center without inventing metric navigation');
assert.doesNotMatch(currentPlanSource, /本周还没有计划|先制定并预览周计划/, 'the blank weekly state must not collapse into a text-only placeholder');
assert.doesNotMatch(currentPlanSource, /本周还没有可执行计划[\s\S]{0,240}开始周任务/, 'the blank weekly state must not label plan creation as starting production');
assert.match(configuredWorkspaceSource, /workspaceView === "today" \? <BusinessOverviewLanding/, 'the default smart-business view must retain the integrated business overview');
assert.doesNotMatch(configuredWorkspaceSource, /<DigitalEmployeeHomeWork/, 'the removed three-column employee work surface must not return beside the integrated overview');
assert.doesNotMatch(pageSource, /查看员工排期|返回经营总览/, 'the business overview must not require open or return buttons for the default employee work surface');
assert.match(pageSource, /const recoverableProductionTask = data\.run\?\.goal_id === goal\?\.id[^]*?task\.run_id === data\.run!\.id && task\.task_key === "content_production"/, 'continue production must target only this goal and run’s production task');
assert.match(controlWeeklyWorkSource, /if \(recoverableProductionTask\)[^]*?digitalEmployeeApi\.retryTask\(recoverableProductionTask\.id\)[^]*?return;/, 'recovering a failed production node must not create another weekly run');
assert.match(pageSource, /controlWeeklyWork[\s\S]{0,900}pauseRun[\s\S]{0,400}resumeRun|controlWeeklyWork[\s\S]{0,900}resumeRun[\s\S]{0,400}pauseRun/, 'the merged weekly control must pause and resume the persisted run');
assert.match(weeklyPlanControlsSource, /controlWeeklyWork[\s\S]{0,900}weeklyControlLabel/, 'the weekly-plan header must own the merged start and pause control');
assert.doesNotMatch(currentPlanSource, /查看内容队列|查看完整周计划|新手引导/, 'the current-plan card must not keep duplicate queue, full-plan, or guide buttons');
assert.match(controlWeeklyWorkSource, /if\s*\(!goal\s*\|\|\s*canCreateNextGoal\)\s*\{[\s\S]{0,320}setNewGoal\(true\)[\s\S]{0,160}setWeeklyPlanOpen\(true\)[\s\S]{0,120}return;[\s\S]{0,220}setWeeklyPlanOpen\(false\)[\s\S]{0,140}await openWeeklyStartConfirmation\(\)/, 'the primary weekly control must open the planner when no plan exists and require the presenter confirmation for an existing reviewed plan');
assert.doesNotMatch(controlWeeklyWorkSource, /setNewGoal\(false\)[\s\S]{0,160}setWeeklyPlanOpen\(true\)/, 'an existing plan must never enter the removed confirmation page before starting');
for (const removedCopy of ['本周计划详情', '确认本周视频计划', '返回智能经营']) {
  assert.doesNotMatch(pageSource, new RegExp(removedCopy), `the removed weekly-plan detail flow must not retain: ${removedCopy}`);
}
assert.match(pageSource, /aria-label="周计划生成"/, 'new and next-week goals may retain a dedicated editing flow');
assert.match(pageSource, /const \[weeklyPlanDetailsOpen, setWeeklyPlanDetailsOpen\] = useState\(false\)/, 'the page must own explicit state for the in-page weekly-plan drawer');
assert.match(pageSource, /weeklyPlanDetailsOpen&&<Suspense[^>]*><WeeklyPlanDetailsDrawer data=\{data\} open onClose=\{\(\)=>setWeeklyPlanDetailsOpen\(false\)\}/, 'the detailed weekly plan must remain in-page and close without navigation');
assert.match(pageSource, /setWeeklyPlanOpen\(false\);[\s\S]{0,200}setWorkspaceView\("today"\)[\s\S]{0,300}aria-label=\"当前周计划\"/, 'the assistant weekly-plan action must focus the inline current-plan summary without restoring the removed drawer');
assert.doesNotMatch(pageSource, /BusinessAnnouncementBar/, 'the Smart Business home must not retain the deleted announcement bar');
assert.match(pageSource, /const openWeeklyPlan = \(\) => \{[\s\S]{0,320}setNewGoal\(true\)[\s\S]{0,120}setWeeklyPlanOpen\(true\)[\s\S]{0,520}addEventListener\('lingshu:open-weekly-plan'/, 'the assistant entry must open the same weekly-plan composer as the page action');
assert.match(assistantContextSource, /workflowStage: weeklyPlanningStage/, 'the page must tell Lingxiaoshu whether weekly work is unplanned, planned, running, setup-only, or historical');
assert.match(pageSource, /const weeklyControlLabel = busy === ["']confirm-weekly-plan["'][\s\S]{0,100}正在启动生产…/, 'the primary control must name its real production-start loading state');
assert.match(weeklyPlanControlsSource, /loading=\{Boolean\(busy\)\}/, 'the primary start button must render a loading state and block duplicate clicks while launch is in flight');
const confirmedExecutionSource = weeklyStartValidationSource.slice(
  weeklyStartValidationSource.indexOf('function confirmedWeeklyExecution'),
  weeklyStartValidationSource.indexOf('function weeklyStartResultNeedsReconciliation'),
);
assert.match(weeklyLaunchSource, /import \{[\s\S]{0,140}confirmedWeeklyExecution,[\s\S]{0,100}weeklyStartConflictFromError,[\s\S]{0,100}weeklyStartResultNeedsReconciliation/, 'weekly launch must use the shared evidence checks rather than a page-local duplicate');
assert.match(weeklyStartConflictAlertSource, /周任务未启动：已有另一轮任务正在执行[\s\S]{0,500}系统不会自动取消或重复启动任何运行/, 'the extracted conflict alert must retain the persisted run and no-duplicate-start explanation');
assert.match(confirmedExecutionSource, /run\.goal_id !== goalId/, 'the page must verify the returned run belongs to the requested goal');
assert.match(confirmedExecutionSource, /Date\.parse\(run\.started_at\)/, 'the page must require a persisted start time before treating launch as confirmed');
assert.match(confirmedExecutionSource, /task\.run_id === run\.id[\s\S]{0,100}tasks\.length > 0/, 'the page must require tasks scoped to the returned run before treating launch as confirmed');
assert.match(weeklyLaunchSource, /const presentConfirmedWeeklyExecution[\s\S]{0,360}setData\(next\)[\s\S]{0,120}publishWeeklyWorkUpdate\(next\)/, 'a real start receipt, including an immediate terminal result, must replace stale page state and refresh assistant decisions');
assert.match(weeklyLaunchSource, /const presentConfirmedWeeklyExecution[\s\S]{0,600}weeklyWorkStatus\(next\)[\s\S]{0,700}feedback\([\s\S]{0,260}tone: feedbackTone/, 'launch feedback must use the authoritative queued, running, blocked, paused or terminal state instead of always showing a green success');
assert.match(weeklyLaunchSource, /setWorkspaceView\(launchedStatus\?\.phase === ["']running["'] \|\| launchedStatus\?\.phase === ["']queued["'] \? ["']matrix["'] : ["']live["']\)/, 'confirmed queued/running work must enter the persisted schedule while blocked or terminal work opens its status view');
assert.match(weeklyLaunchSource, /周任务未启动/, 'a failed start must have a visible, explicit failure title');
assert.match(weeklyStartFailureSource, /setError\(message\)[\s\S]{0,240}feedback\([\s\S]{0,160}title: ["']周任务未启动["'][\s\S]{0,120}description: message[\s\S]{0,120}tone: ["']error["']/, 'a failed start must remain visible and use the same concrete reason in its error feedback');
assert.match(confirmWeeklyPlanSource, /catch \(actionError\)[\s\S]{0,2200}reportWeeklyStartFailure\(actionError instanceof Error \? actionError\.message/, 'a definitive API launch failure without a structured conflict must preserve the concrete server reason instead of reporting success');
assert.match(confirmWeeklyPlanSource, /weeklyStartConflictFromError\(actionError\)[\s\S]{0,500}setWeeklyStartConflict\(conflict\)[\s\S]{0,500}本轮计划没有被重复启动/, 'active_goal_exists must retain the other persisted goal/run as a visible blocker without cancelling or starting either run');
assert.match(confirmWeeklyPlanSource, /launchRequestSent && weeklyStartResultNeedsReconciliation\(actionError\)[\s\S]{0,300}api\.overview\(goal\.id\)[\s\S]{0,220}presentConfirmedWeeklyExecution\(reconciled, goal\.id\)[\s\S]{0,500}启动结果待确认/, 'an uncertain launch response must perform one read-only reconciliation and never repeat the start mutation');
assert.match(pageSource, /<WeeklyStartConflictAlert[\s\S]{0,220}openConflictingRun/, 'the persistent active-run conflict must provide a direct view-run action');
assert.doesNotMatch(pageSource, /WeeklyWorkStatusAlert|currentWeeklyWorkStatus|weeklyStatusSlot/, 'the entire persistent home run-status banner must be removed for every runtime state');
assert.match(weeklyWorkStatusSource, /制作准备已完成，尚未开始生产/, 'generated details without a persisted run must never be labelled as production');
assert.match(weeklyWorkStatusSource, /run\.goal_id !== data\.goal\.id[\s\S]{0,300}运行与页面周目标不一致/, 'a run for another goal must not be presented as current production');
assert.match(weeklyWorkStatusSource, /externalAutoRecovery[\s\S]{0,900}本周任务正在自动恢复/, 'a machine-recoverable service retry must be distinguished from a user blocker');
assert.match(weeklyWorkStatusSource, /run\.status === 'waiting_external'[\s\S]{0,1400}本周任务已启动，等待业务结果/, 'a non-recovering external wait must retain a truthful business-result state');
assert.match(weeklyWorkStatusSource, /else if \(run\.status === 'running'\) phase = 'running';[\s\S]{0,80}else phase = 'unknown'/, 'an unrecognized run status must remain unknown rather than defaulting to running');
assert.doesNotMatch(weeklyWorkStatusSource, /COMPLETED_TASK_STATUSES = new Set\([^\n]*(?:cancelled|skipped)/, 'cancelled or skipped tasks must not inflate the completed-output count');
assert.match(weeklyWorkEventsSource, /WEEKLY_WORK_UPDATED_EVENT = 'lingshu:weekly-work-updated'/, 'the page and assistant must share one weekly-work refresh event');
assert.match(weeklyLaunchSource, /context\.notify \|\| notifyWeeklyWorkUpdated/, 'weekly launch must publish through the canonical weekly-work event by default');
assert.match(weeklyWorkUpdateSource, /notify\([\s\S]{0,420}source: ["']page["'][\s\S]{0,520}runId: run\.id[\s\S]{0,220}taskCount: tasks\.length/, 'a confirmed start must publish the normalized persisted execution receipt for assistant refresh');
assert.match(weeklyWorkUpdateSource, /run && run\.goal_id === updatedGoal\.id/, 'an execution event must never relabel a run belonging to another goal');
assert.match(pageSource, /detail\.source !== ["']assistant["'][\s\S]{0,420}addEventListener\(WEEKLY_WORK_UPDATED_EVENT, refreshFromAssistant\)/, 'assistant-originated weekly-work updates must reload the visible goal from the authoritative overview');
assert.doesNotMatch(weeklyCommandCenterSource, /status\?: ReactNode|aria-label="本周生产状态"/, 'the command center must not retain the deleted persistent run-state banner or its empty wrapper');
assert.match(weeklyCommandCenterSource, /\{feedback && <div aria-label="周任务操作反馈"/, 'action feedback must not reserve a row when no failure or conflict exists');
assert.match(pageSource, /const weeklyActionFeedback = \(weeklyStartConflict && !viewGoalId\) \|\| error \?/, 'only explicit action conflicts/errors can create feedback, not run or pause state');
assert.match(currentPlanSource, /feedback=\{weeklyActionFeedback\}/, 'explicit action failure feedback must remain separate from persisted runtime state');
assert.match(pageSource, /\{error && <Alert type="error" showIcon title=\{error\}/, 'start failure feedback must remain visible without restoring the run-status banner');
assert.doesNotMatch(pageSource, /\{error && <Alert className="mt-5"/, 'the page must not duplicate launch errors below the large calendar');
for (const label of ['执行失败', '已取消', '已暂停', '等待业务结果', '自动恢复中', '待处理', '准备中', '已完成', '执行中']) assert.match(pageSource, new RegExp(label), `the command header must expose the persisted run state: ${label}`);
assert.doesNotMatch(pageSource, /按发布时间查看内容，检查产品与参考依据后确认排期。|确定各平台账号的产量、总产量和预计成本。/, 'the weekly-plan page title must not repeat an explanatory subtitle');
assert.doesNotMatch(pageSource, /<BusinessOverviewTabs\b/, '经营总览 must remove the duplicate in-page business tabs');
assert.match(workspaceTabsSource, /<Tabs key=\{identity\} aria-label="经营总览页内视图"/, 'retained standalone business modules must keep their accessible shared Ant tabs');
const outlineFlowSource = pageSource.slice(pageSource.indexOf('const createWeeklyOutline'), pageSource.indexOf('const generateCurrentPlanDetails'));
assert.match(outlineFlowSource, /digitalEmployeeApi\.createGoal/, 'weekly goal creation must persist before product confirmation');
assert.match(confirmWeeklyPlanSource, /launchRequestSent = true;[\s\S]{0,200}approveGoal/, 'one click must directly request a real run, with preparation left to its pipeline');
assert.match(weeklyPlanCalendarSource, /publication\?\.title/, 'weekly calendar cards must show the future publishing title');
assert.match(weeklyPlanCalendarSource, /planningEvidence\?\.referenceThumbnailUrl/, 'weekly calendar cards must render persisted viral thumbnails');
assert.doesNotMatch(pageSource, /const updateWeeklyPlanProduct|const refreshWeeklyViralPlan/, 'removed plan-detail editing actions must not survive as unreachable page code');
assert.match(weeklyPlanCalendarSource, /补齐 \{missingReferences\} 条爆款/, 'a weekly plan with missing references must expose an actionable repair instead of a dead-end warning');
assert.match(weeklyPlanConfirmationSource, /合计预算范围/, 'the second confirmation must expose the combined budget range');
assert.doesNotMatch(pageSource, /aria-label="Agent To Do List"/, 'the removed weekly-plan detail page must not retain its embedded Agent task list');
assert.match(weeklyGoalPanelSource, /视频条数与发布分配[\s\S]{0,1800}<InputNumber/, 'the weekly proposal must let a novice change platform allocation directly');
assert.doesNotMatch(pageSource, /<SmartOperationsAccountRail/, 'the digital employee calendar must retain the latest layout without an account selector');
assert.match(weeklyPlanCalendarSource, /plans\.length[\s\S]{0,300}条内容/, 'the weekly calendar must expose the conserved total publishing count');
assert.match(weeklyPlanCalendarSource, /plans\.map[\s\S]{0,650}plan\.plannedPublishDate/, 'the weekly calendar must adapt every publishing version with its real planned date');
assert.match(weeklyPlanCalendarSource, /<LsCalendar/, 'the weekly calendar must use FullCalendar for all views');
assert.match(smartBusinessFeatureSource, /function inspirationReferenceForPlan[\s\S]{0,700}referenceId[\s\S]{0,260}sourceUrl[\s\S]{0,260}title:/, 'weekly content cards must preserve a traceable reference for Inspiration Center after the detail page is removed');
assert.match(publishingCalendarSource, /detailsTitle="内容制作进度"[\s\S]{0,600}WeeklyContentProgressPanel/, 'the Digital Employee publishing calendar must open read-only content progress in the shared drawer');
assert.match(publishingCalendarSource, /onOpenReference[\s\S]{0,350}inspirationReferenceNavigationDetail/, 'the drawer must retain the exact persisted inspiration reference as a secondary action');
assert.doesNotMatch(confirmWeeklyPlanSource, /approvalBlocked|missingProducts|missingReferences|generatePackageDetails|readiness\.canStart/, 'launch must not duplicate production preparation or publishing readiness gates in the UI');
assert.match(confirmWeeklyPlanSource, /api\.approveGoal\(goal\.id, source\.plan\.businessPackage\.revision, true\)/, 'launch must submit the exact plan revision with explicit generation authorization');
assert.match(digitalEmployeeApiSource, /approveGoal:[\s\S]{0,900}AbortSignal\.timeout\(12_000\)/, 'weekly launch must stop indefinite loading and hand unknown results to read-only reconciliation');
assert.match(inspirationSource, /receiveReference[\s\S]{0,2200}resolveInspirationReference\([\s\S]{0,900}setSelectedVideo\(resolved\.video\)/, 'Inspiration Center must resolve and open the requested viral-video detail');
assert.match(inspirationReferenceResolverSource, /videoMatchesReference\(video, target\)[\s\S]{0,1500}recordsToVideos[\s\S]{0,1500}videoMatchesReference\(video, target\)/, 'reference resolver must match inventory and read-only search candidates against the requested reference');
assert.match(inspirationReferenceResolverSource, /analysisSource: 'weekly-plan-snapshot'/, 'deleted references must retain the frozen weekly-plan analysis');
assert.match(inspirationSource, /resolved\.source === 'weekly-plan-snapshot'[\s\S]{0,200}setSelectedVideo\(resolved\.video\)/, 'a missing source must open the frozen snapshot instead of a fabricated live record');
assert.match(weeklyGoalPanelSource, /请至少安排 1 条视频；投流金额必须大于 0。/, 'weekly-plan validation must name the editable process fields instead of showing a generic warning');
assert.match(pageSource, /page === "socialPlanning"[\s\S]{0,160}void controlWeeklyWork\(\)/, 'the account-matrix next step must share the direct-start/new-goal control instead of reopening the removed detail page');
assert.match(weeklyPlanControlsSource, /查看当前周计划/, 'a persisted weekly plan must expose a direct read-only plan action');
assert.match(weeklyPlanControlsSource, /onClick=\{\(\) => setWeeklyPlanDetailsOpen\(true\)\}[\s\S]{0,120}查看当前周计划/, 'viewing the current weekly plan must open the in-page detail drawer');
assert.doesNotMatch(weeklyPlanControlsSource, /setWorkspaceView\("matrix"\)|getElementById\("agent-weekly-calendar"\)|scrollIntoView/, 'viewing weekly tasks must not change tabs or scroll to the employee calendar');
assert.match(weeklyPlanControlsSource, /历史计划/, 'Smart Business must retain plan history outside the active-run controls');
assert.doesNotMatch(weeklyPlanControlsSource, /删除旧任务/, 'active weekly controls must not expose the destructive legacy cancellation action');
assert.doesNotMatch(smartBusinessSource, /后台并发与异常中心|Background operations/, 'the overview must not expose the deleted background-operations panel');
assert.match(planHistorySource, /按周查看[\s\S]{0,200}按月查看/, 'plan history must support weekly and monthly views');
assert.match(planHistorySource, /completion[\s\S]{0,350}completed/, 'plan history completion must come from persisted task statuses');
assert.doesNotMatch(homeSource, /<NextRoundRecommendationsSection/, 'next-round recommendations must leave the overview body');
assert.match(workspaceTabsSource, /<CalendarPlanner[^]*<NextRoundRecommendationsSection/, 'next-round recommendations must appear at the bottom of the publishing calendar tab');
assert.match(matrixScheduleSource, /AgentWorkMonitor/, 'Agent progress must come from the retained task board');
assert.doesNotMatch(homeSource, /Agent 工作轨道/, 'the overview must remove the duplicated Agent work-track section');
assert.doesNotMatch(smartBusinessSource, /本地模拟 · \{foreignTradeBusinessMock\.factory\}/, 'the local-preview banner must not occupy dashboard space');
assert.doesNotMatch(smartBusinessSource, /starterWorkspaceApi|agentUsageCosts|costCny\.settlementStatus|过去已核算消耗|账号真实结算账本/, 'Agent detail must not expose the internal provider-cost ledger');
assert.match(smartBusinessSource, /用户积分统一在“套餐与积分”中展示；供应商成本仅用于后台成本优化。/, 'Agent detail must direct users to the separated customer points account');
assert.match(smartBusinessSource, /<MatrixView[^>]*\bdata=\{data\}/, 'the account matrix tab must use the deterministic editable weekly matrix');
assert.match(matrixViewSource, /<DigitalEmployeeWorkspace data=\{data\}/, 'the digital employee workspace must receive the complete persisted overview');
assert.doesNotMatch(smartBusinessSource, /排期规则：/, 'the matrix must not add a redundant prose rule below the visual schedule');
assert.doesNotMatch(smartBusinessSource, /matrixSystemLayers|谁来建立信任|aria-label="按平台查看账号"/, 'the deleted dark explainer and duplicate platform cards must not remain');
assert.doesNotMatch(matrixViewSource, /MatrixPublicationSchedule|管理连接账号|账号职责与连接状态/, 'the employee workspace must remove account publishing and configuration panels');
assert.doesNotMatch(matrixViewSource, /本周账号更新完成度/, 'pure account completion statistics must move to the data review');
assert.doesNotMatch(smartBusinessSource, /各账号周更稳定度/, 'the account matrix must not render an empty stability chart');
assert.doesNotMatch(matrixViewSource, /<ContentGenerationProgress/, 'the removed per-video production section must not render in the matrix');
assert.match(pageSource, /onOpenContent=\{openContentProduction\}/, 'Smart Business content links must preserve the current Agent task when opening Studio');
assert.match(dashboardRoutesSource, /view === "review"\) return <BusinessDataReview[^>]*data=\{data\}/, 'all account, content, inquiry and advertising details must route into the dedicated data review');
assert.doesNotMatch(smartBusinessSource, /原“内容监控”页已合并到这里/, 'account monitoring must not retain migration copy');
assert.doesNotMatch(smartBusinessSource, /当前失败原因|reasonCounts/, 'Smart Business must not aggregate or display blocked-task reasons as a failure chart');
assert.doesNotMatch(smartBusinessSource, /成本建议/, 'the content queue must not show cost advice');
assert.match(businessDataReviewSource, /buildReviewAccounts/, 'review ranking must project connected accounts');
assert.match(businessDataReviewSource, /SocialPlatformIcon platform=\{account\.platform\}/, 'review ranking must render each account platform identity');
assert.match(businessDataReviewModelSource, /performance\?\.accounts[\s\S]{0,500}candidates\.values\(\)/, 'review ranking must include connected accounts without a hard-coded platform whitelist');
for (const platform of ['YouTube', 'TikTok', 'Instagram', 'Facebook']) assert.match(socialPlatformIconSource, new RegExp(platform), `review ranking must expose ${platform}`);
assert.match(businessDataReviewSource, /loadConnectedSocialPerformance/, 'review must read the same connected-account performance source as Content Monitoring');
assert.match(socialPerformanceSource, /\/api\/overseas\/youtube\/accounts[\s\S]{0,500}\/api\/overseas\/social\/accounts/, 'performance loading must use the real account endpoints shared with Content Monitoring');
for (const removedReviewCopy of ['全部账号', '暂无内容播放量', '热度候选', '加入 1 条验证任务', '暂无待办，可从上方建议直接加入', '先给出用户可阅读、可验证的结论', '给你看：结论、依据、原始来源', '系统使用：下一周编导与内容约束']) {
  assert.doesNotMatch(smartBusinessSource + nextRoundRecommendationsSource, new RegExp(removedReviewCopy), `data review must remove ${removedReviewCopy}`);
}
assert.match(inspirationSource, /对标账号/, 'Inspiration Center must expose benchmark accounts as its own page');
assert.match(competitorAccountsSource, /embedded/, 'benchmark accounts must support an embedded standalone page instead of only a modal');
for (const role of ['orchestrator', 'business', 'director', 'content', 'customer']) {
  assert.match(onboardingPanelSource + presentationPolicySource, new RegExp(`id: ["']${role}["']`), `settings must expose the ${role} role card`);
}
assert.doesNotMatch(onboardingPanelSource + presentationPolicySource, /\{ id: ["']industry["']/, 'legacy industry must not remain a public role card');
assert.match(presentationPolicySource, /id: ['"]business['"][\s\S]{0,400}workflows: \[['"]content_publish['"]\]/, 'content publishing belongs to the business Agent');
assert.match(presentationPolicySource, /id: ['"]content['"][\s\S]{0,400}workflows: \[\]/, 'the content Agent renders and quality-checks without owning publishing');
assert.match(onboardingPanelSource, /activeRuleAgent === "business"[\s\S]{0,2200}周草稿、发布平台与具体账号/, 'publishing controls belong to the business Agent panel');
for (const label of ['经营 Agent', '编导 Agent', '内容 Agent', '客服 Agent', '当前动作', '查看详情']) {
  assert.match(executionStatusSource, new RegExp(label), `live Agent status must expose ${label}`);
}
for (const color of ['#7c3aed', '#2563eb', '#0f9f82', '#d97706']) {
  assert.match(executionStatusSource, new RegExp(color), `each Agent must keep its own execution color: ${color}`);
}
assert.match(executionStatusSource, /agent-live-card--running/, 'running Agent cards must expose an animation hook');
assert.match(executionStatusSource, /tasks\.filter\(task => \['succeeded', 'completed'\]\.includes\(task\.status\)\)\.length/, 'Agent progress must come from persisted task completion rather than fabricated percentages');
assert.match(onboardingPanelSource + presentationPolicySource, /synchronizeThemeContentWorkflows[\s\S]{0,500}contentCreationWorkflows/, 'saving the unified switch must retain the legacy workflow ids');
assert.doesNotMatch(weeklyGoalPanelSource, /<VideoPlanEditor/, 'the first weekly confirmation must not expose the detailed video editor');
assert.match(weeklyGoalPanelSource, /buildPresetMatrixVideoPlans/, 'the simplified controls must still build the established themed content plan internally');
for (const persona of ['B2B 从零起步', 'B2B 已有基础', '品牌影响', 'DTC 直接销售']) {
  assert.match(taskPackagePresetSource, new RegExp(persona), `weekly task packages must include ${persona}`);
}
assert.match(weeklyPlanConfirmationSource, /确认预算并开始生成/);
assert.match(weeklyGoalPanelSource, /本周准备怎么做/, 'weekly planning should start from a concise editable proposal');
assert.match(weeklyPlanConfirmationSource, /返回修改方案/);
assert.doesNotMatch(weeklyGoalPanelSource, /系统生成的目标设置（需要时可修改）/);
assert.doesNotMatch(pageSource, /更多目标设置（可选）/);
assert.doesNotMatch(weeklyGoalPanelSource, /本周最想解决什么|查看并调整具体视频计划（可选）/);
assert.match(weeklyGoalPanelSource, /投流计划[\s\S]{0,2600}budgetCny/, 'promotion scope and per-video spend must remain editable in the first step');
assert.match(videoPlanEditorSource, /数字员工制作路径[\s\S]{0,500}爆款复刻[\s\S]{0,500}历史任务/, 'Agent video plans must show clone-only routing while keeping legacy routes readable');
assert.doesNotMatch(videoPlanEditorSource, /脚本来源\s*<select/, 'Agent video plans must not expose free-creation route selection');
assert.match(videoPlanEditorSource, /themeWorkflow \? '内容参考' : '爆款参考'/, 'legacy clone plans must use a neutral reference label in theme workflow mode');
assert.doesNotMatch(pageSource, /<BusinessLineNav/, 'unmounted legacy business filters must not return');
assert.doesNotMatch(pageSource, /frontend_preview|BUSINESS_PREVIEW|PreviewExecutionPanel|示例数据预览中|查看示例数据/, 'the production cockpit must not contain or expose synthetic operating receipts');
assert.doesNotMatch(pageSource, /<dt className="inline text-slate-400">(?:目标版本|计划锁定配置)/, 'the operating context strip must not expose technical record metadata');
assert.match(libSource, /configSnapshot\?: DigitalEmployeeConfig/, 'the plan API contract must retain its immutable config snapshot');
assert.match(pageSource, /useState<WorkspaceView>\(["']today["']\)/, 'regular login must land on Today Overview by default');
assert.match(pageSource, /workspaceView === "live"[\s\S]{0,120}selectedContentItemId \? "production" : "review"/, 'live production must route to the active dashboard production view');
assert.match(pageSource, /workspaceView === "review" \? "review" : "home"/, 'the dashboard must route overview and review to their active views');
assert.match(pageSource, /workspaceView === ["']rules["'][\s\S]{0,8000}(?:OnboardingPanel|approvalPolicy|\u89c4\u5219)/, 'Rules and Permissions must have its own render branch');

assert.match(packageSource, /<WeeklyExecutionNodes[^>]+data=\{data\}/, 'the current task package must render persisted execution nodes');
assert.match(pageSource, /readiness=\{data\.businessSnapshot\?\.readiness\s*\|\|\s*\[\]\}/, 'Agent settings must receive readiness from the saved business snapshot instead of inventing it');
assert.match(packageSource, /确认范围并启动/, 'first-run goal approval must expose the package scope confirmation');
assert.match(pageSource, /statusSource: planTask\?\.statusSource/, 'task deep links must preserve the persisted plan status source');
assert.match(onboardingPanelSource, /\/api\/overseas\/enterprise\/profile/, 'the onboarding product table must be loaded from the tenant enterprise knowledge profile');
assert.match(firstOnboardingSource, /label="企业名称"[\s\S]*label="品牌名称"[\s\S]*label="行业\/主营分类"[\s\S]*<Select[\s\S]*CATEGORY_OPTIONS/, 'first onboarding step must establish identity with the shared industry choices');
assert.doesNotMatch(firstOnboardingSource, /label="主要提供什么"/, 'the first onboarding step must not duplicate the product step');
assert.doesNotMatch(firstOnboardingSource, /目标市场|核心客户|经营目标|预算|周产量|数字人/, 'first onboarding step must not ask for downstream operating or production settings');
assert.match(productTableOnboardingSource, /primaryLabel="确认主推产品，下一步"/, 'second onboarding step must confirm one to three focus products before continuing');
assert.match(productTableOnboardingSource, /deferLabel="稍后设置"[\s\S]*onDefer/, 'the product step must allow deferring only product setup');
assert.match(productTableOnboardingSource, /headerAction=\{[\s\S]{0,1200}<Upload[\s\S]{0,700}上传产品资料/, 'product upload must live in the step header');
assert.match(productTableOnboardingSource, /return Upload\.LIST_IGNORE/, 'the product file picker must not post to an implicit upload endpoint');
assert.match(productTableOnboardingSource, /accept="\.xlsx,\.xls,\.csv,\.pdf,\.docx,\.txt"/, 'product onboarding must accept spreadsheet, PDF, DOCX and TXT files');
assert.doesNotMatch(productTableOnboardingSource, /支持 Excel（\.xlsx\/\.xls）、CSV、PDF、Word（\.docx）和 TXT|系统自动识别表格|单个文件最大 50MB/, 'product onboarding must not retain the removed format explanation');
assert.doesNotMatch(productTableOnboardingSource, /企业知识库产品表/, 'product onboarding must not retain the redundant product-table heading row');
assert.match(onboardingPanelSource, /importOnboardingProducts\(file, knowledgeProducts\)/, 'the product picker must call the extracted draft import path');
assert.doesNotMatch(onboardingProductImportSource, /\/api\/overseas\/enterprise\/profile|method:\s*['"]PATCH['"]/, 'product import must remain an unconfirmed draft until the final confirmation');
assert.match(onboardingProductImportSource, /xlsx\?\|csv\|pdf\|docx\|txt[\s\S]{0,300}请选择 Excel、CSV、PDF、Word 或 TXT 文件/, 'product onboarding must validate supported file types after removing the explanation');
assert.match(onboardingProductImportSource, /file\.size > 50 \* 1024 \* 1024[\s\S]{0,220}文件不能超过 50MB/, 'product onboarding must validate the documented file-size limit');
assert.match(onboardingProductImportSource, /parseProductDocument\(file\)/, 'product onboarding must parse PDF and DOCX through the document importer');
assert.doesNotMatch(onboardingProductImportSource, /for\s*\(const image of documentResult\.unassignedImages\)[\s\S]{0,250}uploadProductEvidence/, 'unassigned document images must not be uploaded without an owned product binding');
assert.match(onboardingPanelSource, /张图片暂未单独绑定产品，但仍保留在原始文件证据中/, 'unassigned document images must remain auditable through the original source evidence');
assert.match(onboardingProductImportSource, /productsFromLabeledText\(await readProductDiscoveryFile\(file\)\)/, 'product onboarding must parse labeled TXT product fields');
assert.match(productTableOnboardingSource, /最多选择 3 个[\s\S]{0,1000}类目[\s\S]{0,600}核心卖点/, 'product onboarding must bound focus suggestions and collect the facts required for later production');
assert.doesNotMatch(productTableOnboardingSource, /本期暂无产品，先继续|Agent 设置/, 'product onboarding must not bypass the required product baseline or ask for Agent settings');
assert.doesNotMatch(onboardingPanelSource, /<InitialOperatingPlanDialog|allowInitialPlan/, 'first onboarding must not force an operating plan, budget, weekly output, or production start');
assert.match(initialPlanSaveSource, /const api = context\.api \|\| digitalEmployeeApi/, 'the extracted action must use the canonical API by default');
for (const operation of ['api.createGoal', 'api.savePackage', 'api.startInitialPreparation']) {
  assert.ok(initialPlanSaveSource.includes(operation), `the first recommended plan must persist and start through ${operation}`);
}
assert.doesNotMatch(initialPlanSaveSource, /setData\(created\)/, 'partial initial-plan persistence must not unmount onboarding before the full chain can finish or retry');
assert.match(initialPlanSaveSource, /api\.initialPreparation\(next\.goal\.id\)[\s\S]{0,500}existingPreparation\.preparation/, 'retrying onboarding must resume an already-created initial preparation instead of duplicating its goal');
assert.match(initialPlanSaveSource, /initial-\$\{created\.goal\.id\.replace/, 'initial preparation retries must use a stable goal-derived request id');
assert.match(initialPlanSaveSource, /initialOperatingPlanFingerprint\(plan\)[\s\S]{0,500}next\.goal\.constraints\.includes\(fingerprintConstraint\)/, 'retrying a partial first plan must refuse edits that would bind a new plan to the old goal');
assert.doesNotMatch(pageSource, /<InitialPreparationStatusPanel/, 'initial-preparation progress must not revive the removed weekly-plan detail page');
assert.match(initialPreparationSource, /digitalEmployeeApi\.initialPreparation\(goalId\)/, 'initial-preparation progress must come from the persisted backend state');
assert.match(configuredWorkspaceSource, /<OnboardingPanel[\s\S]{0,500}const saved = await saveConfig\(config\)/, 'reopening the guide must save the confirmed baseline without creating an initial plan');
assert.match(agentWeeklyCalendarSource, /projectCalendarDeliverables\(tasks\)/, 'the Agent calendar must collapse scoped production internals into user-visible deliverables');
assert.match(agentWeeklyCalendarSource, /selected\.accountBindingTarget[\s\S]{0,450}绑定发布账号/, 'the Agent calendar must expose account-binding exceptions as actionable work');
assert.match(agentWeeklyCalendarSource, /task.date === key\(day\)/, '保留本地日历按原任务日期展示绑定工作');
assert.match(connectedAgentCalendarSource, /mainTasks=\{\[\.\.\.accountBindingTasks,/, 'account-binding exceptions must be shown alongside persisted weekly tasks');
assert.match(matrixScheduleSource, /projectAccountBindingCalendar\(visibleTasks, accountConnections\)/, 'account selection must scope projected binding work to visible tasks');
assert.doesNotMatch(initialPlanSaveSource, /productionApi\.defaults\(\)/, 'skipping presenter setup may still save the initial plan; the hard gate belongs immediately before production start');

assert.match(pageSource, /<SmartBusinessDashboard data=\{data\} view=\{dashboardView\}/, 'the current week view must mount the active dashboard');
for (const label of ['本周进度', '需要你处理']) {
  assert.match(todayFocusSource, new RegExp(label), `the focus panel must include ${label}`);
}
assert.match(todayFocusSource, /attentionItems\.slice\(0, 3\)/, 'attention items must stay bounded');
assert.match(pageSource, /businessSnapshot\?\.readiness/, 'readiness must use the server business snapshot');

assert.match(liveSceneSource, /\u5185\u5bb9\u751f\u4ea7\u73b0\u573a/, 'the shared component must expose the content production scene');
assert.match(onboardingPanelSource, /displayedReadiness[\s\S]{0,1800}knowledgeProducts\.length/, 'onboarding readiness must immediately reflect the product draft on the current page');
for (const label of ['经营 Agent', '编导 Agent', '内容 Agent', '内容 Agent · 质检能力', '脚本与分镜', '逐镜素材', '配音、字幕与人物', '剪辑与渲染', '质检与局部返工']) {
  assert.match(liveSceneSource, new RegExp(label), `the shared production scene must expose ${label}`);
}
assert.match(liveSceneSource, /负责：\{item\.agent\}[\s\S]{0,120}预计：\{item\.duration\}/, 'every visible production step must identify its responsible Agent and estimated duration');
assert.doesNotMatch(liveSceneSource, /agent:\s*['"](?:字幕|口播|成片) Agent['"]/, 'sub-capabilities must not be presented as independent Agents');
assert.doesNotMatch(liveSceneSource, /absolute inset-0|AgentBrowserViewport|DirectorTaskContext/, 'the production scene must not trap scrolling or embed the old technical monitoring UI');
assert.doesNotMatch(liveSceneSource, /\u601d\u8003\u4f9d\u636e|chain[_ -]?of[_ -]?thought/i, 'the UI must not claim to expose private model reasoning');
assert.match(boardSource, /function DeliveryBoard/, 'execution center must render a real task kanban');
assert.match(boardSource, /onOpenTask\(\{ \.\.\.selected\.link!.*deliveryId: selected\.id/, 'delivery detail must open its resource-specific business page');
assert.match(pageSource, /dispatchDigitalEmployeeDeepLink\(buildTaskDeepLink\(task, planTask, data\.run\?\.id \|\| task\.run_id\)\)/, 'the selected task must enter its mapped business workspace');
assert.match(pageSource, /task\.business_line[\s\S]{0,200}task\.business_domain/, 'business-line classification must prefer persisted fields');
assert.doesNotMatch(pageSource, /function taskBusinessLine[\s\S]{0,800}task_key/, 'task classification must not guess from task-key text');
assert.match(libSource, /payload\?\.uiAction/, 'the Agent operation feed must consume persisted worker UI events');
const uiAction = agentUiActionFromEvent({ id: 'event-ui', run_id: 'run-1', task_id: 'task-1', sequence: 1, type: 'agent.ui.click', level: 'info', summary: '点击生成', occurred_at: new Date().toISOString(), payload: { uiAction: { kind: 'click', label: '点击生成', x: 640, y: 360, viewportWidth: 1280, viewportHeight: 720 } } });
assert.deepEqual(agentCursorPercent(uiAction), { left: 50, top: 50 }, 'worker pixel coordinates must map to a stable monitor cursor position');

assert.match(libSource, /correctTask:[\s\S]{0,350}instruction:[\s\S]{0,100}scope:[\s\S]{0,100}rerunDownstream/, 'correction API must preserve all three contract fields');

assert.match(insightSource, /status === 'available'/, 'review findings must use available receipts');
assert.match(batchFollowupSource, /\u6279\u51c6\u7684\u662f\u9010\u5ba2\u8349\u7a3f\u6279\u6b21\uff0c\u4e0d\u7b49\u4e8e\u6d88\u606f\u5df2\u7ecf\u53d1\u51fa/, 'batch approval must not be presented as delivery');
assert.match(batchFollowupSource, /\u53d1\u9001\u6267\u884c\u670d\u52a1\u5f53\u524d\u4e3a\u624b\u52a8\u89e6\u53d1\u6a21\u5f0f/, 'the batch panel must distinguish manual mode from a ready automatic worker');
assert.match(batchFollowupSource, /\u771f\u5b9e\u53d1\u9001\u56de\u6267/, 'the batch panel must wait for provider evidence');
assert.match(batchFollowupSource, /\u53d1\u9001\u5df2\u5230\u671f\u5ba2\u6237/, 'manual-only mode must expose an explicit due-item dispatch action');
assert.match(digitalEmployeeApiSource, /dispatchFollowupBatch:[\s\S]{0,180}followup-batches/, 'the manual dispatch action must call the worker route');

assert.match(pageSource, /<BusinessHealthOverview summaryOnly data=\{data\}/, 'the home overview must mount its real business-health summary');
assert.match(pageSource, /<SmartBusinessDashboard data=\{data\}/, 'the command center must mount its real task-oriented dashboard');
assert.doesNotMatch(pageSource, /function (?:LegacyTodaySnapshotPanel|BusinessMetricCard|DataMetricCard|ConversionFunnelChart)/, 'unmounted legacy snapshot and funnel scaffolding must not return');
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
    agent_role: 'orchestrator',
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
  'source collection must deep-link to the inspiration workspace with run and task context',
);

const adsLink = buildTaskDeepLink({ ...task('optimize_campaign'), business_domain: 'advertising', capability_key: 'ads.optimize' }, undefined, 'run-ads');
assert.equal(adsLink.page, 'adsManaged', 'advertising tasks must open the managed ads workspace');
assert.equal(adsLink.runId, 'run-ads');
assert.equal(adsLink.taskId, 'task-optimize_campaign');

const publishPlan: PlanTask = {
  key: 'publishing_calendar', title: 'Publishing calendar', description: '', agentRole: 'business', kind: 'activation', sequence: 9,
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

assert.match(digitalEmployeeNavigationSource, /workflowRunId:\s*link\.runId/, 'Studio navigation must carry an explicit workflow run id');
assert.match(digitalEmployeeNavigationSource, /workflowTaskId:\s*link\.taskId/, 'Studio navigation must carry an explicit workflow task id');
assert.match(digitalEmployeeNavigationSource, /CustomEvent\(["']lingshu:navigate["'],\s*\{\s*detail:\s*navigationDetail\s*\}\)/, 'deep-link navigation must emit the full workflow/business reference');
assert.match(appSource, /setSmartAssetsView\(detail\.view === ["']publish["'] \? ["']publish["'] : ["']create["']\)/, 'the application shell must honor create versus publish deep links');

assert.match(onboardingPanelSource, /allowGeneratedVisuals:\s*false/, 'generated visuals must default to fail-closed');
assert.match(weeklyLaunchSource, /setWorkspaceView\(launchedStatus\?\.phase === ["']running["'] \|\| launchedStatus\?\.phase === ["']queued["'] \? ["']matrix["'] : ["']live["']\)[\s\S]{0,220}setSelectedTaskId/, 'approving a plan must route from the real launch state while preserving task focus');
assert.match(onboardingPanelSource, /scrollIntoView\([\s\S]{0,120}behavior:\s*getScrollBehavior\(\)/, 'first-run transitions must focus the next required panel while respecting reduced-motion preferences');
assert.match(onboardingPanelSource, /readEnterpriseOnboardingDraft\(\)[\s\S]{0,5000}persistedDraft\?\.baseFactVersion === factVersion/, 'the guide must resume only a draft based on the current enterprise fact version');
assert.match(onboardingPanelSource, /setDraftRevision\(persistedDraft\?\.revision \|\| draftResult\.revision\)/, 'stale, restarted, and cleared drafts must retain only their server CAS revision cursor');
assert.match(onboardingPanelSource, /saveEnterpriseOnboardingDraft\(buildOnboardingDraft\(nextStep, productDeferredOverride\), draftRevision\)/, 'each transition, including product deferral, must persist the shared draft with an expected revision');
assert.doesNotMatch(onboardingPanelSource, /saveEnterpriseProfile|saveSocialContentStage/, 'intermediate steps must not write partially confirmed enterprise facts');
assert.match(onboardingStepsSource, /step=\{3\} title="确认面向谁、在哪里沟通，以及唯一 CTA"[\s\S]{0,1800}主要目标市场[\s\S]{0,600}主推买家[\s\S]{0,600}主平台[\s\S]{0,1000}唯一 CTA/, 'the third step must collect the complete market, audience, platform, stage, language, and CTA baseline');
assert.match(onboardingStepsSource, /aria-label="主要目标市场" mode="tags"[\s\S]{0,400}ONBOARDING_MARKET_OPTIONS/, '目标市场应提供可搜索、可多选并兼容自定义的选项');
assert.match(onboardingStepsSource, /aria-label="主推买家" mode="tags"[\s\S]{0,400}ONBOARDING_BUYER_OPTIONS/, '主推买家应提供选项并保留既有自定义资料');
assert.match(onboardingPanelSource, /completeMinimalOnboarding[\s\S]{0,600}validateEnterpriseOnboardingConfirmation[\s\S]{0,900}minimalOnboarding:\s*true[\s\S]{0,200}onboardingConfirmation:/, 'minimal onboarding may complete only with the validated final confirmation payload');
assert.match(enterpriseOnboardingDraftRouteSource, /supportsAtomicCompareAndSwapFor[\s\S]{0,300}compareAndSwap/, 'draft updates must fail closed when atomic revision persistence is unavailable');
assert.match(enterpriseOnboardingConfirmationSource, /expected !== current\.factVersion\?\.id[\s\S]{0,1200}updateTenantEnterpriseProfile[\s\S]{0,5000}readTenantEnterpriseProfileStrict/, 'final confirmation must guard the base version, write once, and strictly reread authoritative facts');
assert.match(pageSource, /!data\?\.config \|\|[\s\S]{0,250}viewGoalId \|\|[\s\S]{0,250}!run/, 'first-time onboarding must not subscribe to an obsolete run stream');
assert.match(pageSource, /overviewRequestVersionRef/, 'late overview responses must be versioned so they cannot overwrite a completed mutation');
assert.match(digitalEmployeeApiSource, /class DigitalEmployeeApiError[\s\S]{0,300}readonly code:[\s\S]{0,300}readonly details:/, 'digital employee API failures must retain a structured code and details payload');
assert.match(digitalEmployeeApiSource, /isObjectBody[\s\S]{0,1800}\{ \.\.\.\(rawBody as Record<string, unknown>\) \}/, 'structured API errors must preserve the complete raw response object for recovery decisions and diagnostics');
assert.match(digitalEmployeeApiSource, /rebuildGoalRequests = new Map<[\s\S]{0,100}Promise<DigitalEmployeeOverview>/, 'fact rebuild requests must share one in-flight registry');
for (const field of ['requestId', 'expectedGoalVersion', 'sourcePlanId', 'expectedFactsVersion', 'expectedSourcePlanDigest']) {
  assert.match(libSource, new RegExp(`${field}:`), `the frontend rebuild protocol must require ${field}`);
}
assert.match(digitalEmployeeApiSource, /function rebuildGoalFromLatestFacts[\s\S]{0,300}input: EnterpriseFactsRebuildInput[\s\S]{0,800}rebuildGoalRequests\.get\(key\)[\s\S]{0,500}rebuild-from-latest-facts[\s\S]{0,200}JSON\.stringify\(input\)/, 'fact rebuilds must deduplicate identical guarded requests and send the full source-plan protocol to the dedicated endpoint');
assert.match(enterpriseFactsRecoverySource, /instanceof DigitalEmployeeApiError[\s\S]{0,180}actionError\.code !== ENTERPRISE_FACTS_CHANGED_ERROR_CODE/, 'only the structured enterprise_facts_changed code may trigger automatic recovery');
assert.match(enterpriseFactsRecoverySource, /enterpriseFactsRebuildInput\(staleGoal, actionError\.details\)[\s\S]{0,900}context\.pending\.get\(recoveryKey\)/, 'fact recovery must require conflict-provided source-plan evidence and coalesce only an identical guarded rebuild');
assert.match(enterpriseFactsRecoverySource, /catch \{[\s\S]{0,80}return false/, 'missing or malformed source-plan evidence must fall back without attempting automatic rebuild');
assert.match(enterpriseFactsRecoverySource, /context\.rebuildGoal \|\| digitalEmployeeApi\.rebuildGoalFromLatestFacts[\s\S]{0,2200}rebuildGoal\(staleGoal\.id, rebuildInput\)/, 'automatic recovery must use the dedicated latest-facts rebuild operation');
assert.match(enterpriseFactsRecoverySource, /let rebuildAttempt = 0[\s\S]{0,700}rebuildAttempt >= 1[\s\S]{0,500}rebuildAttempt \+= 1/, 'a second enterprise fact change may retry the idempotent rebuild once, but recovery must remain bounded');
assert.match(enterpriseFactsRecoverySource, /setData\(rebuilt\)[\s\S]{0,700}计划已按最新企业资料重建[\s\S]{0,300}新版周计划已回到智能经营[\s\S]{0,200}重新核对计划并确认开始生产/, 'successful recovery must replace the overview and require a fresh review without replaying the stale launch');
assert.doesNotMatch(enterpriseFactsRecoverySource, /digitalEmployeeApi\.(?:savePackage|approveGoal|startInitialPreparation|generatePackageDetails|recommendPackage)/, 'recovery must never replay the stale save, approval, launch, or generation action');
assert.match(mutationActionSource, /catch \(actionError\)[\s\S]{0,180}recoverEnterpriseFactsChanged\(actionError, actionGoal\)[\s\S]{0,80}return null/, 'mutations must stop after handled fact recovery instead of replaying the original action');
assert.match(confirmWeeklyPlanSource, /catch \(actionError\)[\s\S]{0,180}recoverEnterpriseFactsChanged\(actionError, goal\)[\s\S]{0,40}return/, 'plan confirmation must stop after rebuilding and must not auto-start the replacement plan');
assert.doesNotMatch(pageSource, /经营包未保存，请检查页面提示后重试|未能启动，请检查账号、资料和授权范围后重试/, 'a handled rebuild must not be replaced by the legacy red save or launch blocker');
assert.match(onboardingStepsSource, /step=\{4\} title="最后核对一次，确认后写入企业知识库"[\s\S]{0,2500}SourceBadge[\s\S]{0,2500}当前企业事实版本/, 'the fourth step must be a source-marked confirmation against an explicit fact version');
assert.doesNotMatch(firstOnboardingSource, /公开联系方式|预算|周产量|开始生产|数字人/, 'the minimal baseline must not force contact, budget, weekly output, production, or presenter setup');
assert.match(onboardingStepsSource, /function PresenterSetupDialog[\s\S]{0,1000}数字人不是首次建档条件/, 'presenter setup must remain a separate task-time flow');
assert.match(onboardingPanelSource, /initialStep === 'presenter'[\s\S]{0,300}<PresenterSetupDialog/, 'the separate presenter flow must open only from its explicit entry');
assert.match(onboardingStepsSource, /<Form[^>]+layout="vertical"[^>]+aria-label="企业与品牌资料"/, 'enterprise-and-brand onboarding must use the themed Ant form contract');
assert.match(onboardingStepsSource, /<Form[^>]+layout="vertical"[^>]+aria-label="市场与内容方向"/, 'market onboarding must use the themed Ant form contract');
const enterpriseOnboardingFormTag = firstOnboardingSource.match(/<Form\b[^>]*aria-label="企业与品牌资料"[^>]*>/)?.[0] ?? '';
assert.ok(enterpriseOnboardingFormTag, 'enterprise-and-brand onboarding form must remain present');
assert.doesNotMatch(enterpriseOnboardingFormTag, /rounded-lg|\bborder\b|bg-surface|\bp-5\b/, 'enterprise onboarding must not recreate the removed outer card');
assert.match(onboardingStepsSource, /applicationGuideSteps[\s\S]{0,160}label: ['"]企业与品牌['"][\s\S]{0,120}label: ['"]产品与主推['"][\s\S]{0,120}label: ['"]市场与内容['"][\s\S]{0,120}label: ['"]综合确认['"]/, 'Ant Steps must expose the four guided steps in their required order');
assert.match(enterpriseOnboardingContractSource, /EnterpriseOnboardingSource = 'user_provided' \| 'system_detected' \| 'ai_suggested'/, 'the confirmation contract must preserve field provenance without treating system inference as AI output');
assert.match(onboardingGuideFrameSource, /<LsFlowDialog[\s\S]{0,600}steps=\{applicationGuideSteps\.map/, 'the beginner guide must use the shared flow dialog and Ant Steps contract');
assert.match(pageSource, /active && applicationGuideOpen/, 'the onboarding modal must not mount while the retained digital employee Activity is hidden');
assert.match(pageSource, /deferredOpen = window\.setTimeout\([\s\S]{0,300}setApplicationGuideOpen\(true\)/, 'a retained page must defer the modal until Activity effect reconnection has completed');
assert.match(appPageSlotSource, /<DigitalEmployeePage active=\{page === 'digitalEmployees'\}/, 'the shell must tell the retained page when it is visible');
assert.match(onboardingGuideFrameSource, /footer=\{\[[\s\S]{0,900}<LsBrandAction/, 'the guide must keep a single branded primary action in the fixed modal footer');
assert.match(onboardingGuideFrameSource, /<Button key="skip"[^>]*onClick=\{onClose\}[^>]*>跳过<\/Button>/, 'every dismissible guide step needs an explicit skip action');
assert.doesNotMatch(pageShellSource, /firstGuideOpen/, 'first-time users must land on the overview instead of an automatically blocking guide');
assert.doesNotMatch(pageShellSource, /aria-label="数字员工尚未配置"/, 'skipping onboarding must not replace the default overview with a blocking placeholder page');
assert.match(onboardingPanelSource, /const saveDraftAndClose = async \(\) => \{[\s\S]{0,150}if \(saved\) onClose\?\.\(\)/, 'skip must close only after the current draft is saved');
assert.doesNotMatch(onboardingGuideFrameSource, /OnboardingStepVisual|企业与品牌关系图|产品资料入库流程图|社媒经营阶段选择图|数字人统一接入图/, 'the beginner guide must not reserve space for redundant explanatory diagrams');
assert.match(onboardingGuideFrameSource, /<section aria-labelledby=\{`onboarding-step-\$\{step\}-title`\}>/, 'the current onboarding form must use the full dialog content width');
assert.match(onboardingGuideFrameSource, /justify-between[\s\S]{0,300}<h2[\s\S]{0,300}\{headerAction\}/, 'optional step actions must share the responsive title row');
assert.match(socialContentStageOnboardingSource, /SOCIAL_CONTENT_STAGE_PROFILES\.filter\(\(profile\) => profile\.id !== 'd2c_brand'\)/, 'the beginner guide must expose only the supported B2B operating stages');
assert.doesNotMatch(initialOperatingPlanSource, /<option value="d2c_brand">/, 'the recommended plan must not reintroduce the removed D2C onboarding choice');
assert.match(onboardingPanelSource, /socialContentStageProfile\(profile\.socialStrategy\?\.contentStage\)\?\.id/, 'a persisted supported social stage must hydrate from the enterprise fact profile');
assert.doesNotMatch(onboardingGuideFrameSource, /<aside\b|#7C3AED|values:\s*applicationGuideSteps|title=\{null\}/, 'the guide must not simulate an app sidebar or use fabricated chart progress');
assert.match(pageSource, /applicationGuideOpen && \([\s\S]{0,700}restartFromBeginning[\s\S]{0,300}dismissible/, 'configured users must reopen the shared guide as a dismissible flow dialog');
assert.doesNotMatch(pageSource, /<Drawer\b/, 'the application guide must not retain the legacy drawer container');
assert.doesNotMatch(pageSource + onboardingPanelSource + onboardingStepsSource, /其他经营信息在实际任务需要时再确认。|这里只建立产品资料，不选择重点产品；|选择最接近当前情况的一项，我们会为你准备更合适的内容方向。/, 'guided step headers must not include legacy subtitles');
assert.doesNotMatch(pageSource, /第五步/, 'first-time onboarding must end after the fourth step');
assert.doesNotMatch(pageSource, /rulesStepSaved/, 'onboarding must not keep a redundant fourth-step state');
assert.match(digitalEmployeeRouteSource, /minimalOnboarding[\s\S]{0,1800}enabledWorkflows:\s*\['viral_clone'\]/, 'minimal onboarding must create clone-only Agent content capability');
assert.doesNotMatch(pageSource + onboardingPanelSource + onboardingStepsSource, /id:\s*["'](?:product_content|material_content)["']/, 'digital employee settings must not expose free-creation capabilities');
assert.match(digitalEmployeeRouteSource, /!minimalContentStage\s*\?\s*\['社媒经营阶段'\]/, 'minimal onboarding must reject completion until the application-level social stage exists');
assert.match(digitalEmployeeRouteSource, /const enterprisePatch = minimalOnboarding \? \{[\s\S]{0,500}brand:\s*\{ \.\.\.enterprise\.brand, name: minimalBrandName \}/, 'minimal defaults must not be written as fabricated enterprise facts');
assert.match(pageSource, /applicationGuideOpen[\s\S]{0,1000}restartFromBeginning/, 'configured users must have an application-level entry to reopen onboarding');
assert.match(pageSource, /function OnboardingWelcome[\s\S]{0,600}<Modal open title="准备工作已经完成"[\s\S]{0,600}开始使用灵枢/, 'first completion must show an accessible completion modal with a clear next step');
assert.match(enterpriseProfileContractsSource, /brand:\s*\{[\s\S]{0,100}name:\s*string/, 'EnterpriseProfile must store a brand name');
assert.match(enterpriseProfileStoreSource, /const brandInput[\s\S]{0,500}name:\s*text\(brandInput\.name\)/, 'brand name must be normalized as text');
assert.match(onboardingProductImportSource, /id:\s*String\(existing\.id \|\| existing\.productId \|\| product\.id\)/,
  're-importing the onboarding product table must retain the existing stable product id');
assert.match(enterpriseRouteSource, /mergeEnterpriseProductIdentity\(next\[index\], product, index\)/,
  'server-side product API upserts must retain the existing stable product id');
assert.match(enterpriseProfileStoreSource, /return \{[\s\S]{0,200}\bcompany,[\s\S]{0,100}\bbrand,/, 'normalized brand must be returned and preserved by recursive profile merge');
assert.match(pageSource, /weeklyPlanOpen && \(!goal \|\| newGoal\) && !activeRun/, 'an active run must suppress the new-goal editor instead of exposing a duplicate plan flow');
assert.match(weeklyLaunchSource, /const presentConfirmedWeeklyExecution[\s\S]{0,500}setWeeklyPlanOpen\(false\)[\s\S]{0,120}setNewGoal\(false\)/, 'a successful direct start must close and reset any new-goal editor state');
assert.match(pageSource, /weeklyPlanOpen && \(!goal \|\| newGoal\) && !activeRun/, 'an active run must hide the next-goal editor');
assert.doesNotMatch(confirmWeeklyPlanSource, /firstMissingReadiness|approvalBlocked/, 'readiness gaps must be resolved in their production stage, not as a blanket launch gate');
assert.match(packageSource, /issues.length > 0/, 'invalid packages must block launch and explain missing dependencies');
assert.match(pageSource, /<WeeklyPlanDetailsDrawer data=\{data\} open/, 'the active weekly plan must expose persisted plan details');
assert.match(packageSource, /每条内容发布到一个账号计一次/, 'bounded publishing must explain that the limit counts actual account-level publish actions');
assert.doesNotMatch(pageSource, /required\.add\(["'](?:products|viral_library|customers)["']\)/, 'new tenants must not be blocked from starting merely because products, inspiration, or customers are still empty');

assert.match(smartBusinessSource, /<ProductionTaskScene runId=\{data\.run\.id\} taskId=\{item\.taskId\} embedded\/>/, 'the selected content item must mount the current production scene');
assert.match(pageSource, /onRetryTask=\{async taskId => Boolean\(await act\(`retry:\$\{taskId\}`, \(\) => digitalEmployeeApi\.retryTask\(taskId\)\)\)\}/, 'the dashboard retry action must use the canonical task API');
assert.doesNotMatch(pageSource, /function (?:ProductionScene|BlockedTaskActions|CorrectionPanel|EventTimeline|AgentOperationFeed)/, 'unmounted legacy production controls must not be mistaken for current UI');
for (const endpoint of ['retryTask', 'skipTask', 'completeTask']) {
  assert.match(libSource, new RegExp(`${endpoint}:[\\s\\S]{0,250}/tasks/`), `${endpoint} must call the canonical task route`);
}
assert.match(digitalEmployeeNavigationSource, /digitalEmployee\.returnContext/, 'business deep links must persist a return-to-live context');
assert.match(pageSource, /consumeDigitalEmployeeReturnContext/, 'returning from a business workspace must restore the production task context');
assert.match(digitalEmployeeNavigationSource, /返回数字员工生产现场继续查看此任务/, 'business deep links must retain the return-to-task guidance');
assert.match(reviewSource, /liveReview/, 'an active run must use the server live review rather than fake a final review');
assert.match(reviewSource, /本轮仍在运行，以下为阶段性发现/, 'the review view must label active-run results as provisional');
assert.match(productionSource, /aria-label="生产统计周期"/, 'the overview period selector must expose an accessible group label');
assert.match(productionSource, /aria-pressed=\{period === id\}/, 'the selected overview period must be machine-readable');
assert.match(batchFollowupSource, /dispatch\?\.blocked_reason/, 'the follow-up truth panel must display the server preflight field from dispatch preflight');
assert.match(batchFollowupSource, /manualFollowupSendAllowed/, 'the manual send CTA must be gated by the tenant/provider authorization facts');
assert.match(batchFollowupSource, /真实发送未就绪/, 'the UI must state that real sending is unavailable instead of implying it only waits for time or receipt');
assert.doesNotMatch(pageSource, /sticky top-2 z-40/, 'workspace navigation must scroll with the page instead of covering operating data');
assert.match(assistantSource, /data-global-assistant="root"/, 'the assistant root must remain identifiable');
assert.match(assistantSource, /inlineHomeAnchor \? '[^']+' : `fixed bottom-\[calc\(env\(safe-area-inset-bottom\)\+1rem\)\]/, 'the assistant must retain a fixed entry that clears the device safe area outside the creation home');
assert.match(assistantSource, /launcherRetracted && mode === 'breathing' \? 'right-0 md:right-0' : 'right-4 md:right-5'/, 'the expanded assistant entry must keep its bottom-right page inset');

const fingerprintConfig: DigitalEmployeeConfig = {
  companyName: '灵枢', industry: '制造', primaryBusiness: '设备', targetMarkets: '美国', customerProfile: '经销商',
  smartOperationsEnabled: true,
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

const originalFetch = globalThis.fetch;
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let contractAuthToken = 'contract-token';
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => contractAuthToken, setItem: () => undefined, removeItem: () => undefined },
});
try {
  let rebuildCalls = 0;
  const rebuildBodies: unknown[] = [];
  const releaseRebuilds: Array<(response: Response) => void> = [];
  globalThis.fetch = (async (_input, init) => {
    rebuildCalls += 1;
    rebuildBodies.push(JSON.parse(String(init?.body)));
    return new Promise<Response>(resolve => { releaseRebuilds.push(resolve); });
  }) as typeof fetch;
  const runtimeRebuildInput = enterpriseFactsRebuildInput({ id: 'goal/a', version: 4 }, factRebuildDetails);
  const firstRebuild = digitalEmployeeApi.rebuildGoalFromLatestFacts('goal/a', runtimeRebuildInput);
  const duplicateRebuild = digitalEmployeeApi.rebuildGoalFromLatestFacts('goal/a', runtimeRebuildInput);
  assert.equal(firstRebuild, duplicateRebuild, 'concurrent recovery calls for one observed goal version must share the same promise');
  assert.equal(rebuildCalls, 1, 'concurrent recovery must issue only one network request');
  assert.deepEqual(rebuildBodies[0], runtimeRebuildInput, 'the rebuild body must include its stable request id and the complete source-plan guard');
  const changedEvidenceInput = enterpriseFactsRebuildInput(
    { id: 'goal/a', version: 4 },
    { ...factRebuildDetails, expectedSourcePlanDigest: 'c'.repeat(64) },
  );
  const changedEvidenceRebuild = digitalEmployeeApi.rebuildGoalFromLatestFacts('goal/a', changedEvidenceInput);
  assert.notEqual(changedEvidenceRebuild, firstRebuild, 'different source-plan evidence must not share an in-flight rebuild even at the same goal version');
  assert.equal(rebuildCalls, 2, 'changed source-plan evidence must be checked by its own guarded request');
  contractAuthToken = 'other-contract-token';
  const otherAuthorizationRebuild = digitalEmployeeApi.rebuildGoalFromLatestFacts('goal/a', runtimeRebuildInput);
  assert.notEqual(otherAuthorizationRebuild, firstRebuild, 'the same goal identity must never share an in-flight rebuild across authorization contexts');
  assert.equal(rebuildCalls, 3, 'a new authorization context must issue its own tenant-scoped rebuild request');
  releaseRebuilds[0](new Response(JSON.stringify({ goal: { id: 'replacement-goal' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  releaseRebuilds[1](new Response(JSON.stringify({ goal: { id: 'changed-evidence-replacement-goal' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  releaseRebuilds[2](new Response(JSON.stringify({ goal: { id: 'other-replacement-goal' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  await Promise.all([firstRebuild, duplicateRebuild, changedEvidenceRebuild, otherAuthorizationRebuild]);

  const structuredFailure = {
    error: 'enterprise_facts_changed',
    message: '企业事实再次更新',
    factVersion: 'facts-v9',
    expectedGoalVersion: 5,
    sourcePlanId: 'source-plan-a',
    expectedFactsVersion: 'facts-v3',
    expectedSourcePlanDigest: 'b'.repeat(64),
    recoveryAction: 'rebuild_weekly_goal',
    diagnostics: { sourceGoalVersion: 4 },
  };
  globalThis.fetch = (async () => new Response(JSON.stringify(structuredFailure), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;
  await assert.rejects(
    () => digitalEmployeeApi.rebuildGoalFromLatestFacts('goal/a', enterpriseFactsRebuildInput({ id: 'goal/a', version: 5 }, structuredFailure)),
    (reason: unknown) => {
      assert.ok(reason instanceof DigitalEmployeeApiError);
      assert.equal(reason.status, 409);
      assert.equal(reason.code, 'enterprise_facts_changed');
      assert.deepEqual(reason.details, structuredFailure, 'the complete raw error object must remain available to callers');
      return true;
    },
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
}

assert.match(pageSource, /title="确认开始本周生产"/, 'weekly production must show a final confirmation before starting');
assert.match(pageSource, /okText="确认周计划"/, 'weekly production must expose one direct plan confirmation action');
assert.doesNotMatch(pageSource, /generationAuthorized|我授权数字员工开始本周内容生成任务/, 'weekly production must not show a separate generation authorization control');
assert.match(pageSource, /纯产品内容不要求数字人形象/, 'the weekly confirmation must not impose a presenter gate on product-only plans');
assert.match(confirmWeeklyPlanSource, /approveGoal\(goal\.id, source\.plan\.businessPackage\.revision, true\)/, 'confirming the weekly plan must implicitly record generation authorization');

console.log('DigitalEmployeePage contract tests passed');

for (const key of ['content_release_approval', 'publishing_calendar', 'platform_publish']) {
  const stale = { ...task(key, 'activation'), destination: 'smartAssets' as const, destination_view: 'create' as const };
  assert.equal(buildTaskDeepLink(stale, undefined, 'run-publish').view, 'publish', `${key} must open publishing despite an obsolete create destination`);
}
