import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductionReadModelV1 } from '../../shared/contracts/productionReadModel';
import {
  adaptStudioBatchRoutesToProductionReadView,
  canonicalProductionMatchesStudio,
  canonicalProductionReadView,
  isProductionReadModelV1,
  productionAllows,
  productionCommandAllowed,
  productionIdentityLabel,
  productionRouteLabel,
  productionShotForSlot,
  productionStatusLabel,
} from './productionReadModel';

test('Studio batch route fallback keeps route, cost envelope and missing inputs without inventing shooting', () => {
  const view = adaptStudioBatchRoutesToProductionReadView({
    projectId: 'studio-1', planningOnly: true, counts: {},
    routes: [
      { shotId: 'shot-product', slotId: 'slot-product', order: 1, visualTopic: 'product', expressionPurpose: '产品展示',
        route: 'aigc_first_frame', status: 'needs_plan', matchedMaterialId: null, matchedSegmentId: null,
        trimStart: null, trimEnd: null, reason: '自动准备目标首帧', generated: false },
      { shotId: 'shot-missing', slotId: 'slot-missing', order: 2, visualTopic: 'factory', expressionPurpose: '工厂环境',
        route: 'local_material', status: 'needs_material', matchedMaterialId: null, matchedSegmentId: null,
        trimStart: null, trimEnd: null, reason: '请选择企业素材', generated: false },
    ],
    aigcBudgetPreview: {
      planningOnly: true, modelId: 'video-model', totalShots: 2, aigcShots: 1, aigcShotRatio: 0.5,
      candidateDurationSeconds: 4, maxRetries: 1, estimate480pCny: 4.8, estimate720pCny: 8,
      batchBudgetCny: 20, recommendedResolution: '480p', budgetEnoughFor480p: true,
      shotPlans: [{ shotId: 'shot-product', status: 'ready', targetDurationSeconds: 4, resolutionTier: '480p',
        modelId: 'video-model', estimatedCostCny: 4.8, estimatedVideoCostCny: 2,
        estimatedFirstFrameCostCny: 0.3, estimatedGeometryObservationCostCny: 0.1 }],
    },
  });

  const product = productionShotForSlot(view, 'slot-product');
  assert.ok(product);
  assert.equal(productionRouteLabel(product), 'AIGC 首帧与视频');
  assert.equal(product.cost.expectedCny, 2.4);
  assert.equal(product.cost.upperBoundCny, 4.8);
  assert.equal(productionIdentityLabel(product), '生成后质检确认');
  assert.equal(productionAllows(product, 'request_shoot'), false);
  assert.equal(productionCommandAllowed(view, product, 'request_shoot'), false,
    'Studio compatibility projection must not invent a state-changing shooting command');
  assert.equal(productionCommandAllowed(view, product, 'select_material'), false);
  assert.equal(productionCommandAllowed(view, product, 'generate'), false);
  assert.deepEqual(productionShotForSlot(view, 'slot-missing')?.inputs.missing, ['请选择企业素材']);
  assert.equal(view.aggregate.counts.needsInput, 1);
});

test('Studio local material stays executable without claiming exact SKU identity from a bare assignment', () => {
  const base = {
    projectId: 'studio-material-identity', planningOnly: true as const, counts: {},
    routes: [{ shotId: 'shot-product', slotId: 'slot-product', order: 1, visualTopic: 'product' as const,
      expressionPurpose: '产品展示', route: 'local_material' as const, status: 'matched' as const,
      matchedMaterialId: 'material-1', matchedSegmentId: null, trimStart: 0, trimEnd: 3,
      reason: '采用已绑定的企业素材', generated: false as const }],
  };
  const legacy = adaptStudioBatchRoutesToProductionReadView(base);
  const unverified = legacy.shots[0]!;
  assert.equal(unverified.executable, true, 'identity uncertainty must not make an otherwise usable edit route fail');
  assert.equal(unverified.identityGuarantee.product, 'unverified');
  assert.equal(productionIdentityLabel(unverified), '尚未验证真实产品');

  const exact = adaptStudioBatchRoutesToProductionReadView({
    ...base,
    routes: [{ ...base.routes[0]!, matchedProductId: 'product-a', matchedProductIdentityLevel: 'exact' as const }],
  });
  assert.equal(exact.shots[0]?.identityGuarantee.product, 'exact_source');
  assert.equal(productionIdentityLabel(exact.shots[0]!), '真实素材原样保留');
});

