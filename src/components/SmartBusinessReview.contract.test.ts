import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync('src/components/SmartBusinessDashboard.tsx', 'utf8');
const recommendations = fs.readFileSync('src/components/NextRoundRecommendationsSection.tsx', 'utf8');
const recommendationModel = fs.readFileSync('src/lib/nextRoundRecommendations.ts', 'utf8');

const home = dashboard.slice(dashboard.indexOf('function HomeView'), dashboard.indexOf('const matrixRoleLabel'));
const routes = dashboard.slice(dashboard.indexOf('export default function SmartBusinessDashboard'));
assert.match(home, /<BusinessHealthOverview[^]*<NextRoundRecommendationsSection/, 'the overview must finish with actionable next-round recommendations after asset health');
assert.match(home, /summary=\{data\.review\?\.status === "generated" \? data\.review\.summary : undefined\}/, 'next-round recommendations must use persisted generated review evidence, not a synthetic report');
assert.match(routes, /view === "review"\) return <BusinessDataReview/, 'data review must have its own data-detail component');
assert.doesNotMatch(routes, /<NextRoundRecommendationsSection/, 'review routing must not duplicate recommendations outside the overview');
assert.doesNotMatch(dashboard, /目标、账号与预算怎样调整/, 'the old generic next-round copy must be removed');
for (const label of ['优秀内容继承', 'Tag 与卖点调整', '行业热点与变化']) {
  assert.match(`${recommendations}\n${recommendationModel}`, new RegExp(label), `next-round recommendations must expose ${label}`);
}
assert.match(recommendations, /card\.systemActions/, 'recommendation cards retain actionable next steps without another explanatory heading');
assert.match(recommendations, /target="_blank" rel="noreferrer noopener"/, 'industry signals must open a safe, traceable source link');
for (const visual of ['首镜钩子', '内容框架', '可验证卖点候选', '行业变化']) {
  assert.match(recommendations, new RegExp(visual), `recommendations must visualize ${visual}`);
}
assert.match(recommendations, /lg:grid-cols-3/, 'the three recommendation cards must share one consistent horizontal layout');

console.log('Smart Business review contract tests passed');
