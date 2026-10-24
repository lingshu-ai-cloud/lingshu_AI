import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./BusinessOverviewTabs.tsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../DigitalEmployeePage.tsx', import.meta.url), 'utf8');

for (const label of ['发布日历', '投流速览', '询盘诊断']) assert.match(source, new RegExp(label));
assert.ok(source.includes('onCreatePending={storageScope ? () => setBatchOpen(true) : undefined}'));
assert.match(source, /<CalendarPlanner[^]*<NextRoundRecommendationsSection/, '下一轮建议必须位于发布日历底部');
assert.match(source, /<BatchPublishDraftDialog/, '发布日历必须提供批量新建待发布内容');
assert.match(source, /ads\?\.status === 'available'/);
assert.match(source, /interaction\?\.status === 'available'/);
assert.match(source, /snapshot\.customer\.highIntent/);
assert.match(source, /onNavigate\?\.\('conversion'\)/);
assert.doesNotMatch(source, /Math\.random|fetch\(/, '业务速览只投影已授权经营快照，不构造第二套数据源');
assert.match(page, /workspaceView === "today" && <BusinessOverviewTabs data=\{data\} onNavigate=\{onNavigate\}/);
assert.doesNotMatch(page, /aria-label="智能经营视图"/, '旧的三个页签不应与新业务页签并列');
assert.match(shell, /<ConfiguredDigitalEmployeeWorkspace/, '经营总览继续挂载基线已拆分的工作区');
assert.match(source, /bg-surface/, '页签容器使用共享表面，夜间不保留大片白底');

console.log('Business overview tabs contract passed');