test('canonical task projection passes through as the preferred cross-surface view', () => {
  const model = {
    schemaVersion: 'production-read-model.v1', authority: 'canonical_task', updatedAt: '2026-10-13T00:00:00.000Z',
    project: { kind: 'social_content_task', id: 'task-1', version: 'v3', title: '视频任务', taskStatus: 'producing', runId: 'run-1',
      studioProjectId: 'studio-1', studioProjectVersion: 'p4', studioProjectStatus: 'draft', studioProjectConflict: false },
    aggregate: { stage: 'production', status: 'needs_input', executable: false,
      identityGuarantee: { overall: 'not_required', product: 'not_required', presenter: 'not_required', requiresQa: false, basis: [] },
      inputs: { required: [], missing: [], items: [] },
      cost: { currency: 'CNY', expectedCny: null, upperBoundCny: null, actualCny: null, unsettledCny: null, status: 'unknown', reusable: false, basis: 'unavailable' },
      blockers: [], counts: { total: 1, ready: 0, running: 0, needsInput: 1, blocked: 0, review: 0, completed: 0 },
      phases: [{ phase: 'production', status: 'blocked' }], allowedCommands: ['open_project'] },
    shots: [{ shotId: 'shot-1', slotId: 'slot-1', order: 1, title: '镜头一',
      route: { selected: null, recommended: { kind: 'material_edit', sourceStrategy: 'material', label: '素材剪辑', executable: false, reason: '缺素材' }, fallbacks: [] },
      status: 'needs_input', executable: false,
      identityGuarantee: { overall: 'not_required', product: 'not_required', presenter: 'not_required', requiresQa: false, basis: [] },
      inputs: { required: ['企业素材'], missing: ['企业素材'], items: [] },
      cost: { currency: 'CNY', expectedCny: null, upperBoundCny: null, actualCny: null, unsettledCny: null, status: 'unknown', reusable: false, basis: 'unavailable' },
      blockers: [], allowedCommands: ['open_shot', 'select_material'] }],
  } satisfies ProductionReadModelV1;

  const view = canonicalProductionReadView(model);
  assert.equal(view.source, 'canonical_task');
  assert.equal(view.project.studioProjectVersion, 'p4');
  assert.equal(productionStatusLabel(view.shots[0].status), '等待资料');
  assert.equal(productionAllows(view.shots[0], 'select_material'), true);
  assert.equal(productionCommandAllowed(view, view.shots[0], 'request_shoot'), false);
  assert.equal(isProductionReadModelV1(model), true);
  assert.equal(isProductionReadModelV1({ ...model, schemaVersion: 'production-read-model.v0' }), false);
});

test('canonical project binding wins over coincidental slot ids from another Studio project', () => {
  const model = {
    schemaVersion: 'production-read-model.v1', authority: 'canonical_task', updatedAt: '2026-10-13T00:00:00.000Z',
    project: { kind: 'social_content_task', id: 'task-1', version: 'v3', title: '视频任务', taskStatus: 'producing', runId: 'run-1',
      studioProjectId: 'studio-a', studioProjectVersion: 'p4', studioProjectStatus: 'draft', studioProjectConflict: false },
    aggregate: { stage: 'production', status: 'ready', executable: true,
      identityGuarantee: { overall: 'not_required', product: 'not_required', presenter: 'not_required', requiresQa: false, basis: [] },
      inputs: { required: [], missing: [], items: [] },
      cost: { currency: 'CNY', expectedCny: null, upperBoundCny: null, actualCny: null, unsettledCny: null, status: 'unknown', reusable: false, basis: 'unavailable' },
      blockers: [], counts: { total: 1, ready: 1, running: 0, needsInput: 0, blocked: 0, review: 0, completed: 0 },
      phases: [{ phase: 'production', status: 'active' }], allowedCommands: ['open_project'] },
    shots: [{ shotId: 'shot-1', slotId: 'scene-1', order: 1, title: '镜头一',
      route: { selected: null, recommended: { kind: 'material_edit', sourceStrategy: 'material', label: '素材剪辑', executable: true, reason: null }, fallbacks: [] },
      status: 'ready', executable: true,
      identityGuarantee: { overall: 'not_required', product: 'not_required', presenter: 'not_required', requiresQa: false, basis: [] },
      inputs: { required: [], missing: [], items: [] },
      cost: { currency: 'CNY', expectedCny: null, upperBoundCny: null, actualCny: null, unsettledCny: null, status: 'unknown', reusable: false, basis: 'unavailable' },
      blockers: [], allowedCommands: ['open_shot', 'request_shoot'] }],
  } satisfies ProductionReadModelV1;
  const bound = canonicalProductionReadView(model);

  assert.equal(canonicalProductionMatchesStudio(bound, {
    studioProjectId: 'studio-b', socialContentTaskId: 'task-1', slotIds: ['scene-1'],
  }), false);
  assert.equal(canonicalProductionMatchesStudio(bound, {
    studioProjectId: 'studio-a', socialContentTaskId: 'another-task', slotIds: [],
  }), true);
  assert.equal(productionCommandAllowed(bound, bound.shots[0], 'request_shoot'), true,
    'an authoritative backend command remains executable');

  const unbound = canonicalProductionReadView({ ...model, project: { ...model.project, studioProjectId: null } });
  assert.equal(canonicalProductionMatchesStudio(unbound, {
    studioProjectId: 'studio-b', socialContentTaskId: 'task-1', slotIds: ['scene-1'],
  }), true);
  assert.equal(canonicalProductionMatchesStudio(unbound, {
    studioProjectId: 'studio-b', socialContentTaskId: 'another-task', slotIds: ['scene-1'],
  }), false);
});
