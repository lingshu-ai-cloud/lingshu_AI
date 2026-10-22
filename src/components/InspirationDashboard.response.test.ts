import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { directorReviewAction, parseExactAnalysisResponse } from './InspirationDashboard.js';

const queued = parseExactAnalysisResponse('{"status":"pending","id":"record-1"}', 202);
assert.deepEqual(queued, {
  error: undefined,
  status: 'pending',
  reused: undefined,
  id: 'record-1',
});

const backendError = parseExactAnalysisResponse('{"error":"Material not found"}', 404);
assert.equal(backendError.error, 'Material not found');

const proxyHtml = parseExactAnalysisResponse('<!doctype html><pre>Cannot POST /api/overseas/videos/material-exact-analysis</pre>', 404);
assert.equal(proxyHtml.error, '全片精确分析接口返回异常（HTTP 404）');

assert.match(directorReviewAction('repeated_full_dialogue_17_shots').next, /逐句校时/);
assert.match(directorReviewAction('sub_200ms_shots_1').next, /0–1 秒连续动作/);
assert.match(directorReviewAction('opening_hook_motion_incomplete').next, /手势/);
assert.match(directorReviewAction('opening_frame_factory_showroom_conflict').next, /首帧/);
assert.match(directorReviewAction('presenter_authorization_missing').next, /授权范围/);

const source = readFileSync(fileURLToPath(new URL('./InspirationDashboard.tsx', import.meta.url)), 'utf8');
const mediaSource = readFileSync(fileURLToPath(new URL('./inspiration/InspirationMedia.tsx', import.meta.url)), 'utf8');
assert.match(source, /const detailCreationReady = video\.id\.startsWith\('material-'\) \? true : isImagePost \? imageAnalysisReady : exactQuality\.ready && !pending/, '视频复刻入口必须有精确证据且分析不在执行中，图片入口保留自己的证据门');
assert.match(source, /onClick=\{detailCreationReady \? onCreate : isImagePost \? onReanalyzeImage : onExactAnalysis\} disabled=\{!detailCreationReady && !canRunDetailAnalysis\}/, '证据不足必须进入真实分析或禁止操作，不得直接创建');
assert.match(source, /const handoffReady = !pending && reviewHandoff\?\.status === 'production_ready' && reviewHandoff\.productionExecutionAllowed === true/, '开放任务起稿不能冒充成片制作已通过编导交接');
assert.match(source, /review-handoff/, '编导分析抽屉必须读取服务端复核工作单');
assert.match(source, /<AuthenticatedVideo[^]*?apiUrl=\{previewMaterial\.url\}[^]*?loadOnMount/, '素材弹窗必须走带超时和重试的统一视频播放器');
assert.match(mediaSource, /onLoadedMetadata=\{\(\) => \{[^]*?if \(controls\) reportMediaReady\(\)/, '带控件的视频预览读取到元数据后必须移除准备中遮罩，避免 Safari 已显示画面仍阻塞');
assert.match(mediaSource, /onPlaying=\{reportMediaReady\}/, '视频实际开始播放时必须兜底结束准备状态');
assert.doesNotMatch(source, /<video src=\{`\$\{material\.url\}#t=0\.1`\}/, '素材卡片不能同时预加载整页视频并耗尽 Safari 媒体资源');

console.log('InspirationDashboard exact-analysis response tests passed');
