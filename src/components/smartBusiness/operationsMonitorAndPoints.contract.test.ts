import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspace = readFileSync(new URL('./DigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const productionBoard = readFileSync(new URL('./AgentVideoProductionBoard.tsx', import.meta.url), 'utf8');
const pointsDrawer = readFileSync(new URL('../PointsManagementDrawer.tsx', import.meta.url), 'utf8');
const pointsPolicy = readFileSync(new URL('../../../shared/pointsPolicy.ts', import.meta.url), 'utf8');

test('digital employees use one monitoring surface instead of first-level schedule pages', () => {
  assert.match(workspace, /数字员工生产指挥舱/);
  assert.match(workspace, /多 Agent 协同引擎在线/);
  assert.match(workspace, /数字员工本周运营指标/);
  assert.match(workspace, /四位数字员工正在如何协作/);
  assert.match(workspace, /数字员工内容工程监控/);
  assert.match(workspace, /发布与投流/);
  assert.match(workspace, /客服承接/);
  assert.doesNotMatch(workspace, /异常与待处理/);
  assert.match(workspace, /展开发布日历/);
  assert.doesNotMatch(workspace, /\bSegmented\b/);
});

test('content projects expose Agent collaboration and one per-video point result', () => {
  assert.match(productionBoard, /本周内容工程协作/);
  assert.match(productionBoard, /Agent 协作链/);
  for (const role of ['经营 Agent', '编导 Agent', '内容 Agent', '客服 Agent']) {
    assert.match(productionBoard, new RegExp(role));
  }
  assert.match(productionBoard, /本条视频积分/);
  assert.match(productionBoard, /待制作方案冻结/);
  assert.doesNotMatch(productionBoard, /ProductionRecipe|视频生产构成|数字人 \+ 背景|统一音色|suffix="\/ 秒"/);
});

test('user points are grouped by product function and never priced from provider calls', () => {
  for (const section of ['智能经营', '灵感与策划', '内容制作', '投流增长', '客服承接', '知识与助手']) {
    assert.match(pointsPolicy, new RegExp(section));
  }
  assert.match(pointsDrawer, /PRODUCT_POINT_SECTIONS/);
  assert.match(pointsDrawer, /套餐与积分/);
  assert.match(pointsDrawer, /当前套餐/);
  assert.match(pointsDrawer, /套餐内使用情况/);
  assert.match(pointsDrawer, /加油包积分/);
  assert.match(pointsDrawer, /LsGradientProgress/);
  assert.match(pointsDrawer, /session\?: AuthSession/);
  assert.match(pointsDrawer, /MOCK_SECTION_USAGE/);
  assert.match(pointsDrawer, /usedPoints/);
  assert.match(pointsDrawer, /totalPoints/);
  assert.match(pointsDrawer, /<Star/);
  assert.match(pointsDrawer, /购买加油包/);
  assert.match(pointsDrawer, /查看全部套餐/);
  assert.match(pointsDrawer, /升级套餐/);
  assert.match(pointsDrawer, /界面示意/);
  assert.match(pointsDrawer, /import\.meta\.env\.DEV/);
  assert.match(pointsDrawer, /<Modal/);
  assert.match(pointsDrawer, /centered/);
  assert.doesNotMatch(pointsDrawer, /<Drawer|<Collapse|<Tabs|<Table/);
  assert.doesNotMatch(pointsDrawer, /积分规则/);
  assert.doesNotMatch(pointsDrawer, /本期积分结算|当前套餐可用功能|MOCK_SETTLED_USAGE/);
  assert.doesNotMatch(pointsDrawer, /\b次\b|\b张\b|\b秒\b/);
  assert.match(pointsDrawer, /当前套餐尚未返回可核验的积分额度/);
  assert.doesNotMatch(pointsDrawer, /基础套餐已包含每周周任务/);
  assert.doesNotMatch(pointsDrawer, /agentUsageCosts|pointsFromCny|HeyGen|Seedance|Volcengine|Ark/);
});
