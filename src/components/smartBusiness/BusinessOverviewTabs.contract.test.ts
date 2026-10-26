import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./BusinessOverviewTabs.tsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../DigitalEmployeePage.tsx', import.meta.url), 'utf8');

for (const label of ['发布日历', '投流速览', '询盘诊断']) assert.match(source, new RegExp(label));
assert.ok(source.includes('onCreatePending={storageScope ? () => setBatchOpen(true) : undefined}'));
assert.match(source, /<CalendarPlanner[^]*<NextRoundRecommendationsSection/, '下一轮建议必须位于发布日历底部');
assert.match(source, /<BatchPublishDraftDialog/, '发布日历必须提供批量新建待发布内容');
assert.match(source, /<CreationTaskWorkspace[^\n]+embeddedCalendar/);
assert.match(source, /<CalendarPlanner allowDemo=\{false\}/);
assert.match(source, /<BusinessAdsOverview onNavigate=\{onNavigate\}/);
assert.match(source, /<InquiryDataBoard includeMockCustomers=\{false\}/);
assert.match(source, /<Tabs key=\{identity\}/, '身份切换重建业务页签，不保留旧企业的结果');
assert.doesNotMatch(source, /businessSnapshot|applySmartBusinessShowcaseData|previewRecommendations/);
const ads = fs.readFileSync(new URL('./BusinessAdsOverview.tsx', import.meta.url), 'utf8');
assert.match(ads, /useAdPlanTasks\(navigation.identity\)/);
assert.match(ads, /<AdPlanManagement[^]*readOnly/);
assert.match(ads, /navigation.select\(id\); onNavigate\?\.\('adsPlans'\)/);
const content = fs.readFileSync(new URL('../socialContent/CreationTaskWorkspace.tsx', import.meta.url), 'utf8');
assert.match(content, /if\(embeddedCalendar\)return;/, '嵌入的日历不修改内容创作页的导航状态');
assert.match(source, /onNavigate\?\.\('conversion'\)/);
assert.doesNotMatch(source, /Math\.random|fetch\(/, '业务速览复用原模块，不构造第二套接口或演示数据');
assert.doesNotMatch(page, /<BusinessOverviewTabs\b/, '经营总览不再挂载发布日历、投流速览和询盘诊断页内视图');
assert.doesNotMatch(page, /aria-label="智能经营视图"/, '旧的三个页签不应与新业务页签并列');
assert.match(shell, /<ConfiguredDigitalEmployeeWorkspace/, '经营总览继续挂载基线已拆分的工作区');
assert.match(source, /bg-surface/, '页签容器使用共享表面，夜间不保留大片白底');

console.log('Business overview tabs contract passed');
