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
assert.match(source, /本地草稿模板｜未调用 AI｜未经质量校验｜不可发布/, '本地模板必须明确标注来源和不可发布状态');
assert.match(source, /setResultProvenance\('template'\)[^]*?setResultQualityStatus\('fallback'\)/, '上游失败必须保留模板 provenance，不能伪装成 AI 成功');
assert.match(source, /response\.ok === false \|\| response\.source !== 'ai' \|\| !responseScript/, '只有明确的 AI 响应才能进入成功分支');
assert.match(source, /resultProvenance !== 'ai'[^]*?不能进入视频生成/, '模板或被拒绝脚本不得进入视频生成');
assert.match(source, /if \(shouldAdvanceDemo\)[^]*?completeDemoStep\('traffic'\)/, '演示流程只能在明确 AI 成功后推进');
assert.doesNotMatch(source, /(?:GMP|FDA-ready|Low MOQ|Fast Turnaround|Export-ready)/, '本地脚本模板不得内置未核实商业承诺');
assert.match(source, /disabled=\{!isImagePost && !draftReady\}/, '逐句口播起稿由编导交接状态控制，成片执行另行验收');
assert.match(source, /review-handoff/, '编导分析抽屉必须读取服务端复核工作单');
assert.match(source, /<AuthenticatedVideo[^]*?apiUrl=\{previewMaterial\.url\}[^]*?loadOnMount/, '素材弹窗必须走带超时和重试的统一视频播放器');
assert.doesNotMatch(source, /<video src=\{`\$\{material\.url\}#t=0\.1`\}/, '素材卡片不能同时预加载整页视频并耗尽 Safari 媒体资源');

console.log('InspirationDashboard exact-analysis response tests passed');
