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
assert.match(commandCenter, /initialView="dayGridWeek"[^>]*eventCardMode="media"[^>]*fixedHeight=\{640\}/, '发布日历必须使用固定高度的 FullCalendar 原生周卡片视图');
assert.match(commandCenter, /const calendarEvents:[\s\S]*display\.contents\.map/, '每条本周内容都必须映射为一个日历事件');
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

console.log('Smart Business weekly command center contract passed');
