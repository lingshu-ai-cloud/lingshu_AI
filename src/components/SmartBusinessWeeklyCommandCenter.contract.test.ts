import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const dashboardSource = readFileSync(new URL('./SmartBusinessDashboard.tsx', import.meta.url), 'utf8');
const taskPreviewSource = readFileSync(new URL('./smartBusiness/TaskPreviewCards.tsx', import.meta.url), 'utf8');
const source = `${dashboardSource}\n${taskPreviewSource}`;
const start = dashboardSource.indexOf('export function WeeklyCommandCenter');
const end = dashboardSource.indexOf('\n\nexport function WeeklyPlanDetailsDrawer', start);
const commandCenter = dashboardSource.slice(start, end);
const detailsStart = dashboardSource.indexOf('export function WeeklyPlanDetailsDrawer');
const detailsEnd = dashboardSource.indexOf('\n\nexport function BusinessInterpretation', detailsStart);
const planDetails = dashboardSource.slice(detailsStart, detailsEnd);
const publishingStart = dashboardSource.indexOf('function WeeklyPublishingCalendar');
const publishingEnd = dashboardSource.indexOf('const matrixRoleLabel', publishingStart);
const publishingCalendar = dashboardSource.slice(publishingStart, publishingEnd);
const budgetStart = dashboardSource.indexOf('const DEFAULT_VIDEO_COST_CNY');
const budgetEnd = dashboardSource.indexOf('\n\nfunction metricValue', budgetStart);

assert.ok(start >= 0 && end > start, '周经营计划区必须存在');
assert.ok(detailsStart >= 0 && detailsEnd > detailsStart, '详细周计划必须存在');
assert.ok(publishingStart >= 0 && publishingEnd > publishingStart, '数字员工发布日历视图必须存在');
assert.ok(budgetStart >= 0 && budgetEnd > budgetStart, '周计划必须有统一的视频预算投影');
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
for (const label of ['待验收成片', '本周计划视频', '本周视频总时长', '本周成本范围', '预计制作成本', '已结算成本']) {
  assert.match(commandCenter, new RegExp(label), `周经营计划必须展示“${label}”`);
}
for (const label of ['计划依据 · 爆款参考', '点击可回到爆款库查看原素材与分析', '用于：']) {
  assert.match(planDetails, new RegExp(label), `详细周计划必须明确展示爆款依据：“${label}”`);
}
assert.match(planDetails, /inspirationReferenceNavigationDetail\(reference, item\.contentId\)/, '每条周计划爆款依据必须能回到准确的参考素材');
assert.match(planDetails, /aspect-video[\s\S]*<img[\s\S]*视频缩略图[\s\S]*查看原视频/, '爆款依据必须用真实视频缩略图卡片呈现，不能只显示一行标题');
assert.match(planDetails, /thumbnailUrlWithSourceFallback\(reference\.thumbnailUrl, reference\.sourceUrl\)/, '冻结缩略图失效时必须保留既有来源恢复能力');
assert.doesNotMatch(commandCenter, /本周计划爆款依据|计划依据 · 爆款参考/, '经营首页不得展开爆款依据，避免挤占主视图');
assert.match(planDetails, /title="本周计划"[\s\S]{0,160}aria-label="详细周计划"/, '详细周计划必须通过可随时关闭的抽屉查看');
assert.match(planDetails, /内容与发布时间[\s\S]{0,1200}本周计划爆款依据/, '详细周计划必须同时展示内容排期和对应爆款依据');
assert.doesNotMatch(planDetails, /发布账号尚未就绪|发布准备状态暂时无法核验|配置发布账号/, '详细周计划不得重复展示发布账号准备警告');
assert.doesNotMatch(commandCenter, /note:|item\.note|当前没有待验收成片|发布任务 ·|逐镜生成与重试费用待核算|按当前周计划与供应商报价估算|仅统计供应商对账回执/, '六项周计划指标不得保留解释性小字');
assert.doesNotMatch(commandCenter, /已包含本周全部视频制作/, '费用未核算前不得承诺覆盖本周全部视频制作');
assert.match(source, /durationSeconds: contents\.reduce\(\(sum, item\) => sum \+ item\.duration, 0\)/, '视频总时长必须按本周全部计划视频合计');
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
