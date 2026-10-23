import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProductionReadView } from '../lib/productionReadModel';
import { CanonicalProductionProgress, ProductionAggregateSummary } from './ProductionTaskScene';

const view = {
  source: 'canonical_task',
  project: { id: 'task-1', version: 'v4', studioProjectId: 'studio-1', studioProjectVersion: 's2', title: '社媒视频' },
  aggregate: {
    stage: 'input', status: 'needs_input', executable: false,
    identityGuarantee: { overall: 'qa_gated', product: 'qa_gated', presenter: 'not_required', requiresQa: true, basis: [] },
    inputs: { required: ['产品正面图'], missing: ['产品正面图'], items: [] },
    cost: { currency: 'CNY', expectedCny: 3.2, upperBoundCny: 8, actualCny: null, unsettledCny: null, status: 'estimated', reusable: false, basis: 'execution_plan' },
    blockers: [{ code: 'missing_asset', message: '分镜 2 缺少真实产品图', recoverable: true, inputId: null }],
    counts: { total: 4, ready: 1, running: 1, needsInput: 1, blocked: 1, review: 0, completed: 0 },
    phases: [
      { phase: 'planning', status: 'completed' },
      { phase: 'input', status: 'blocked' },
      { phase: 'production', status: 'pending' },
      { phase: 'render', status: 'pending' },
      { phase: 'qa', status: 'pending' },
      { phase: 'review', status: 'pending' },
    ], allowedCommands: ['open_project'],
  },
  shots: [], updatedAt: '2026-10-13T00:00:00.000Z',
} as ProductionReadView;

test('digital employee shows one aggregate production summary and a deep link, not a second editor', () => {
  const html = renderToStaticMarkup(<ProductionAggregateSummary view={view} onOpenProduction={() => {}} />);
  for (const label of ['统一生产状态', '等待资料', '已就绪', '1 / 4', '制作中', '已完成', '等待处理', '预计 ¥3.20 · 上限 ¥8.00', '产品正面图', '分镜 2 缺少真实产品图', '打开内容制作']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, />可执行</);
  assert.doesNotMatch(html, /选择素材|上传产品|开始生成/);
});

test('ready KPI does not absorb running or completed shots', () => {
  const html = renderToStaticMarkup(<ProductionAggregateSummary view={{
    ...view,
    aggregate: {
      ...view.aggregate,
      counts: { total: 6, ready: 1, running: 2, needsInput: 0, blocked: 0, review: 0, completed: 3 },
    },
  }} />);
  assert.match(html, /已就绪[\s\S]*1 \/ 6/);
  assert.match(html, /制作中[\s\S]*2/);
  assert.match(html, /已完成[\s\S]*3/);
  assert.doesNotMatch(html, /已就绪[\s\S]*6 \/ 6/);
});

test('canonical production progress uses server phases without invented duration', () => {
  const html = renderToStaticMarkup(<CanonicalProductionProgress view={view} />);
  for (const label of ['规划与分镜', '素材与授权', '逐镜制作', '已完成', '需处理', '没有服务端证据时不显示预计耗时']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /约 \d+|预计：/);
});

test('over-budget task displays a blocker and awaits the user without a generate or retry control',()=>{
 const message='当前额度 ¥15.00，已占用 ¥14.00，本次新增报价 ¥2.00，累计 ¥16.00。含重试和修订，不含采集；请用户最终决策。';
 const blocked:ProductionReadView={...view,aggregate:{...view.aggregate,status:'blocked',executable:false,inputs:{required:['生产预算待决策'],missing:['生产预算待决策'],items:[{id:'budget',kind:'budget_confirmation',label:'生产预算待决策',required:true,status:'pending_confirmation',reason:message,source:'canonical_task'}]},blockers:[{code:'production_budget_decision_required',message,recoverable:true,inputId:'budget'}],allowedCommands:['confirm_budget','open_project']}};
 const html=renderToStaticMarkup(<ProductionAggregateSummary view={blocked} onOpenProduction={()=>{}}/>);
 for(const text of ['已阻塞','当前额度 ¥15.00','已占用 ¥14.00','新增报价 ¥2.00','累计 ¥16.00','不含采集','最终决策'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/开始生成|自动重试/);
});
