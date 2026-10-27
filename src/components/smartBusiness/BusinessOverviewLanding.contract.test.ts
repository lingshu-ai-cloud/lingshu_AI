import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./BusinessOverviewLanding.tsx', import.meta.url), 'utf8');
const analytics = fs.readFileSync(new URL('./BusinessOverviewAnalytics.tsx', import.meta.url), 'utf8');
const work = fs.readFileSync(new URL('./BusinessOverviewSampleWork.tsx', import.meta.url), 'utf8');
const funnel = fs.readFileSync(new URL('./BusinessCustomerFunnel.tsx', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../ConfiguredDigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');

test('today workspace keeps the requested information hierarchy', () => {
  assert.match(workspace, /workspaceView === "today" \? <BusinessOverviewLanding/);
  assert.match(workspace, /weeklyPlan=\{sampleWeeklyPlan \|\| weeklyCommandCenter\}/, 'the existing weekly plan must be the overview foundation');
  assert.match(workspace, /sampleWeeklyPlan = sampleWeekly[\s\S]*查看周计划[\s\S]*制定周计划[\s\S]*previewTotals=\{sampleWeekly\}/, 'preview weekly plan must retain visible view and create actions');
  assert.match(workspace, /disabled=\{Boolean\(busy\) \|\| activeRun \|\| Boolean\(goal && !canCreateNextGoal\) \|\| Boolean\(viewGoalId\)\}/, 'preview must not bypass real weekly-plan eligibility');
  assert.match(workspace, /setSampleWeeklyPlanOpen\(true\)[\s\S]*<BusinessOverviewDetailDrawer detail=\{sampleWeeklyPlanOpen && sampleWeekly/, 'preview view action must open weekly-plan details');
  assert.match(source, /周经营计划与今日经营概览[\s\S]{0,220}当前周计划[\s\S]{0,180}weeklyPlan\}/, 'today, score and topics must share the weekly-plan surface');
  for (const heading of ['今日实时数据', '热门话题', '爆款与曝光', '投流', '询盘与人群']) {
    assert.ok((source + analytics).includes(heading), `missing overview section: ${heading}`);
  }
  assert.match(analytics, /整体曝光 = 付费流曝光 \+ 自然流曝光/);
  assert.match(analytics, /Meta 广告归因回传/);
  assert.match(source, /今日数据经营解读.*interpretation\}/, 'interpretation belongs beneath today charts');
  assert.match(analytics, /<BusinessCustomerFunnel stages=\{funnelStages\}/);
});

test('the overview prioritizes real signals and gives unavailable data an icon-backed state', () => {
  for (const metric of ['今日播放', '今日互动', '今日客户进线', '今日主动触达']) {
    assert.match(source, new RegExp(`label="${metric}"`));
  }
  assert.doesNotMatch(source, /<Metric label="今日完成任务"|<Metric label="当前待处理"/, 'task totals belong to the weekly plan and work section');
  assert.match(source, /近 7 日播放与互动/);
  assert.match(source, /平台播放分布/);
  assert.match(source, /<LsIllustratedEmpty icon=\{ChartNoAxesCombined\}/);
  assert.match(source, /<LsIllustratedEmpty icon=\{Hash\}/);
  assert.match(funnel, /business-funnel-stage/);
  assert.match(source, /displayData\.industryTrends\?\.status === 'available'/, 'topics must have the existing traceable source');
});

test('preview work and metrics open informative details without business mutations', () => {
  assert.match(work, /预览图/);
  assert.match(work, /观察期第 4 \/ 7 天/);
  assert.match(work, /最近联系/);
  assert.match(work, /<Drawer open=\{Boolean\(selected\)\}/);
  assert.match(source, /查看每日数据/);
  assert.match(source, /查看平台明细/);
  assert.match(analytics, /onStageClick=\{/);
  assert.match(funnel, /aria-haspopup="dialog"/);
  assert.doesNotMatch(work, /onNavigate|fetch\(/);
});

test('unavailable provider figures stay visibly unknown', () => {
  assert.doesNotMatch(source, /loadConnectedSocialPerformance/, 'landing must reuse persisted review instead of starting another provider sync');
  assert.match(analytics, /totals\?\.impressions/);
  assert.match(source, /customerReady \? customer\.inbound : null/);
  assert.match(analytics, /不绘制虚构趋势/);
});
