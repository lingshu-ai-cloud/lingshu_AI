import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../DigitalEmployeePage.tsx', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const tabs = fs.readFileSync(new URL('./BusinessOverviewTabs.tsx', import.meta.url), 'utf8');

assert.match(page, /const configuredData: DigitalEmployeeOverview = overviewData\.config \? overviewData : \{ \.\.\.overviewData, config: EMPTY_CONFIG \};/,
  'configured tenants must retain their actual configuration');
assert.match(page, /<ConfiguredDigitalEmployeeWorkspace \{\.\.\.\{[\s\S]{0,80}data: configuredData/,
  'configured tenants must still enter the extracted workspace');
assert.match(workspace, /<WeeklyCommandCenter[\s\S]{0,200}data=\{data\}[\s\S]{0,200}statusLabel=\{currentPlanStatusLabel\}/,
  'the overview must keep the real weekly status in its command center');
assert.match(workspace, /<SmartBusinessDashboard data=\{data\} view=\{dashboardView\}/,
  'task state and intervention must remain on the real content workflow');
assert.match(workspace, /onRetryTask=\{async taskId => Boolean\(await act\(`retry:\$\{taskId\}`,[\s\S]{0,120}digitalEmployeeApi\.retryTask\(taskId\)\)\)\}/,
  'the real task retry action must remain reachable from the workflow');
assert.doesNotMatch(workspace, /<BusinessOverviewTabs\b/,
  'the current overview must not duplicate publishing, ads, and inquiry workspaces below the business dashboard');
assert.match(tabs, /key: 'calendar'[\s\S]*key: 'ads'[\s\S]*key: 'inquiries'/,
  'the overview tabs must remain calendar, ads, then inquiries');
assert.doesNotMatch(workspace, /<TodayFocusPanel\b/,
  'the retired standalone attention panel must not duplicate workflow status');

console.log('digital employee overview boundary passed');
