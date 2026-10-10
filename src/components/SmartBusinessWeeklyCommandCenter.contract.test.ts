import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SmartBusinessDashboard.tsx', import.meta.url), 'utf8');
const start = source.indexOf('export function WeeklyCommandCenter');
const end = source.indexOf('type DisplayMetricSource', start);
const commandCenter = source.slice(start, end);

assert.ok(start >= 0 && end > start, '周经营计划区必须存在');
for (const label of ['待验收成片', '本周计划视频', '本周视频总时长', '本周成本范围', '预计制作成本', '已结算成本']) {
  assert.match(commandCenter, new RegExp(label), `周经营计划必须展示“${label}”`);
}
assert.match(source, /durationSeconds: contents\.reduce\(\(sum, item\) => sum \+ item\.duration, 0\)/, '视频总时长必须按本周全部计划视频合计');
for (const internalLabel of ['原创母版', '平台版本', '平台轻适配', '适配版', '手动单项']) {
  assert.doesNotMatch(source, new RegExp(internalLabel), `用户界面不得暴露内部生产分类“${internalLabel}”`);
}

console.log('Smart Business weekly command center contract passed');
