import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./SmartBusinessDashboard.tsx', import.meta.url), 'utf8');
const dashboardSource = source;
const taskPreviewSource = readFileSync(new URL('./smartBusiness/TaskPreviewCards.tsx', import.meta.url), 'utf8');
const start = source.indexOf('export function WeeklyCommandCenter');
const end = source.indexOf('\n\nexport function WeeklyPlanDetailsDrawer', start);
const commandCenter = source.slice(start, end);
const detailsStart = source.indexOf('export function WeeklyPlanDetailsDrawer');
const detailsEnd = source.indexOf('\n\nexport function BusinessInterpretation', detailsStart);
const planDetails = source.slice(detailsStart, detailsEnd);
const interpretationStart = source.indexOf('export function BusinessInterpretation');
const interpretationEnd = source.indexOf('\n\ntype DisplayMetricSource', interpretationStart);
const businessInterpretation = source.slice(interpretationStart, interpretationEnd);
const publishingStart = source.indexOf('function WeeklyPublishingCalendar');
const publishingEnd = source.indexOf('const matrixRoleLabel', publishingStart);
const publishingCalendar = source.slice(publishingStart, publishingEnd);
const budgetStart = source.indexOf('const DEFAULT_VIDEO_COST_CNY');
const budgetEnd = source.indexOf('\n\nfunction metricValue', budgetStart);
const paidMediaHelperStart = source.indexOf('const PAID_MEDIA_CAPABILITY_TOKENS');
const paidMediaHelperEnd = source.indexOf('\n\nexport function WeeklyCommandCenter', paidMediaHelperStart);
assert.ok(start >= 0 && end > start, '周经营计划区必须存在');
assert.ok(detailsStart >= 0 && detailsEnd > detailsStart, '详细周计划必须存在');
assert.ok(interpretationStart >= 0 && interpretationEnd > interpretationStart, '经营解读必须存在');
assert.ok(publishingStart >= 0 && publishingEnd > publishingStart, '数字员工发布日历视图必须存在');
assert.ok(budgetStart >= 0 && budgetEnd > budgetStart, '周计划必须有统一的视频预算投影');
assert.ok(paidMediaHelperStart >= 0 && paidMediaHelperEnd > paidMediaHelperStart, '投流任务必须有精确分类规则');
const budgetContext: Record<string, unknown> = {
  MASTER_VIDEO_COST_MIN_CNY: 10,
  MASTER_VIDEO_COST_POINT_CNY: 12.5,
  MASTER_VIDEO_COST_MAX_CNY: 15,
};
vm.createContext(budgetContext);
vm.runInContext(ts.transpileModule(`${dashboardSource.slice(budgetStart, budgetEnd)}\nglobalThis.weeklyVideoBudget = weeklyVideoBudget;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, budgetContext);
const weeklyVideoBudget = budgetContext.weeklyVideoBudget as (data: unknown) => { estimated: number; min: number; max: number };
const repairedBudget = weeklyVideoBudget({
  plan: { businessPackage: {
    directorPlan: { originalTarget: 2 },
    tasks: [{ templateId: 'production', videoPlans: [
      { estimatedCost: 12.5, estimatedCostRange: { minCny: 10, maxCny: 15 } },
      { estimatedCost: 0, estimatedCostRange: { minCny: 0, maxCny: 0 } },
    ] }],
  } },
});
assert.deepEqual([repairedBudget.estimated, repairedBudget.min, repairedBudget.max], [25, 20, 30], '两条真实计划视频不得继续显示成一条视频的成本');
const paidMediaContext: Record<string, unknown> = {};
vm.createContext(paidMediaContext);
vm.runInContext(ts.transpileModule(`${source.slice(paidMediaHelperStart, paidMediaHelperEnd)}\nglobalThis.isPaidMediaPlanTask = isPaidMediaPlanTask;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText, paidMediaContext);
const isPaidMediaPlanTask = paidMediaContext.isPaidMediaPlanTask as (task: Record<string, unknown>) => boolean;
assert.equal(isPaidMediaPlanTask({ capabilityKey: 'business_readiness', kind: 'readiness', statusSource: 'weekly_plan', title: '盘点企业、产品与授权边界' }), false, 'readiness 中的 ad 字母不得误判为广告任务');
assert.equal(isPaidMediaPlanTask({ capabilityKey: 'platform_ads', kind: 'campaign', statusSource: 'weekly_plan', title: '创建平台计划' }), true, '明确 ads 能力必须识别为投流任务');
assert.equal(isPaidMediaPlanTask({ capabilityKey: 'business', kind: 'planning', statusSource: 'weekly_plan', title: '制定 TikTok 投流预算' }), true, '明确投流标题必须识别为投流任务');
for (const label of ['待验收成片', '本周计划视频', '本周视频总时长', '本周成本范围', '预计制作成本', '已结算成本']) {
  assert.match(commandCenter, new RegExp(label), `周经营计划必须展示“${label}”`);
}
for (const label of ['计划视频', '爆款视频缩略图', '内容结构', '数字人形象', '预计制作成本', '发布计划', '投流计划']) {
  assert.match(planDetails, new RegExp(label), `详细周计划必须用可视化卡片展示“${label}”`);
}
assert.match(planDetails, /display\.contents\.map\(\(item, index\)/, '详细周计划必须覆盖共享模型中的全部计划视频');
assert.match(source, /const showcaseWeeklyVideos = showcaseTotals \? smartBusinessShowcaseWeeklyVideos\(data, true\) : null;[\s\S]*const allContents = showcaseContents\.length \? showcaseContents : mappedContents;[\s\S]*versionCount: contents\.length/, '本地展示的 32 条计划必须进入统一内容清单，计数不得与实际行数脱节');
assert.match(businessInterpretation, /useShowcaseBudget \? display\.totals\.budgetMidCny : Math\.max/, '经营解读必须与周计划清单使用同一份本地预算汇总，不能继续显示旧预算');
assert.match(commandCenter, /operatingContext\?\.budget\.productionMinCny/, '制作成本范围必须读取制作预算，不得把投流预算混入');
assert.match(commandCenter, /operatingContext\?\.budget\.productionMaxCny/, '制作成本上限必须与投流预算分开');
assert.doesNotMatch(commandCenter, /operatingContext\?\.budget\.total(?:Min|Max)Cny/, '周计划制作成本卡不得显示包含投流费用的总预算');
assert.match(commandCenter, /!hasExplicitProductionRange && weeklyQueue\.length/, '已有明确制作预算区间时不得再用预计成本比例放大区间');
const planListStart = planDetails.indexOf('<section aria-label="计划视频清单">');
const planListEnd = planDetails.indexOf('<section className="grid gap-4', planListStart);
const planList = planDetails.slice(planListStart, planListEnd);
const detailDialogStart = planDetails.indexOf('<Modal', planListEnd);
const detailDialog = planDetails.slice(detailDialogStart);
assert.ok(planListStart >= 0 && planListEnd > planListStart, '计划视频摘要清单必须存在');
assert.match(planList, /planRows\.map[\s\S]*爆款视频缩略图[\s\S]*status\.label[\s\S]*单条预算[\s\S]*setSelectedPlanId\(item\.id\)[\s\S]*查看详情/, '初始清单必须逐条展示预览、身份状态、预算和明确的详情入口');
assert.doesNotMatch(planList, /内容结构|数字人形象|presenterLabel|presenterModeLabel|\.segments/, '内容结构和数字人详情不得在初始清单中提前展开');
assert.doesNotMatch(planDetails, /<Collapse|defaultActiveKey|accordion/, '计划视频不得默认展开折叠内容');
assert.match(detailDialog, /open=\{Boolean\(selectedPlan\)\}[\s\S]*内容结构[\s\S]*数字人形象与制作依据/, '内容结构和数字人必须在用户点击后打开的二级详情中展示');
assert.equal((planDetails.match(/<Drawer\b/g) || []).length, 1, '周计划只允许一个主抽屉层级');
assert.equal((planDetails.match(/<Modal\b/g) || []).length, 1, '单条详情只允许增加一个二级弹窗');
assert.match(planDetails, /inspirationReferenceNavigationDetail\(selectedPlan\.reference!, selectedPlan\.item\.contentId\)/, '每条周计划爆款依据必须能回到准确的参考素材');
assert.match(planDetails, /h-\[112px\][\s\S]*<img[\s\S]*爆款视频缩略图/, '爆款依据必须用接近竖屏比例的真实视频缩略图呈现，不能只显示一行标题');
assert.match(planList, /src=\{item\.thumbnailUrl\}/, '计划摘要必须优先使用已有内容缩略图回退链路，不能只依赖爆款引用封面');
assert.match(detailDialog, /src=\{selectedPlan\.item\.thumbnailUrl\}/, '详情弹窗必须沿用内容缩略图回退链路');
assert.match(detailDialog, /查看爆款原片/, '二级详情必须保留查看准确爆款原片的入口');
assert.doesNotMatch(commandCenter, /本周计划爆款依据|计划依据 · 爆款参考/, '经营首页不得展开爆款依据，避免挤占主视图');
assert.match(planDetails, /title="本周计划"[\s\S]{0,160}aria-label="详细周计划"/, '详细周计划必须通过可随时关闭的抽屉查看');
assert.match(planDetails, /编导结构尚未写入本周计划|内容结构待确认/, '内容结构缺失时必须使用明确的待确认降级状态');
assert.match(planDetails, /数字人待绑定|形象方案待确认/, '数字人信息缺失时必须使用明确的待绑定或待确认状态');
assert.match(planDetails, /hasPersistedPaidMediaPlan \|\| !useShowcasePlanRows[\s\S]*smartBusinessShowcaseAds\([\s\S]*true\)\?\.tasks[\s\S]*const paidMediaRows = hasPersistedPaidMediaPlan[\s\S]*trafficTasks\.map/, '投流展示必须优先读取已保存计划，且仅在本地展示模式补齐缺失状态');
assert.match(planDetails, /预算草案[\s\S]*待经营确认后进入执行排期/, '没有真实投流计划时必须明确保持在待确认状态');
assert.match(planDetails, /status: index === 0 \? '计划中' : '待执行'/, '预算草案只能使用计划中或待执行状态，不能沿用展示任务的已执行状态');
assert.doesNotMatch(planDetails, /本周未配置投流预算或投流任务/, '没有投流数据时仍需提供可审核的完整规划视图');
assert.doesNotMatch(planDetails, />[^<]*(?:模拟数据|示例数据|mock)[^<]*</i, '用户界面不得出现内部数据来源字样');
assert.doesNotMatch(planDetails, /发布账号尚未就绪|发布准备状态暂时无法核验|配置发布账号/, '详细周计划不得重复展示发布账号准备警告');
assert.doesNotMatch(commandCenter, /note:|item\.note|当前没有待验收成片|发布任务 ·|逐镜生成与重试费用待核算|按当前周计划与供应商报价估算|仅统计供应商对账回执/, '六项周计划指标不得保留解释性小字');
assert.doesNotMatch(commandCenter, /已包含本周全部视频制作/, '费用未核算前不得承诺覆盖本周全部视频制作');
assert.match(source, /durationSeconds: contents\.reduce\(\(sum, item\) => sum \+ item\.duration, 0\)/, '视频总时长必须按本周全部计划视频合计');
assert.match(source, /operatingContext\?\.budget\.productionMinCny[\s\S]*operatingContext\?\.budget\.productionMaxCny[\s\S]*operatingContext\?\.budget\.productionCny/, '周计划统一展示模型必须只汇总制作预算');
assert.match(source, /plan\.productionRole === "platform_adaptation"[\s\S]*\? 0[\s\S]*plan\.estimatedCost/, '平台发布版本的单条预算必须计入母版，不能重复累加制作成本');
assert.doesNotMatch(commandCenter, /<LsCalendar|WeeklyContentProgressPanel|本周发布日历/, '顶部周经营计划不得重复渲染发布日历');
assert.match(publishingCalendar, /<h3[^>]*>发布日历<\/h3>[\s\S]{0,160}<Tag>\{calendarEvents\.length\} 项发布<\/Tag>/, '发布视图必须使用与员工排期一致的工作台标题栏');
assert.match(publishingCalendar, /initialView="timeGridWeek"[^>]*\bshowAllEvents\b[^>]*fixedHeight="auto"[^>]*workspaceMode="expanded"[^>]*firstDay=\{display\.startsAt \? calendarWeekday\(display\.startsAt\) : 1\}/, '发布日历必须按真实计划起始日展示明确小时排期');
assert.match(publishingCalendar, /onMoveEvent=\{async \(event, scheduledAt\)[^]*reschedulePublication/, '发布日历拖拽必须持久化新的发布时间');
assert.match(publishingCalendar, /identity: \{ kind: "platform", platform: item\.platform \}/, '发布卡必须使用目标社媒平台 Logo 作为身份，而不是失败封面');
assert.match(publishingCalendar, /workspaceMode="expanded"/, '发布周视图必须像员工排期一样完整展开工作区');
assert.doesNotMatch(publishingCalendar, /eventCardMode="media"|density="compact"|\bflush\b/, '发布日历不得继续使用与员工排期不一致的媒体大卡或贴边紧凑模式');
assert.doesNotMatch(commandCenter, /<section className=\{`[^`]*(?:rounded-lg|border border-border)/, '周经营计划不得再使用封闭卡片外框');
assert.match(publishingCalendar, /const calendarEvents:[\s\S]*display\.contents\.map/, '每条本周内容都必须映射为一个日历事件');
assert.doesNotMatch(publishingCalendar, /onEventClick=/, '发布卡点击必须由共享日历打开侧栏，不能直接导航离开');
assert.match(publishingCalendar, /detailsTitle="内容制作进度"[^]*<WeeklyContentProgressPanel[^]*contentId=\{item\.contentId\}/, '每条内容必须在共享侧栏展示其真实制作进度');
assert.match(publishingCalendar, /onOpenReference=\{item\.inspirationReference[^]*inspirationReferenceNavigationDetail/, '精确爆款详情必须保留为侧栏里的次级入口');
assert.match(source, /businessRef: \{ referenceId: reference\.referenceId \}[\s\S]*inspirationReference: reference/, '爆款跳转必须使用既有的嵌套引用协议');
assert.match(source, /target === ['"]benchmark['"][\s\S]{0,500}inspirationReferenceNavigationDetail\(benchmarkReference, item\.id\)/, '内容预览的爆款入口也必须发送嵌套引用协议');
for (const internalLabel of ['平台轻适配', '适配版', '手动单项']) {
  assert.doesNotMatch(source, new RegExp(internalLabel), `用户界面不得暴露内部生产分类“${internalLabel}”`);
}

const thumbnailStart = source.indexOf('function contentThumbnailUrl');
const thumbnailEnd = source.indexOf('\nfunction buildSmartBusinessDisplayModel', thumbnailStart);
assert.ok(thumbnailStart >= 0 && thumbnailEnd > thumbnailStart, '周日历必须有统一的缩略图选择规则');
const thumbnailScript = ts.transpileModule(`${source.slice(thumbnailStart, thumbnailEnd)}\nglobalThis.selectThumbnail = contentThumbnailUrl;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const thumbnailContext = vm.createContext({
  thumbnailUrlWithSourceFallback: (thumbnailUrl: string, sourceUrl: string) => thumbnailUrl && sourceUrl
    ? `${thumbnailUrl}${thumbnailUrl.includes('?') ? '&' : '?'}sourceUrl=${encodeURIComponent(sourceUrl)}`
    : thumbnailUrl,
});
vm.runInContext(thumbnailScript, thumbnailContext);
const selectThumbnail = thumbnailContext.selectThumbnail as (plan: unknown, queueItem: unknown) => string;
const preview = (frame: string, material: string, benchmark: string) => ({
  materials: {
    storyboard: [{ status: 'ready', materialPreviewUrl: frame }],
    items: [{ type: 'image', status: 'ready', previewUrl: material }],
  },
  benchmark: { thumbnailUrl: benchmark },
});
assert.equal(selectThumbnail({ preproduction: preview('/media/plan-frame.jpg', '/media/plan-material.jpg', 'https://remote.test/plan.jpg') }, { preproduction: preview('/media/queue-frame.jpg', '/media/queue-material.jpg', 'https://remote.test/queue.jpg') }), '/media/queue-frame.jpg', '本地已就绪分镜首帧优先于远程参考图');
assert.equal(selectThumbnail({ preproduction: { materials: { storyboard: [], items: [] }, benchmark: { thumbnailUrl: 'https://remote.test/fallback.jpg' } } }, null), 'https://remote.test/fallback.jpg', '没有本地预览时才使用参考缩略图');
assert.equal(selectThumbnail({ planningEvidence: { referenceThumbnailUrl: '/api/overseas/videos/removed/thumbnail', referenceSourceUrl: 'https://www.tiktok.com/@factory/video/123' } }, null), '/api/overseas/videos/removed/thumbnail?sourceUrl=https%3A%2F%2Fwww.tiktok.com%2F%40factory%2Fvideo%2F123', '已删除库存记录的周计划仍必须通过冻结来源恢复封面');

const referenceStart = taskPreviewSource.indexOf('function videoPlanFamilyKey');
const referenceEnd = taskPreviewSource.indexOf('\n\nfunction openTaskPreviewPage', referenceStart);
assert.ok(referenceStart >= 0 && referenceEnd > referenceStart, '周日历必须保留精确爆款引用解析');
const referenceScript = ts.transpileModule(`${taskPreviewSource.slice(referenceStart, referenceEnd).replace(/\bexport\s+/g, '')}\nglobalThis.masterFor = referencePlanForPublication; globalThis.referenceFor = inspirationReferenceForPlan; globalThis.detailFor = inspirationReferenceNavigationDetail;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const referenceContext: any = {};
vm.createContext(referenceContext);
vm.runInContext(referenceScript, referenceContext);
const master = {
  contentId: 'master-1', contentFamilyId: 'family-1', productionRole: 'master', route: 'clone', productName: '卸妆蜜', theme: '独立视频主题', language: 'en', duration: 28, platform: 'tiktok', materialIds: [], referenceId: 'viral-1', presenter: 'material', heygenAvatarId: '', avatarConsent: false, voice: '',
  planningEvidence: { referenceTitle: '真实爆款', referenceSourceUrl: 'https://www.tiktok.com/@brand/video/1', referenceThumbnailUrl: '/api/overseas/videos/viral-1/thumbnail' },
  benchmarkAnalysis: { version: 1 },
};
const adaptation = { ...master, contentId: 'adapt-1', productionRole: 'platform_adaptation', masterContentId: 'master-1', platform: 'instagram', referenceId: '', planningEvidence: undefined, benchmarkAnalysis: undefined };
const resolvedMaster = referenceContext.masterFor([master, adaptation], adaptation);
assert.equal(resolvedMaster.contentId, 'master-1', '平台适配版必须回溯同一内容家族的独立视频引用');
const exactReference = referenceContext.referenceFor(resolvedMaster);
assert.equal(exactReference.referenceId, 'viral-1');
assert.equal(exactReference.sourceUrl, 'https://www.tiktok.com/@brand/video/1');
assert.equal(exactReference.platform, 'tiktok', '详情身份必须保留来源独立视频平台，不能改成适配发布平台');
assert.equal(referenceContext.referenceFor({ ...adaptation, masterContentId: '', contentFamilyId: 'other' }), null, '缺少持久化 id 和来源链接时不得凭队列启发式结果猜测详情');
const nestedDetail = referenceContext.detailFor(exactReference, 'content-1');
assert.equal(nestedDetail.businessRef.referenceId, 'viral-1');
assert.equal(nestedDetail.inspirationReference.sourceUrl, exactReference.sourceUrl);

console.log('Smart Business weekly command center contract passed');
