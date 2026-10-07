import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/SmartBusinessDashboard.tsx', 'utf8');
const recommendations = fs.readFileSync('src/components/NextRoundRecommendationsSection.tsx', 'utf8');
const recommendationModel = fs.readFileSync('src/lib/nextRoundRecommendations.ts', 'utf8');

assert.match(dashboard, /<NextRoundRecommendationsSection[^>]+summary=\{reviewSummary\}/, 'data review must prioritize the structured next-round section');
assert.doesNotMatch(dashboard, /目标、账号与预算怎样调整/, 'the old generic next-round copy must be removed');
for (const label of ['优秀内容继承', 'Tag 与卖点调整', '行业热点与变化', '系统如何使用']) {
  assert.match(`${recommendations}\n${recommendationModel}`, new RegExp(label), `next-round recommendations must expose ${label}`);
}
assert.match(recommendations, /target="_blank" rel="noreferrer noopener"/, 'industry signals must open a safe, traceable source link');
assert.match(recommendations, /产品事实、采集范围和投放预算不会被静默修改/, 'user-facing copy must separate suggestions from protected facts and budget');

console.log('Smart Business review contract tests passed');
