import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/SmartBusinessDashboard.tsx', 'utf8');
const recommendations = fs.readFileSync('src/components/NextRoundRecommendationsSection.tsx', 'utf8');
const recommendationModel = fs.readFileSync('src/lib/nextRoundRecommendations.ts', 'utf8');

assert.match(dashboard, /<NextRoundRecommendationsSection[^>]+summary=\{recommendationSummary\}/, 'data review must prioritize the structured next-round section with real industry signals');
assert.doesNotMatch(dashboard, /目标、账号与预算怎样调整/, 'the old generic next-round copy must be removed');
for (const label of ['优秀内容继承', 'Tag 与卖点调整', '行业热点与变化', '系统如何使用']) {
  assert.match(`${recommendations}\n${recommendationModel}`, new RegExp(label), `next-round recommendations must expose ${label}`);
}
assert.match(recommendations, /target="_blank" rel="noreferrer noopener"/, 'industry signals must open a safe, traceable source link');
for (const visual of ['首镜钩子', '内容框架', '可验证卖点候选', '行业变化']) {
  assert.match(recommendations, new RegExp(visual), `recommendations must visualize ${visual}`);
}
assert.match(recommendations, /lg:grid-cols-3/, 'the three recommendation cards must share one consistent horizontal layout');

console.log('Smart Business review contract tests passed');
