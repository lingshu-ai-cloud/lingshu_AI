import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./BusinessOverviewTabs.tsx', import.meta.url), 'utf8');
const root = fs.readFileSync(new URL('../DigitalEmployeePage.tsx', import.meta.url), 'utf8');
assert.match(root, /<ConfiguredDigitalEmployeeWorkspace/);
const page = fs.readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');

for (const label of ['发布日历', '投流速览', '询盘诊断']) assert.match(source, new RegExp(label));
assert.match(source, /<CalendarPlanner onOpenPost=\{\(\) => onNavigate\?\.\('traffic'\)\}/);
assert.match(source, /ads\?\.status === 'available'/);
assert.match(source, /interaction\?\.status === 'available'/);
assert.match(source, /snapshot\.customer\.highIntent/);
assert.match(source, /onNavigate\?\.\('conversion'\)/);
assert.doesNotMatch(source, /Math\.random|mock|demo|fetch\(/, '业务速览只投影已授权经营快照，不构造第二套数据源');
assert.match(page, /workspaceView === "today" && <BusinessOverviewTabs data=\{data\} onNavigate=\{onNavigate\}/);
assert.doesNotMatch(page, /aria-label="智能经营视图"/, '旧的三个页签不应与新业务页签并列');

console.log('Business overview tabs contract passed');
