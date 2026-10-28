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
  assert.match(weeklyTaskReply(overview), /本周计划已开始。已完成 1 项/);
  assert.match(weeklyTaskReply(overview), /还有 1 项需要处理/);
});

test('无证据时保留明确缺口', () => {
  assert.match(industrySignalsReply(null), /没有可追溯/);
  assert.match(operatingStrategyReply(null), /没有已确认/);
  assert.match(weeklyTaskReply(null), /还没有可启动的计划/);
});

test('查看被阻塞的周计划时说明缺什么而不暴露内部镜头编码', () => {
  const blocked = { ...overview, run: null, plan: { ...overview.plan,
    businessPackage: { detailGeneration: { status: 'blocked', blockers: [
      '默认数字人物尚未授权可用', 'P5A_EXHIBITION 缺少已授权片段',
    ] } },
  } } as unknown as DigitalEmployeeOverview;
  const reply = weeklyTaskReply(blocked, { ready: false, blockers: [
    { code: 'presenter_missing', message: '默认数字人物尚未授权可用', action: 'configure_presenter' },
    { code: 'local_material_missing', message: 'P5A_EXHIBITION 缺少已授权片段', action: 'upload_local_material' },
  ] });
  assert.match(reply, /本周计划还没有开始/);
  assert.match(reply, /数字人物/);
  assert.match(reply, /先录入数字人物与声音。/);
  assert.doesNotMatch(reply, /或改成不需要人物口播|P5A_EXHIBITION/);
  assert.doesNotMatch(reply, /P5A_EXHIBITION/);
});

test('missing footage reply stays short and delegates exact previews to cards', () => {
  const draft = { ...overview, run: null } as unknown as DigitalEmployeeOverview;
  const reply = weeklyTaskReply(draft, { ready: false, blockers: [
    { code: 'local_material_missing', message: '缺少展会片段', action: 'upload_local_material' },
  ], materialGaps: [
    { requirementId: '1:ref:shot-a', video: '新品走进展会', product: '泡沫卸妆蜜', shot: 2, footage: '展会展位实拍', minimumSeconds: 3, productId: null, materialType: 'general', referenceThumbnailUrl: null, shotFirstFrameRef: null },
    { requirementId: '2:ref:shot-b', video: '工厂幕后', product: '泡沫卸妆蜜', shot: 4, footage: '灌装设备特写', minimumSeconds: 2, productId: null, materialType: 'factory', referenceThumbnailUrl: null, shotFirstFrameRef: null },
  ] });
  assert.match(reply, /有 2 个镜头还缺可用实拍，预览如下/);
  assert.doesNotMatch(reply, /1\. 「新品走进展会」|2\. 「工厂幕后」/);
  assert.doesNotMatch(reply, /打开素材库|P5A_EXHIBITION/);
});

test('草稿回复只说启动状态和下一步，不暴露开发状态码或没有执行的任务数量', () => {
  const draft = { ...overview, run: null, goal: { ...overview.goal, status: 'draft' }, tasks: [] } as unknown as DigitalEmployeeOverview;
  const reply = weeklyTaskReply(draft, { ready: true, blockers: [] });
  assert.match(reply, /本周计划还没有开始/);
  assert.match(reply, /制作资料已齐/);
  assert.doesNotMatch(reply, /draft|真实任务|计划策略|managed/);
});

test('无法核验制作条件时不谎称资料齐全或引导直接启动', () => {
  const draft = { ...overview, run: null } as unknown as DigitalEmployeeOverview;
  assert.match(weeklyTaskReply(draft, null), /最新状态暂时无法核验/);
  assert.doesNotMatch(weeklyTaskReply(draft, null), /确认并开始/);
});

test('资料版本不一致时不把已存在的企业资料误称为缺失', () => {
  const draft = { ...overview, run: null } as unknown as DigitalEmployeeOverview;
  const reply = weeklyTaskReply(draft, { ready: false, blockers: [{
    code: 'enterprise_facts_mismatch', message: '企业资料版本不一致', action: 'complete_enterprise_profile',
  }] });
  assert.match(reply, /企业资料.*计划还没同步/);
  assert.match(reply, /点击“同步周计划”/);
  assert.match(reply, /不会自动开始生产/);
  assert.doesNotMatch(reply, /核对企业与品牌资料|新建周目标|资料有问题/);
});

test('暂停的周计划不被说成正在生产', () => {
  const paused = { ...overview, run: { ...overview.run, status: 'paused' }, tasks: [] } as unknown as DigitalEmployeeOverview;
  const reply = weeklyTaskReply(paused);
  assert.match(reply, /本周计划已暂停/);
  assert.match(reply, /查看暂停原因/);
  assert.doesNotMatch(reply, /本周计划已开始/);
});

test('blocked digital-presenter production offers the shared intake in conversation', () => {
  const blocked = { ...overview, run: { ...overview.run, status: 'running' }, tasks: [{
    run_id: 'run', title: '视频制作', status: 'blocked', blocked_reason: '缺少可用数字人物与声音',
  }] } as unknown as DigitalEmployeeOverview;
  assert.match(weeklyTaskReply(blocked), /先录入数字人物与声音/);
});
