import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { advanceManagedReplication, MANAGED_REPLICATION_SERVICE_RETRY_DELAY_MS, managedReplicationCostCap, managedReplicationFailureState, managedReplicationPlanHasExecutionGraph, managedReplicationPresenterReadiness, repairManagedReplicationNarrationContract, repairManagedReplicationNarrationTiming, selectManagedReplicationPresenter, type ManagedReplicationPorts } from './replicationContentProduction.js';
import { MANAGED_REPLICATION_PLAN_VERSION } from './replicationWorkbenchPlan.js';

function fixture() {
  let row: any = { id: 'p', tenant_id: 't', status: 'draft', spec: { automation: { route: 'clone', stage: 'blocked', blocker: 'needs_per_shot_replication_bridge', referenceAnalysisId: 'r' }, workflowRunId: 'run',
    contentOrder: { operatingContext: { productionBudget: 75.6, productionBudgetMax: 75.6, productionSpent: 0, productionReserved: 75.6, estimatedContentCost: 37.8, estimatedContentCostMax: 75.6, productionBudgetMode: 'protected', maxAigcRetries: 1 } } } };
  const store: DataStore = { getById: async () => structuredClone(row), update: async (_c, _id, patch) => { row = { ...row, ...patch }; return true; },
    create: async () => null, delete: async () => false, list: async () => ({ items: [], page: 1, perPage: 1, totalItems: 0, totalPages: 0 }) };
  let calls = 0; const costCaps: number[] = [];
  const ports: ManagedReplicationPorts = { initialize: input => ({ ...input.spec, automatedReplicationPlan: { version: MANAGED_REPLICATION_PLAN_VERSION }, automatedReplicationShots: [{ shotId: 'shot-1', slotId: 'slot-1', kind: 'nonperson', productionState: 'ready' }] }),
    execute: async input => { calls++; costCaps.push(input.maxCostCny); return { state: calls === 1 ? 'pending' : 'ready', changed: true }; },
    materials: async () => [], finish: async () => ({ renderOutputPath: '/real/finished.mp4', automation: { quality: { passed: true } } }) };
  return { store, ports, row: () => row, calls: () => calls, costCaps: () => costCaps, input: { tenantId: 't', projectId: 'p', store, references: [{ id: 'r', tenantId: 't' }], ports } };
}
test('old blocked business clone progresses through actual executor then verified finalizer without generic edit fallback', async () => {
  const f = fixture();
  await advanceManagedReplication(f.input);
  assert.equal(f.row().spec.workflowRunId, 'run'); assert.equal(f.calls(), 0);
  await advanceManagedReplication(f.input);
  assert.equal(f.row().status, 'draft'); assert.equal(f.row().spec.automation.stage, 'material_match');
  assert.deepEqual(f.costCaps(), [75.6]);
  await advanceManagedReplication(f.input);
  assert.equal(f.row().status, 'ready_for_approval'); assert.equal(f.row().spec.automation.stage, 'completed');
  assert.deepEqual(await advanceManagedReplication(f.input), { changed: false, blocker: '' }); assert.equal(f.calls(), 2);
});
test('confirmed narration repairs non-person legacy fragments without deleting paid visual progress', () => {
  const body = '[0-4s]\n台词：A verified product detail.';
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const spec: any = {
    lang: 'en', activeAssemblyId: 'video-1', script: '[0-4s]\n台词：旧的中文口播。',
    contentOrder: { videoPlan: { language: 'en' }, scripts: { en: { body, hash: hash(body), status: 'confirmed', generatedBy: 'director_agent' } } },
    automatedReplicationShots: [{ shotId: 'shot', slotId: 'slot', kind: 'nonperson', start: 0, end: 4 }],
    automatedReplicationProgress: { shot: { videoMaterialId: 'paid-visual', adopted: true } },
    shotProductions: { 'video-1:shot': { narration: '旧的中文口播。', adoptedId: 'candidate' } },
    automation: { route: 'clone', stage: 'blocked', blocker: 'language mismatch' },
  };
  const repaired = repairManagedReplicationNarrationContract(spec)!;
  assert.equal(repaired.script, body);
  assert.equal(repaired.shotProductions['video-1:shot'].narration, '');
  assert.equal(repaired.automatedReplicationProgress.shot.videoMaterialId, 'paid-visual');
  assert.deepEqual(repaired.automatedReplicationNarrationTrack, [{ start: 0, end: 4, text: 'A verified product detail.' }]);
  assert.equal(repaired.automation.status, 'processing');
});
test('measured overflow compacts only the remaining deterministic fallback segments and preserves paid visuals', () => {
  const body = '[0-4s]\n台词：Start with the selected product in the verified enterprise record.\n字幕：Start with the selected product in the verified enterprise record.\n\n[4-8s]\n台词：Next, check SKU. The confirmed record says GUIANFA-RS-001.\n字幕：Next, check SKU. The confirmed record says GUIANFA-RS-001.\n\n[8-12s]\n台词：For a purchasing decision, do not miss Net content: 100ml.\n字幕：For a purchasing decision, do not miss Net content: 100ml.';
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const spec: any = { lang: 'en', script: body, renderOutputPath: '/stale.mp4', automatedReplicationFinish: { stale: true },
    automatedReplicationProgress: { shot: { videoMaterialId: 'paid-video' } },
    contentOrder: { scripts: { en: { version: 1, body, hash: hash(body), language: 'en', status: 'confirmed', generatedBy: 'director_agent', source: 'deterministic_closed_world_fallback' } } },
    automation: { route: 'clone', stage: 'blocked', blocker: 'overflow' } };
  const repaired = repairManagedReplicationNarrationTiming(spec, new Error('第 2 段实测口播 6.46 秒超过冻结区间 4.00 秒，禁止自动截断'), '2026-10-14T00:00:00.000Z')!;
  assert.match(repaired.script, /Start with the selected product/, 'already accepted first segment and its cached voice remain unchanged');
  assert.match(repaired.script, /台词：SKU: GUIANFA-RS-001\./);
  assert.match(repaired.script, /台词：Net content: 100ml\./);
  assert.equal(repaired.contentOrder.scripts.en.version, 2);
  assert.equal(repaired.renderOutputPath, undefined);
  assert.equal(repaired.automatedReplicationFinish, undefined);
  assert.deepEqual(repaired.automatedReplicationProgress.shot, { videoMaterialId: 'paid-video' });
  assert.equal(repaired.automation.narrationTimingRepairFromSegment, 2);
  assert.equal(repairManagedReplicationNarrationTiming({ ...spec, contentOrder: { scripts: { en: { ...spec.contentOrder.scripts.en, source: 'llm' } } } }, new Error('第 2 段实测口播 6.46 秒超过冻结区间 4.00 秒')), null);
});
test('transient managed replication failures retry on the next runtime tick instead of appearing stalled', async () => {
  const f = fixture();
  await advanceManagedReplication(f.input);
  f.ports.execute = async () => { throw Object.assign(new Error('原制作请求仍在处理，请查询原任务；未重复调用供应商'), { code: 'STORYBOARD_OPERATION_IN_PROGRESS' }); };
  const before = Date.now();
  const result = await advanceManagedReplication(f.input);
  const retryAt = Date.parse(f.row().spec.automation.retryAfter);
  assert.equal(result.blocker, '原制作请求仍在处理，请查询原任务；未重复调用供应商');
  assert.equal(f.row().spec.automation.retryPolicy, 'service_retry');
  assert.ok(retryAt >= before + MANAGED_REPLICATION_SERVICE_RETRY_DELAY_MS - 1_000);
  assert.ok(retryAt <= before + MANAGED_REPLICATION_SERVICE_RETRY_DELAY_MS + 5_000);
});
test('a version-only legacy shell rebuilds its execution graph and preserves existing receipts', async () => {
  const f = fixture();
  await advanceManagedReplication(f.input);
  const receipt = { providerTaskId: 'already-submitted-task', materialId: 'existing-paid-frame' };
  f.row().spec.automatedReplicationShots = [];
  f.row().spec.automatedReplicationProgress = { retained: receipt };
  assert.equal(managedReplicationPlanHasExecutionGraph(f.row().spec), false);
  let repairs = 0;
  f.ports.initialize = input => {
    repairs += 1;
    assert.equal(Number((input.spec.automatedReplicationPlan as any).version), MANAGED_REPLICATION_PLAN_VERSION - 1);
    return { ...input.spec, automatedReplicationPlan: { version: MANAGED_REPLICATION_PLAN_VERSION },
      automatedReplicationShots: [{ shotId: 'shot-1', slotId: 'slot-1', kind: 'nonperson', productionState: 'ready' }] };
  };
  await advanceManagedReplication(f.input);
  assert.equal(repairs, 1);
  assert.equal(f.calls(), 1, 'repair continues through the executor instead of remaining falsely processing');
  assert.deepEqual(f.row().spec.automatedReplicationProgress.retained, receipt);
});
test('a newly usable enterprise presenter refreshes only stale person blockers and resumes the existing plan', async () => {
  const f = fixture();
  await advanceManagedReplication(f.input);
  const retainedReceipt = { materialId: 'existing-paid-nonperson', adopted: true };
  f.row().spec.automatedReplicationShots = [{
    shotId: 'person-shot', slotId: 'person-slot', kind: 'blocked', intendedKind: 'person',
    blockerCode: 'presenter_authorization_required', productionState: 'blocked',
  }];
  f.row().spec.automatedReplicationProgress = { 'nonperson-shot': retainedReceipt };
  const rightsEvidence = { authorizationRef: 'document://enterprise/consent', consentRef: 'consent://enterprise/person',
    grantedAt: '2026-09-01T00:00:00Z', subjectAdultConfirmed: true,
    permittedProviders: ['volcengine_ark'], permittedUses: ['person_replacement'] };
  const presenter = { id: 'enterprise-presenter', authorized: true,
    arkCertification: { status: 'active', assetUri: 'asset://asset-enterprise-presenter', assetType: 'image',
      materialId: 'portrait', verificationSource: 'ark_api', projectName: 'enterprise', groupId: 'group-1' },
    referenceMaterialIds: ['portrait'], rightsEvidence };
  f.store.list = (async collection => collection === 'studio_production_defaults'
    ? { items: [{ payload: { defaultPresenterId: presenter.id, presenters: [presenter] } }], page: 1, perPage: 1, totalItems: 1, totalPages: 1 }
    : { items: [], page: 1, perPage: 1, totalItems: 0, totalPages: 0 }) as DataStore['list'];
  let refreshes = 0;
  f.ports.initialize = input => {
    refreshes += 1;
    assert.equal(input.presenterId, presenter.id);
    assert.equal(Number((input.spec.automatedReplicationPlan as any).version), MANAGED_REPLICATION_PLAN_VERSION - 1);
    return { ...input.spec, automatedReplicationPlan: { version: MANAGED_REPLICATION_PLAN_VERSION },
      automatedReplicationShots: [{ shotId: 'person-shot', slotId: 'person-slot', kind: 'person', productionState: 'ready' }] };
  };
  await advanceManagedReplication(f.input);
  assert.equal(refreshes, 1);
  assert.equal(f.calls(), 1, 'resume should continue into the native executor in the same pass');
  assert.equal(f.row().spec.automatedReplicationShots[0].kind, 'person');
  assert.deepEqual(f.row().spec.automatedReplicationProgress['nonperson-shot'], retainedReceipt);
});
test('an impossible replication request without a source frame is repaired in place and resumes without losing receipts', async () => {
  const f = fixture();
  await advanceManagedReplication(f.input);
  const retainedReceipt = { materialId: 'existing-paid-shot', adopted: true, providerTaskId: 'provider-task-1' };
  f.row().spec.automatedReplicationShots = [{
    shotId: 'nonperson-shot', slotId: 'slot-1', kind: 'nonperson', productionState: 'ready',
    firstFrameRequest: { mode: 'replication', sourceFirstFrameUrl: '' },
  }];
  f.row().spec.automatedReplicationProgress = { 'paid-shot': retainedReceipt };
  let repairs = 0;
  f.ports.initialize = input => {
    repairs += 1;
    assert.equal(Number((input.spec.automatedReplicationPlan as any).version), MANAGED_REPLICATION_PLAN_VERSION - 1);
    return { ...input.spec, automatedReplicationPlan: { version: MANAGED_REPLICATION_PLAN_VERSION },
      storyboardSourcePlans: { 'slot-1': { mode: 'ai', fallbackMode: 'enterprise_product_display' } },
      automatedReplicationShots: [{ shotId: 'nonperson-shot', slotId: 'slot-1', kind: 'nonperson', productionState: 'ready',
        firstFrameRequest: { mode: 'free_creation' } }] };
  };
  await advanceManagedReplication(f.input);
  assert.equal(repairs, 1);
  assert.equal(f.calls(), 1, 'the repaired plan should resume in the same pass');
  assert.equal(f.row().spec.automatedReplicationShots[0].firstFrameRequest.mode, 'free_creation');
  assert.equal(f.row().spec.storyboardSourcePlans['slot-1'].fallbackMode, 'enterprise_product_display');
  assert.deepEqual(f.row().spec.automatedReplicationProgress['paid-shot'], retainedReceipt);
});
test('managed replication uses the approved per-content ceiling and fails closed without it', async () => {
  assert.equal(managedReplicationCostCap({ contentOrder: { operatingContext: {
    productionBudget: 20, productionBudgetMax: 20, productionSpent: 15, productionReserved: 20, estimatedContentCost: 8, estimatedContentCostMax: 12.5,
  } } }), 5);
  assert.equal(managedReplicationCostCap({ contentOrder: { operatingContext: { productionBudget: 20, productionSpent: 0 } } }), null);
  const f = fixture(); await advanceManagedReplication(f.input);
  f.row().spec.contentOrder.operatingContext.estimatedContentCostMax = 0;
  f.row().spec.contentOrder.operatingContext.estimatedContentCost = 0;
  const result = await advanceManagedReplication(f.input);
  assert.match(result.blocker, /单条制作额度/);
  assert.equal(f.calls(), 0, 'missing frozen cost must stop before the native supplier bridge');
});
test('partial native receipts survive an uncertain failure and failed finalization never completes', async () => {
  const f = fixture(); await advanceManagedReplication(f.input);
  f.ports.execute = async () => {
    await f.store.update('studio_projects', 'p', { spec: { ...f.row().spec, providerTasks: { cue: 'paid-original' } } });
    throw Error('供应商受理后状态未知，不能重复提交');
  };
  const failed = await advanceManagedReplication(f.input);
  assert.match(failed.blocker, /状态未知/); assert.equal(f.row().spec.providerTasks.cue, 'paid-original');
  assert.equal(f.row().spec.automation.stage, 'blocked'); assert.equal(f.row().status, 'draft');
  f.ports.execute = async () => ({ state: 'ready', changed: false });
  f.ports.finish = async () => ({ renderOutputPath: '/bad.mp4', automation: { quality: { passed: false } } });
  assert.match((await advanceManagedReplication(f.input)).blocker, /真实成片/);
  assert.notEqual(f.row().status, 'ready_for_approval');
});
test('tenant mismatch and missing exact reference stop before supplier work', async () => {
  const f = fixture();
  await assert.rejects(() => advanceManagedReplication({ ...f.input, tenantId: 'foreign' }), /不属于/);
  assert.match((await advanceManagedReplication({ ...f.input, references: [] })).blocker, /精确参考/);
  assert.equal(f.row().spec.automation.retryPolicy, 'input_required');
  assert.equal(f.row().spec.automation.retryAfter, '');
  assert.equal(f.calls(), 0);
});
test('missing shot boundaries are an analysis input gap, not a retryable provider outage', () => {
  assert.deepEqual(managedReplicationFailureState(new Error('复刻镜头类型或物理镜头边界不完整')), {
    blocker: '爆款分析缺少已确认的镜头类型或物理镜头边界，需补全分析后继续生产',
    retryPolicy: 'input_required',
  });
  assert.equal(managedReplicationFailureState(new Error('爆款分析缺少已确认的镜头类型，需补全分析后继续生产')).retryPolicy, 'input_required');
  assert.equal(managedReplicationFailureState(new Error('provider timeout')).retryPolicy, 'service_retry');
});
test('provider account and credential failures are explicit user-action blockers, not external waiting', () => {
  for (const message of [
    'DashScope 语音服务账户欠费，请充值后继续',
    'MiniMax 语音服务鉴权失败，请检查 API Key',
    'account is not in good standing; overdue-payment',
  ]) {
    const state = managedReplicationFailureState(new Error(message));
    assert.equal(state.retryPolicy, 'input_required', message);
    assert.equal(state.autoRecheckExternal, true, message);
  }
});
test('the exact cached voice preflight blocks before visual supplier work and resumes in place', async () => {
  const f = fixture();
  await advanceManagedReplication(f.input);
  const order: string[] = [];
  f.ports.voicePreflight = async () => { order.push('voice'); throw new Error('DashScope 语音服务账户欠费，请充值后继续'); };
  f.ports.execute = async () => { order.push('visual'); return { state: 'pending', changed: true }; };
  const blocked = await advanceManagedReplication(f.input);
  assert.match(blocked.blocker, /账户欠费/);
  assert.deepEqual(order, ['voice']);
  assert.equal(f.row().spec.automation.retryPolicy, 'input_required');
  assert.equal(f.row().spec.automation.autoRecheckExternal, true);
  assert.ok(Date.parse(f.row().spec.automation.retryAfter) > Date.now());
  f.ports.voicePreflight = async () => { order.push('voice-ready'); return {
    prepared: true, fingerprint: 'voice-receipt', source: 'qwen_tts', segmentCount: 5,
  }; };
  await advanceManagedReplication(f.input);
  assert.deepEqual(order, ['voice', 'voice-ready', 'visual']);
  assert.deepEqual(f.row().spec.automation.voicePreflight, {
    status: 'ready', fingerprint: 'voice-receipt', source: 'qwen_tts', segmentCount: 5,
    checkedAt: f.row().spec.automation.voicePreflight.checkedAt,
  });
});
test('budget, target usage and frozen narration gaps never schedule blind supplier retries', async () => {
  for (const message of [
    '当前分镜未进入智能生成预算计划，未调用供应商',
    '视频时长、清晰度或模型与当前预算计划不一致，请刷新后重试',
    '本月 Seedance 成本额度已不足：剩余 ¥0.00，本次预计需要 ¥4.00。',
    '当前使用动作需要补关键状态或拆成可逐段验收的短镜头',
    '当前动作缺少可验收的分段关键状态，或可使用单段生成',
    '当前分镜输入已变化，请重新生成并确认首帧',
    '使用场景需明确动作起点、步骤和可见终点，填写后重新生成并确认首帧',
    '第 2 镜目标使用场景缺少已确认的动作起点、步骤和终点',
    '冻结口播与目标语种 en 不一致；请先确认完整目标语种脚本，未提交配音',
    '冻结口播跨越第 1、2 镜且被分割为半句；需保留完整句连续配音及实测对齐，未提交配音',
    '冻结口播文字覆盖不完整或顺序不一致；请修复完整脚本与镜头映射，未提交配音',
    '第 14 镜需要已授权企业数字人',
  ]) {
    const f = fixture(); await advanceManagedReplication(f.input);
    f.ports.execute = async () => ({ state: 'blocked', changed: false, blocker: message });
    assert.equal((await advanceManagedReplication(f.input)).blocker, message);
    assert.equal(f.row().spec.automation.retryPolicy, 'input_required', message);
    assert.equal(f.row().spec.automation.retryAfter, '', message);
  }
  assert.equal(managedReplicationFailureState(Object.assign(new Error('budget needs approval'), { code: 'STORYBOARD_BUDGET_PLAN_UNAVAILABLE' })).retryPolicy, 'input_required');
  for (const code of ['STORYBOARD_BUDGET_PLAN_CHANGED', 'seedance_monthly_budget_exceeded', 'USAGE_ACTION_PLAN_NOT_READY', 'ACTION_SEGMENT_PLAN_NOT_READY', 'STORYBOARD_PROJECT_INPUT_CHANGED', 'FIRST_FRAME_NOT_CONFIRMED']) {
    assert.equal(managedReplicationFailureState(Object.assign(new Error('input needs review'), { code })).retryPolicy, 'input_required', code);
  }
  assert.equal(managedReplicationFailureState(new Error('视觉模型服务 503 暂不可用')).retryPolicy, 'service_retry');
});
test('hard QA failure requires repair, while QA service and response failures retain their retry classification', () => {
  for (const code of ['FIRST_FRAME_QA_FAILED', 'STORYBOARD_VIDEO_QA_FAILED', 'VIDEO_QA_FAILED', 'FINAL_VIDEO_QA_FAILED']) {
    assert.equal(managedReplicationFailureState(Object.assign(new Error('native check rejected'), { code })).retryPolicy, 'input_required', code);
  }
  assert.equal(managedReplicationFailureState(Object.assign(new Error('供应商任务已失败'), {
    code: 'STORYBOARD_VIDEO_PROVIDER_FAILED',
  })).retryPolicy, 'input_required');
  for (const message of ['非人物视频质量检查未通过', '非人物首帧未通过产品与画面质检：product_identity；未提交视频生成',
    '首帧真实视觉质检未通过，已保留原图并记录失败项', '逐镜成片自动质检失败：画面黑屏']) {
    assert.equal(managedReplicationFailureState(new Error(message)).retryPolicy, 'input_required', message);
  }
  for (const code of ['FIRST_FRAME_QA_SERVICE_UNAVAILABLE', 'FIRST_FRAME_QA_RESPONSE_INVALID']) {
    assert.equal(managedReplicationFailureState(Object.assign(new Error('首帧质检未通过：视觉模型响应不可用'), { code })).retryPolicy, 'service_retry', code);
  }
  assert.equal(managedReplicationFailureState(new Error('首帧视觉质检服务暂不可用，已保留原图和原质检状态，可稍后重试')).retryPolicy, 'service_retry');
  assert.equal(managedReplicationFailureState(new Error('首帧质检响应不完整，已保留原质检状态')).retryPolicy, 'service_retry');
});
test('native QA blocker codes reach managed retry state without dropping or reinitializing paid assets', async () => {
  for (const [blockerCode, retryPolicy] of [
    ['FIRST_FRAME_QA_FAILED', 'input_required'],
    ['STORYBOARD_VIDEO_QA_FAILED', 'input_required'],
    ['FIRST_FRAME_QA_SERVICE_UNAVAILABLE', 'service_retry'],
    ['FIRST_FRAME_QA_RESPONSE_INVALID', 'service_retry'],
  ] as const) {
    const f = fixture(); await advanceManagedReplication(f.input);
    const receipt = { firstFrameMaterialId: 'existing-paid-frame', firstFrameFingerprint: 'original-frame-version',
      videoMaterialId: 'existing-paid-video', providerTaskId: 'original-supplier-task' };
    f.row().spec.automatedReplicationProgress = { shot: structuredClone(receipt) };
    f.ports.initialize = () => { throw new Error('An existing QA asset must not reinitialize the production plan'); };
    f.ports.execute = async () => ({ state: 'blocked', changed: false, blocker: 'Native check rejected', blockerCode });
    await advanceManagedReplication(f.input);
    assert.equal(f.row().spec.automation.blockerCode, blockerCode);
    assert.equal(f.row().spec.automation.retryPolicy, retryPolicy);
    assert.equal(Boolean(f.row().spec.automation.retryAfter), retryPolicy === 'service_retry');
    assert.deepEqual(f.row().spec.automatedReplicationProgress.shot, receipt);
    f.ports.execute = async () => ({ state: 'pending', changed: true });
    await advanceManagedReplication(f.input);
    assert.equal(f.row().spec.automation.blockerCode, '');
    assert.equal(f.row().spec.automation.blocker, '');
    assert.deepEqual(f.row().spec.automatedReplicationProgress.shot, receipt);
  }
});
test('an edit during final assembly cannot be overwritten by an older successful render', async () => {
  const f = fixture(); await advanceManagedReplication(f.input);
  f.ports.execute = async () => ({ state: 'ready', changed: false });
  f.ports.finish = async () => {
    await f.store.update('studio_projects', 'p', { spec: { ...f.row().spec, script: 'newly edited narration' } });
    return { renderOutputPath: '/old.mp4', automation: { quality: { passed: true } } };
  };
  assert.match((await advanceManagedReplication(f.input)).blocker, /参数已变化/);
  assert.equal(f.row().spec.script, 'newly edited narration'); assert.equal(f.row().spec.renderOutputPath, undefined);
});
test('managed replication requires a recorded usable enterprise person and never substitutes another face', () => {
  const rightsEvidence = { authorizationRef: 'document://enterprise/consent', consentRef: 'consent://enterprise/person',
    grantedAt: '2026-09-01T00:00:00Z', subjectAdultConfirmed: true,
    permittedProviders: ['volcengine_ark'], permittedUses: ['person_replacement'] };
  const active = { id: 'active', authorized: true, arkCertification: { status: 'active', assetUri: 'asset://asset-active', assetType: 'image',
    materialId: 'photo', verificationSource: 'ark_api', projectName: 'enterprise', groupId: 'group-1' }, referenceMaterialIds: ['photo'], rightsEvidence };
  const placeholder = { id: 'uncertified', authorized: true, avatarId: 'demo-avatar', referenceMaterialIds: ['photo'] };
  assert.equal(selectManagedReplicationPresenter({ defaultPresenterId: 'uncertified', presenters: [placeholder, active] }), undefined);
  assert.equal(selectManagedReplicationPresenter({ presenters: [placeholder] }), undefined);
  assert.equal(selectManagedReplicationPresenter({ defaultPresenterId: 'active', presenters: [placeholder, active] })?.id, 'active');
  assert.equal(selectManagedReplicationPresenter({ presenters: [active] })?.id, 'active');
  assert.equal(selectManagedReplicationPresenter({ presenters: [active, { ...active, id: 'another' }] }), undefined);
  assert.equal(selectManagedReplicationPresenter({ presenters: [active] }, 'missing'), undefined);
  assert.equal(selectManagedReplicationPresenter({ presenters: [{ ...active, arkCertification: { status: 'active', assetUri: 'asset://placeholder' } }] }), undefined);
  assert.equal(selectManagedReplicationPresenter({ presenters: [{ ...active, arkCertification: { ...active.arkCertification, materialId: 'different-photo' } }] }), undefined);
  assert.equal(selectManagedReplicationPresenter({ presenters: [{ ...active, rightsEvidence: { ...rightsEvidence, revokedAt: '2026-10-01T00:00:00Z' } }] }), undefined);
  assert.deepEqual(managedReplicationPresenterReadiness({ presenters: [] }), {
    state: 'missing', presenterCount: 0, presenterId: '', presenterName: '',
  });
  assert.deepEqual(managedReplicationPresenterReadiness({ defaultPresenterId: 'draft', presenters: [{ id: 'draft', name: '待授权人物', authorized: false }] }), {
    state: 'authorization_required', presenterCount: 1, presenterId: 'draft', presenterName: '待授权人物',
  });
  assert.deepEqual(managedReplicationPresenterReadiness({ defaultPresenterId: 'uncertified', presenters: [{ ...placeholder, name: '已添加口播人物' }] }), {
    state: 'production_setup_required', presenterCount: 1, presenterId: 'uncertified', presenterName: '已添加口播人物',
  });
  assert.deepEqual(managedReplicationPresenterReadiness({ defaultPresenterId: 'active', presenters: [{ ...active, name: '企业主讲人' }] }), {
    state: 'ready', presenterCount: 1, presenterId: 'active', presenterName: '企业主讲人',
  });
});
