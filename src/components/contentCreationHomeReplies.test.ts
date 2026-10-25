import assert from 'node:assert/strict';
import test from 'node:test';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';
import { industrySignalsReply, operatingStrategyReply, weeklyTaskReply } from './contentCreationHomeReplies';

const overview = {
  config: { focusProducts: '精华与面霜', targetMarkets: '北美' },
  industryTrends: { status: 'available', signals: [{ id: 'signal-1', title: '展会新品趋势', platform: 'LinkedIn', summary: '来自真实行业账号', sourceUrl: 'https://example.com/source', observedAt: '2026-10-25', tags: [] }], systemActions: [] },
  goal: { title: 'B2B 从零起步周任务包', status: 'active' },
  plan: { strategy: '先做少量内容实验', successCriteria: ['形成可复盘询盘入口'] },
  run: { status: 'running' },
  tasks: [{ status: 'completed' }, { status: 'blocked' }],
} as unknown as DigitalEmployeeOverview;

test('首页资讯回复只陈述可追溯信号，不把社媒热度冒充政策结论', () => {
  const reply = industrySignalsReply(overview);
  assert.match(reply, /1 条可追溯社媒信号/);
  assert.match(reply, /没有已核验的政策调整/);
  assert.match(reply, /https:\/\/example\.com\/source/);
  assert.match(reply, /精华与面霜/);
});

test('首页策略和周任务回复来自当前 overview 且不宣称自动执行', () => {
  assert.match(operatingStrategyReply(overview), /先做少量内容实验/);
  assert.match(operatingStrategyReply(overview), /不会自动启动、发布或扣费/);
  assert.match(weeklyTaskReply(overview), /已完成 1 项，受阻或失败 1 项/);
  assert.match(weeklyTaskReply(overview), /不会自动启动任务/);
});

test('无证据时保留明确缺口', () => {
  assert.match(industrySignalsReply(null), /没有可追溯/);
  assert.match(operatingStrategyReply(null), /没有已确认/);
  assert.match(weeklyTaskReply(null), /没有已确认/);
});
