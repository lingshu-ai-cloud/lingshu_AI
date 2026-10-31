import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workspace = readFileSync(new URL('./DigitalEmployeeWorkspace.tsx', import.meta.url), 'utf8');
const productionBoard = readFileSync(new URL('./AgentVideoProductionBoard.tsx', import.meta.url), 'utf8');
const pointsDrawer = readFileSync(new URL('../PointsManagementDrawer.tsx', import.meta.url), 'utf8');
const pointsPolicy = readFileSync(new URL('../../../shared/pointsPolicy.ts', import.meta.url), 'utf8');

test('digital employees expose the weekly views without duplicating business panels', () => {
  assert.match(workspace, /<DigitalEmployeeHomeWork data=\{data\} onNavigate=\{onNavigate\} publishingCalendar=\{publishingCalendar\}/);
  assert.doesNotMatch(workspace, /数字员工生产指挥舱|数字员工本周运营指标|发布与投流|客服承接|展开发布日历|InitialPreparationStatusPanel|\bSegmented\b/);
});

test('content projects expose persisted production nodes in the shared Gantt component', () => {
  assert.match(productionBoard, /Agent 工作排期/);
  assert.match(productionBoard, /@svar-ui\/react-gantt/);
  assert.match(productionBoard, /aria-label="Agent 生产甘特图"/);
  assert.match(productionBoard, /<Gantt/);
  assert.match(productionBoard, /readonly/);
  assert.match(productionBoard, /data-production-node/);
  assert.match(productionBoard, /productionGanttTasks\(lanes\)/);
  assert.match(productionBoard, /unit: 'week'/);
  assert.match(productionBoard, /unit: 'day'/);
  assert.match(productionBoard, /columns=\{\[\{ id: 'text', header: '内容'/);
  assert.match(productionBoard, /item\.nodes\.map/);
  assert.doesNotMatch(productionBoard, /内容 \/ 生产节点/);
  assert.match(productionBoard, /尚未派生/);
  assert.doesNotMatch(productionBoard, /const agentFlow|Agent 协作链/);
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
  assert.match(pointsDrawer, /customerPointsApi\.summary/);
  assert.match(pointsDrawer, /CustomerPointsSummary/);
  assert.match(pointsDrawer, /usedPoints/);
  assert.match(pointsDrawer, /totalPoints/);
  assert.match(pointsDrawer, /<Star/);
  assert.match(pointsDrawer, /购买加油包/);
  assert.match(pointsDrawer, /查看全部套餐/);
  assert.match(pointsDrawer, /真实账本/);
  assert.doesNotMatch(pointsDrawer, /积分账户尚未配置|当前不会从供应商人民币账单推算用户余额/);
  assert.doesNotMatch(pointsDrawer, /bg-white/);
  assert.match(pointsDrawer, /<Modal/);
  assert.match(pointsDrawer, /centered/);
  assert.doesNotMatch(pointsDrawer, /<Drawer|<Collapse|<Tabs|<Table/);
  assert.doesNotMatch(pointsDrawer, /积分规则/);
  assert.doesNotMatch(pointsDrawer, /本期积分结算|当前套餐可用功能|MOCK_SETTLED_USAGE/);
  assert.doesNotMatch(pointsDrawer, /\b次\b|\b张\b|\b秒\b/);
  assert.doesNotMatch(pointsDrawer, /MOCK_|界面示意|import\.meta\.env\.DEV/);
  assert.doesNotMatch(pointsDrawer, /基础套餐已包含每周周任务/);
  assert.doesNotMatch(pointsDrawer, /agentUsageCosts|pointsFromCny|HeyGen|Seedance|Volcengine|Ark/);
});
