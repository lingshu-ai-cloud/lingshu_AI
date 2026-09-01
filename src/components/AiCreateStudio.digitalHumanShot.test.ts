import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const studio = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../lib/studioApi.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../server/routes/studio.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../scripts/digital-human-local-worker.ts', import.meta.url), 'utf8');

assert.match(studio, /generateDigitalHumanForShot\(activeWorkbenchSlot, avatar\.id\)/, '数字人入口必须作用于当前分镜');
assert.match(studio, /setStoryboardAssignments\(current => \(\{ \.\.\.current, \[slotId\]: result\.outputMaterial!\.id \}\)\)/, '合格输出必须自动回填原分镜');
assert.match(studio, /status: 'stale'.+分镜口播、配音或时间区间已变化/s, '输入变化必须使旧输出失效');
assert.match(studio, /人物口播 · 数字人/, '入口应位于现有素材匹配区域');
assert.doesNotMatch(studio, /新增数字人创作步骤/, '不得增加新的创作步骤');

assert.match(api, /storyboardSlotId\?: string/, 'API必须支持分镜任务');
assert.match(route, /audioSegment: \{ startSeconds: job\.audioStartSeconds, endSeconds: job\.audioEndSeconds \}/, '灵枢必须把分镜音频区间传给Worker');
assert.match(route, /commercialDigitalHumanGate\(providerQuality \|\| \{\}, job\.mode\)/, '灵枢必须执行商业二次门禁');
assert.match(worker, /const trimArgs = segment \? \['-ss'/, 'Worker必须截取分镜音频');
assert.match(worker, /jobs\.find\(item => item\.externalJobId === externalJobId\)/, 'Worker必须支持幂等提交');

console.log('shot digital human workflow contract tests passed');
