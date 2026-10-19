import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspace = readFileSync(new URL('./DigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const pointsDrawer = readFileSync(new URL('../PointsManagementDrawer.tsx', import.meta.url), 'utf8');
const pointsPolicy = readFileSync(new URL('../../../shared/pointsPolicy.ts', import.meta.url), 'utf8');

test('digital employees use one monitoring surface instead of first-level schedule pages', () => {
  assert.match(workspace, /数字员工运营监控台/);
  assert.match(workspace, /一屏查看内容生产、发布投流、客服承接和异常/);
  assert.match(workspace, /数字员工本周运营指标/);
  assert.match(workspace, /数字员工实时状态/);
  assert.match(workspace, /数字员工视频生产监控/);
  assert.match(workspace, /发布与投流/);
  assert.match(workspace, /客服承接/);
  assert.match(workspace, /异常与待处理/);
  assert.match(workspace, /展开发布日历/);
  assert.doesNotMatch(workspace, /\bSegmented\b/);
});

test('user points are grouped by product function and never priced from provider calls', () => {
  for (const section of ['智能经营', '灵感与策划', '内容制作', '投流增长', '客服承接', '知识与助手']) {
    assert.match(pointsPolicy, new RegExp(section));
  }
  assert.match(pointsDrawer, /PRODUCT_POINT_SECTIONS/);
  assert.match(pointsDrawer, /全系统产品功能积分规则/);
  assert.match(pointsDrawer, /<Modal/);
  assert.match(pointsDrawer, /centered/);
  assert.match(pointsDrawer, /pageSize: 6/);
  assert.doesNotMatch(pointsDrawer, /<Drawer|<Collapse/);
  assert.match(pointsDrawer, /多 Agent、多模型、校验、修复和系统重试合并为一次结算/);
  assert.match(pointsDrawer, /Token 数、底层技术路线、模型或服务商只用于内部成本与容量管理/);
  assert.doesNotMatch(pointsDrawer, /基础套餐已包含每周周任务/);
  assert.doesNotMatch(pointsDrawer, /agentUsageCosts|pointsFromCny|HeyGen|Seedance|Volcengine|Ark/);
});
