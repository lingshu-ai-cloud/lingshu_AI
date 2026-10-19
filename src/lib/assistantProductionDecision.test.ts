import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductionReadView } from './productionReadModel';
import {
  ASSISTANT_PRODUCTION_NAVIGATION_NOTICE,
  assistantProductionCommandLabel,
  productionDecisionFromReadView,
  type AssistantProductionCommand,
} from './assistantProductionDecision';

function view(): ProductionReadView {
  const cost = { currency: 'CNY' as const, expectedCny: 2.4, upperBoundCny: 6, actualCny: null, unsettledCny: null,
    status: 'estimated' as const, reusable: false, basis: 'execution_plan' as const };
  const identityGuarantee = { overall: 'qa_gated' as const, product: 'qa_gated' as const, presenter: 'not_required' as const,
    requiresQa: true, basis: ['生成后质检'] };
  const input = { id: 'budget-1', kind: 'budget_confirmation' as const, label: '确认上限', required: true,
    status: 'missing' as const, reason: '预算上限待确认', source: 'canonical_task' as const };
  return {
    source: 'canonical_task',
    project: { id: 'task-1', version: 'task:7', studioProjectId: 'studio-1', studioProjectVersion: 'studio:3', title: '测试项目' },
    aggregate: {
      stage: 'input', status: 'needs_input', executable: false, identityGuarantee,
      inputs: { required: ['确认上限'], missing: ['确认上限'], items: [input] }, cost, blockers: [],
      counts: { total: 1, ready: 0, running: 0, needsInput: 1, blocked: 0, review: 0, completed: 0 },
      phases: [{ phase: 'input', status: 'blocked' }], allowedCommands: ['open_project', 'confirm_budget'],
    },
    shots: [{
      shotId: 'shot-1', slotId: 'slot-1', order: 1, title: '产品特写', status: 'needs_input', executable: false,
      route: { selected: null, recommended: { kind: 'product_composite', sourceStrategy: 'pixel_composite', label: '真实产品像素合成', executable: false, reason: null }, fallbacks: [] },
      identityGuarantee, inputs: { required: ['确认上限'], missing: ['确认上限'], items: [input] }, cost, blockers: [],
      allowedCommands: ['open_shot', 'confirm_budget'],
    }],
    updatedAt: '2026-10-13T00:00:00.000Z',
  };
}

test('budget card comes from typed inputs and preserves the versioned allowed command', () => {
  const decision = productionDecisionFromReadView(view());
  assert.equal(decision?.kind, 'budget');
  assert.equal(decision?.subjectVersion, 'task:7');
  assert.deepEqual(decision?.commands, [{ command: 'confirm_budget', label: '确认预算', shotId: 'shot-1' }]);
  assert.match(decision?.facts.map(item => item.value).join(' ') || '', /¥2\.40.*¥6\.00/);
});

test('production command copy distinguishes navigation from an executable mutation', () => {
  const commands: AssistantProductionCommand[] = [
    { command: 'confirm_budget', label: '确认预算', shotId: 'shot-1' },
    { command: 'retry', label: '恢复原任务', shotId: 'shot-1' },
    { command: 'use_fallback', label: '使用备选路线', shotId: 'shot-1' },
    { command: 'approve_output', label: '通过验收', shotId: 'shot-1' },
  ];
  for (const command of commands) {
    assert.equal(assistantProductionCommandLabel(command, true, true), command.label);
    assert.equal(assistantProductionCommandLabel(command, false, true), '前往处理');
    assert.equal(assistantProductionCommandLabel(command, false, false), '查看并处理');
  }
  assert.match(ASSISTANT_PRODUCTION_NAVIGATION_NOTICE, /不会直接执行生产操作/);
});

test('fallback copy never invents an executable command', () => {
  const source = view();
  source.aggregate.inputs = { required: [], missing: [], items: [] };
  source.aggregate.status = 'blocked';
  source.shots[0] = {
    ...source.shots[0], status: 'blocked', inputs: { required: [], missing: [], items: [] },
    route: { ...source.shots[0].route, fallbacks: [{ kind: 'material_edit', sourceStrategy: 'library', label: '改用素材剪辑', executable: true, reason: '成功率更高' }] },
    blockers: [{ code: 'provider_failed', message: '生成失败', recoverable: true, inputId: null }],
    allowedCommands: ['open_shot'],
  };
  source.aggregate.allowedCommands = ['open_project'];
  const decision = productionDecisionFromReadView(source);
  assert.equal(decision?.kind, 'fallback');
  assert.deepEqual(decision?.commands, []);
});

test('non-canonical Studio fallback cannot become an assistant decision', () => {
  const source = view();
  source.source = 'studio_route_plan';
  assert.equal(productionDecisionFromReadView(source), null);
});

test('missing input kinds expose only allowlisted actions and safe destinations', () => {
  const cases = [
    ['material', 'select_material', 'smartAssets'],
    ['product_asset', 'upload_product_asset', 'enterprise'],
    ['presenter_asset', 'select_presenter', 'smartAssets'],
    ['reference_media', 'select_material', 'smartAssets'],
    ['fact_confirmation', 'confirm_facts', 'enterprise'],
    ['rights_confirmation', 'confirm_rights', 'enterprise'],
    ['account_authorization', 'connect_account', 'accountManagement'],
    ['production_choice', 'confirm_production_choice', 'smartAssets'],
    ['quality_review', 'review_output', 'smartAssets'],
  ] as const;

  for (const [kind, allowedCommand, page] of cases) {
    const source = view();
    const input = { ...source.shots[0].inputs.items[0], id: `input-${kind}`, kind, label: `missing-${kind}` };
    source.aggregate.inputs = { required: [input.label], missing: [input.label], items: [input] };
    source.aggregate.allowedCommands = ['open_project', allowedCommand];
    source.shots[0] = {
      ...source.shots[0],
      inputs: { required: [input.label], missing: [input.label], items: [input] },
      allowedCommands: ['open_shot', allowedCommand],
    };
    const decision = productionDecisionFromReadView(source);
    assert.equal(decision?.kind, 'input_required', kind);
    assert.equal(decision?.commands[0]?.command, allowedCommand, kind);
    assert.equal(decision?.commands[0]?.deepLink?.page, page, kind);

    source.aggregate.allowedCommands = ['open_project'];
    source.shots[0] = { ...source.shots[0], allowedCommands: ['open_shot'] };
    assert.deepEqual(productionDecisionFromReadView(source)?.commands, [], `${kind} must not infer a command from copy`);
  }
});

test('input cards show at most two distinct allowed actions', () => {
  const source = view();
  const inputs = [
    { ...source.shots[0].inputs.items[0], id: 'account', kind: 'account_authorization' as const, label: '连接账号' },
    { ...source.shots[0].inputs.items[0], id: 'choice', kind: 'production_choice' as const, label: '选择方案' },
    { ...source.shots[0].inputs.items[0], id: 'asset', kind: 'product_asset' as const, label: '补充产品图' },
  ];
  source.aggregate.inputs = { required: inputs.map(item => item.label), missing: inputs.map(item => item.label), items: inputs };
  source.shots[0] = { ...source.shots[0], inputs: source.aggregate.inputs,
    allowedCommands: ['open_shot', 'connect_account', 'confirm_production_choice', 'upload_product_asset'] };
  source.aggregate.allowedCommands = ['open_project', 'connect_account', 'confirm_production_choice', 'upload_product_asset'];

  assert.deepEqual(productionDecisionFromReadView(source)?.commands.map(item => item.command), [
    'connect_account', 'confirm_production_choice',
  ]);
});
