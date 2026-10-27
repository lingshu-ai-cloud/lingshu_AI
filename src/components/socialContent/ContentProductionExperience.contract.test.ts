import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync(new URL('./ContentProductionExperiencePanel.tsx', import.meta.url), 'utf8');
const overview = fs.readFileSync(new URL('./SocialTaskOverview.tsx', import.meta.url), 'utf8');
const progress = fs.readFileSync(new URL('./SocialProductionProgressPanel.tsx', import.meta.url), 'utf8');
const confirmation = fs.readFileSync(new URL('./SocialGenerationConfirmationCard.tsx', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('./useSocialContentWorkspace.ts', import.meta.url), 'utf8');

assert.match(progress, /data-social-production-progress/, '制作页仍必须保留紧凑的实时状态入口');
assert.match(progress, /onClick=\{\(\) => openContentGenerationQueue\(\{ view: 'tasks', taskId: task\.taskId \}\)\}/, '制作状态入口必须打开全局统一内容生成队列');
assert.match(progress, /previousStatus === 'plan_review'[\s\S]{0,220}openContentGenerationQueue\(\{ view: 'tasks', taskId: task\.taskId \}\)/, '任务开始制作时必须聚焦统一队列中的同一任务');
assert.doesNotMatch(progress, /data-content-milestone-rail|role="dialog"|taskItems\.map/, '制作页不得再维护第二份进度抽屉或任务列表');
assert.doesNotMatch(progress, /style=\{\{\s*width|\d+%/);

assert.match(confirmation, /data-content-preflight/);
for (const id of ['materials', 'account', 'budget', 'time']) assert.match(confirmation, new RegExp(`${id}:`));
assert.match(confirmation, /正在提交任务/);

for (const state of ['queued', 'producing', 'quality', 'rework', 'completed', 'failed']) {
  assert.match(panel, new RegExp(`${state}:`));
}
for (const title of ['任务概览', '逐镜进度', '异常任务']) assert.match(panel, new RegExp(title));
for (const detail of ['影响范围', '系统已经做了什么', '需要你做什么', '完成后从哪里继续']) assert.match(panel, new RegExp(detail));
assert.match(panel, /刷新或离开页面不会重新分析/);
assert.match(panel, /只展示系统已有的真实结果/);
assert.match(panel, /focusedShotId/);
assert.match(panel, /data-shot-id/);
assert.match(panel, /scrollIntoView/);
assert.match(panel, /shot\.previewMediaType === 'video'/);
assert.match(panel, /shot\.previewMediaType === 'image'/);
assert.match(overview, /onOpenExceptions=\{\(\) => openProductionView\('exceptions'\)\}/);
assert.match(overview, /onOpenShots=\{\(\) => openProductionView\('shots'\)\}/);

assert.match(hook, /只执行一次/);
assert.match(hook, /离开或刷新本页不会影响任务/);

console.log('content production experience contract tests passed');
