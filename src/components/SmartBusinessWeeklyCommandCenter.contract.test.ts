import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./SmartBusinessDashboard.tsx', import.meta.url), 'utf8');
const start = source.indexOf('export function WeeklyCommandCenter');
const end = source.indexOf('type DisplayMetricSource', start);
const commandCenter = source.slice(start, end);

assert.ok(start >= 0 && end > start, '周经营计划区必须存在');
for (const label of ['待验收成片', '本周计划视频', '本周视频总时长', '本周成本范围', '预计制作成本', '已结算成本']) {
  assert.match(commandCenter, new RegExp(label), `周经营计划必须展示“${label}”`);
}
assert.match(source, /durationSeconds: contents\.reduce\(\(sum, item\) => sum \+ item\.duration, 0\)/, '视频总时长必须按本周全部计划视频合计');
assert.match(commandCenter, /initialView="dayGridWeek"[^>]*eventCardMode="media"[^>]*fixedHeight="clamp\(300px, calc\(100dvh - 270px\), 640px\)"/, '发布日历必须使用不超过一屏可用空间的 FullCalendar 原生周卡片视图');
assert.match(commandCenter, /<LsCalendar[^>]*density="compact"[^>]*\bflush\b/, '首页发布日历必须紧凑展示并使用左右全部宽度');
assert.doesNotMatch(commandCenter, /<h[1-6][^>]*>发布日历<\/h[1-6]>/, '日历不得保留独占一行的重复标题');
assert.doesNotMatch(commandCenter, /<section className=\{`[^`]*(?:rounded-lg|border border-border)/, '周经营计划不得再使用封闭卡片外框');
assert.match(commandCenter, /const calendarEvents:[\s\S]*display\.contents\.map/, '每条本周内容都必须映射为一个日历事件');
assert.match(commandCenter, /onEventClick=\{event =>[\s\S]*item\.inspirationReference[\s\S]*inspirationReferenceNavigationDetail[\s\S]*return true/, '具备精确爆款身份的发布卡必须直接跳转到对应详情');
assert.match(commandCenter, /if \(!item\.inspirationReference[^]*return false/, '没有精确爆款身份的发布卡必须回退到原详情抽屉');
assert.match(source, /businessRef: \{ referenceId: reference\.referenceId \}[\s\S]*inspirationReference: reference/, '爆款跳转必须使用既有的嵌套引用协议');
assert.match(source, /target === "benchmark"[\s\S]{0,200}inspirationReferenceNavigationDetail\(benchmarkReference, item\.id\)/, '内容预览的爆款入口也必须发送嵌套引用协议');
for (const internalLabel of ['原创母版', '平台版本', '平台轻适配', '适配版', '手动单项']) {
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

const referenceStart = source.indexOf('function videoPlanFamilyKey');
const referenceEnd = source.indexOf('\n\nexport function WeeklyCommandCenter', referenceStart);
assert.ok(referenceStart >= 0 && referenceEnd > referenceStart, '周日历必须保留精确爆款引用解析');
const referenceScript = ts.transpileModule(`${source.slice(referenceStart, referenceEnd)}\nglobalThis.masterFor = referencePlanForPublication; globalThis.referenceFor = inspirationReferenceForPlan; globalThis.detailFor = inspirationReferenceNavigationDetail;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const referenceContext: any = {};
vm.createContext(referenceContext);
vm.runInContext(referenceScript, referenceContext);
const master = {
  contentId: 'master-1', contentFamilyId: 'family-1', productionRole: 'master', route: 'clone', productName: '卸妆蜜', theme: '母版主题', language: 'en', duration: 28, platform: 'tiktok', materialIds: [], referenceId: 'viral-1', presenter: 'material', heygenAvatarId: '', avatarConsent: false, voice: '',
  planningEvidence: { referenceTitle: '真实爆款', referenceSourceUrl: 'https://www.tiktok.com/@brand/video/1', referenceThumbnailUrl: '/api/overseas/videos/viral-1/thumbnail' },
  benchmarkAnalysis: { version: 1 },
};
const adaptation = { ...master, contentId: 'adapt-1', productionRole: 'platform_adaptation', masterContentId: 'master-1', platform: 'instagram', referenceId: '', planningEvidence: undefined, benchmarkAnalysis: undefined };
const resolvedMaster = referenceContext.masterFor([master, adaptation], adaptation);
assert.equal(resolvedMaster.contentId, 'master-1', '平台适配版必须回溯同一内容家族的母版引用');
const exactReference = referenceContext.referenceFor(resolvedMaster);
assert.equal(exactReference.referenceId, 'viral-1');
assert.equal(exactReference.sourceUrl, 'https://www.tiktok.com/@brand/video/1');
assert.equal(exactReference.platform, 'tiktok', '详情身份必须保留来源母版平台，不能改成适配发布平台');
assert.equal(referenceContext.referenceFor({ ...adaptation, masterContentId: '', contentFamilyId: 'other' }), null, '缺少持久化 id 和来源链接时不得凭队列启发式结果猜测详情');
const nestedDetail = referenceContext.detailFor(exactReference, 'content-1');
assert.equal(nestedDetail.businessRef.referenceId, 'viral-1');
assert.equal(nestedDetail.inspirationReference.sourceUrl, exactReference.sourceUrl);

console.log('Smart Business weekly command center contract passed');
