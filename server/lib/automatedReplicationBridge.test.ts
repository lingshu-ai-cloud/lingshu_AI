import assert from 'node:assert/strict';
import { Router } from 'express';
import { advanceAutomatedReplication, invokeReplicationRoute } from './automatedReplicationBridge.js';
import { shotFingerprint } from '../../src/lib/shotProduction.js';

const shot = { source: 'material', sound: 'voiceover', layout: 'full', presenterId: '', productId: '', productMaterialId: '', backgroundMaterialId: '', backgroundMode: 'independent', transparent: false, narration: 'Enterprise script', locked: false, factsConfirmed: false, candidates: [], adoptedId: '', revision: 1 };
function fixture() {
  let project: any = { id: 'project', tenant_id: 'tenant', status: 'draft', spec: { activeAssemblyId: 'video-1', automatedReplicationShots: [{ shotId: 'shot', slotId: 'slot', kind: 'nonperson', start: 0, end: 2, firstFrameRequest: { shotDescription: 'Closeup target product', sourceFirstFrameUrl: '/source.jpg' } }], shotProductions: { 'video-1:shot': shot } } };
  const store: any = { getById: async (_: string, id: string) => id === 'project' ? structuredClone(project) : null, update: async (_: string, _id: string, patch: any) => { project = { ...project, ...structuredClone(patch) }; return true; },
    compareAndSwap: async (_: string, id: string, expected: any, patch: any) => {
      if (id !== project.id) return false;
      for (const [key, value] of Object.entries(expected)) {
        try { assert.deepEqual(project[key], value); } catch { return false; }
      }
      project = { ...project, ...structuredClone(patch) }; return true;
    } };
  return { store, project: () => project };
}
const router = Router();
router.post('/native/:id', async (req, res) => { assert.equal(res.locals.tenantId, 'tenant'); res.status(202).json({ id: req.params.id, value: req.body.value }); });
assert.deepEqual(await invokeReplicationRoute(router, 'tenant', 'post', '/native/one', { value: 2 }), { status: 202, body: { id: 'one', value: 2 } });
const f = fixture(); let calls: string[] = []; const callBodies: any[] = []; let validations = 0;
const deps: any = { validateAdoption: async () => [], materials: () => [{ id: 'video', tenantId: 'tenant', scope: 'own', type: 'video' }], validateVideo: async () => { validations++; }, call: async (_: string, _method: string, route: string, body: any) => { calls.push(route); callBodies.push(body); assert.equal(body.shotId || 'slot', 'slot'); if (route === '/storyboard-first-frame') return { status: 200, body: { ok: true, fingerprint: 'frame-fp', material: { id: 'frame' } } }; if (route === '/seedance-video') { assert.equal(body.duration, 4); assert.equal(body.firstFrameMaterialId, 'frame'); return { status: 200, body: { ok: true, material: { id: 'video' } } }; } return { status: 200, body: { quality: { passed: true } } }; } };
for (let index = 0; index < 4; index++) { const result = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', maxCostCny: 12.5, store: f.store }, deps); assert.equal(result.state, 'pending'); }
assert.match(String(f.project().updated_at || ''), /^\d{4}-\d{2}-\d{2}T/, 'bridge production writes advance the Studio revision');
assert.deepEqual(calls, ['/storyboard-first-frame', '/seedance-video', '/storyboard-quality-check']);
assert.equal(callBodies[0].maxCostCny, 12.5); assert.equal(callBodies[1].maxCostCny, 12.5, 'both paid native steps receive the frozen project cap');
assert.equal(f.project().spec.storyboardAssignments.slot, 'video');
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: f.store }, deps)).state, 'ready');
assert.equal(validations, 4); assert.equal(calls.length, 3);
assert.equal((await advanceAutomatedReplication({ tenantId: 'other', projectId: 'project', store: f.store }, deps)).state, 'blocked');
const rejected = fixture();
const failure = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: rejected.store }, { ...deps, call: async () => ({ status: 429, body: { error: 'Budget exhausted' } }) });
assert.equal(failure.state, 'blocked'); assert.equal(failure.blocker, 'Budget exhausted'); assert.equal(rejected.project().spec.storyboardAssignments, undefined);
const catalog = fixture(); catalog.project().spec.storyboardAssignments = { slot: 'video' };
const invalid = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: catalog.store }, { ...deps, validateVideo: async () => { throw new Error('Catalog image is not video'); } });
assert.equal(invalid.state, 'blocked'); assert.match(invalid.blocker!, /Catalog/);
console.log('automatedReplicationBridge behavior passed');
const matched = fixture(); matched.project().spec.automatedReplicationShots[0].firstFrameRequest.shotDescription = '滴管向瓶中灌装液体';
let matchedCalls = 0;
const matchedDeps: any = { ...deps, call: async () => { matchedCalls++; throw new Error('Matching must avoid paid generation'); }, materials: () => [{ id: 'filling-video', tenantId: 'tenant', scope: 'own', type: 'video', sourceType: 'upload', file: 'filling.mp4', duration: 10, segments: [{ start: 3, end: 6, action: '滴管向瓶中灌装液体', subject: ['瓶', '液体', '滴管'] }] }] };
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: matched.store }, matchedDeps)).state, 'pending');
assert.equal(matchedCalls, 0); assert.equal(matched.project().spec.storyboardAssignments.slot, 'filling-video');
assert.equal(matched.project().spec.clipEdits.slot.trimStart, 3); assert.equal(matched.project().spec.clipEdits.slot.trimEnd, 5);
assert.ok(matched.project().spec.automatedReplicationProgress.shot.matching.evidence);

const replaced = fixture();
let videoHash = 'a'.repeat(64);
const boundDeps: any = { ...deps, validateVideo: async () => videoHash };
for (let tick = 0; tick < 3; tick++) assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: replaced.store }, boundDeps)).state, 'pending');
assert.equal(replaced.project().spec.automatedReplicationProgress.shot.videoContentSha256, videoHash);
videoHash = 'b'.repeat(64);
const replacedBeforeAdopt = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: replaced.store }, boundDeps);
assert.equal(replacedBeforeAdopt.state, 'blocked'); assert.match(replacedBeforeAdopt.blocker!, /替换/);
videoHash = 'a'.repeat(64);
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: replaced.store }, boundDeps)).state, 'pending');
videoHash = 'c'.repeat(64);
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: replaced.store }, boundDeps)).state, 'blocked');

const partial = fixture();
partial.project().spec.automatedReplicationShots.unshift({ shotId: 'blocked-shot', slotId: 'blocked-slot', kind: 'blocked', required: true,
  productionState: 'blocked', start: 0, end: 1, blockerCode: 'material_type_unconfirmed', blocker: '第 1 镜缺少已确认的镜头类型' });
let partialCalls = 0;
const partialDeps: any = { ...deps, call: async (...args: any[]) => { partialCalls++; return deps.call(...args); } };
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', maxCostCny: 12.5, store: partial.store }, partialDeps)).state, 'pending');
assert.equal(partialCalls, 1, 'a blocked required shot does not prevent the next executable shot from entering production');
for (let tick = 0; tick < 3; tick++) await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', maxCostCny: 12.5, store: partial.store }, partialDeps);
const partialTerminal = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', maxCostCny: 12.5, store: partial.store }, partialDeps);
assert.equal(partialTerminal.state, 'blocked');
assert.match(partialTerminal.blocker!, /第 1 镜/);
assert.equal(partial.project().spec.storyboardAssignments.slot, 'video');

const queued = fixture();
queued.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp' } };
const queuedResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: queued.store }, {
  ...deps, call: async () => ({ status: 202, body: { ok: false, code: 'STORYBOARD_VIDEO_IN_PROGRESS',
    providerTaskId: 'supplier-original', providerAcceptedAt: '2026-10-11T00:00:00Z', providerModel: 'model' } }),
});
assert.equal(queuedResult.state, 'pending', 'an existing native request is pending, not a production failure');
assert.equal(queued.project().spec.automatedReplicationProgress.shot.providerTaskId, 'supplier-original');
assert.equal(queued.project().spec.automatedReplicationProgress.shot.videoMaterialId, undefined);

const persistedReceipt = fixture();
persistedReceipt.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp' } };
await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: persistedReceipt.store }, {
  ...deps, call: async () => {
    persistedReceipt.project().spec.automatedReplicationProgress.shot.providerTaskId = 'receipt-during-call';
    return { status: 200, body: { ok: true, material: { id: 'video' } } };
  },
});
assert.equal(persistedReceipt.project().spec.automatedReplicationProgress.shot.providerTaskId, 'receipt-during-call',
  'saving a finished asset must not erase the receipt projected during supplier polling');

function withSibling() {
  const f = fixture();
  f.project().spec.automatedReplicationShots.push({ ...structuredClone(f.project().spec.automatedReplicationShots[0]), shotId: 'sibling', slotId: 'slot-2' });
  f.project().spec.shotProductions['video-1:sibling'] = structuredClone(shot);
  return f;
}
const runtimeBlocked = withSibling();
const runtimeCalls: string[] = [];
const runtimeResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: runtimeBlocked.store }, {
  ...deps, call: async (_surface, _method, route, body) => {
    runtimeCalls.push(String(body?.shotId));
    return body?.shotId === 'slot'
      ? { status: 409, body: { code: 'STORYBOARD_BUDGET_PLAN_UNAVAILABLE', error: '镜头预算不足' } }
      : { status: 200, body: { ok: true, fingerprint: 'sibling-frame', material: { id: 'frame-2' } } };
  },
});
assert.equal(runtimeResult.state, 'pending');
assert.deepEqual(runtimeCalls, ['slot', 'slot-2'], 'a proven pre-admission rejection does not block the next independent shot');
assert.equal(runtimeBlocked.project().spec.automatedReplicationProgress.shot.blocker, '镜头预算不足');
assert.equal(runtimeBlocked.project().spec.automatedReplicationProgress.sibling.firstFrameMaterialId, 'frame-2');
await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: runtimeBlocked.store }, deps);
assert.equal(runtimeBlocked.project().spec.automatedReplicationProgress.shot.blocker, '', 'successful recovery clears only the recovered shot error');

const uncertainSubmission = withSibling(); let submissionAttempts = 0;
const uncertainResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: uncertainSubmission.store }, {
  ...deps, call: async () => { submissionAttempts++; return { status: 502, body: { error: 'provider polling timed out' } }; },
});
assert.equal(uncertainResult.state, 'blocked');
assert.equal(submissionAttempts, 1, 'an uncertain paid attempt stops this tick and never starts another paid step');

const changedInput = withSibling();
changedInput.project().spec.automatedReplicationProgress = { shot: { fingerprint: 'old-input', providerTaskId: 'kept-original' } };
let independentAttempts = 0;
const changedResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: changedInput.store }, {
  ...deps, call: async (_surface, _method, _route, body) => {
    independentAttempts++; assert.equal(body?.shotId, 'slot-2');
    return { status: 200, body: { ok: true, fingerprint: 'new-frame', material: { id: 'frame-2' } } };
  },
});
assert.equal(changedResult.state, 'pending');
assert.equal(independentAttempts, 1);
assert.equal(changedInput.project().spec.automatedReplicationProgress.shot.providerTaskId, 'kept-original');

for (const qualityState of ['service_unavailable', 'invalid_response']) {
  const retainedFrame = fixture();
  retainedFrame.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp' } };
  const recheckCalls: Array<{ route: string; body: any }> = [];
  const result = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: retainedFrame.store }, {
    ...deps,
    materials: () => [{ id: 'frame', tenantId: 'tenant', provenance: { firstFrameQualityState: qualityState } }],
    call: async (_surface, method, route, body) => {
      recheckCalls.push({ route, body });
      assert.equal(method, 'post');
      return { status: 200, body: { ok: true, materialId: 'frame', fingerprint: 'frame-fp', reusedOriginalImage: true } };
    },
  });
  assert.equal(result.state, 'pending');
  assert.equal(result.changed, true);
  assert.deepEqual(recheckCalls, [{
    route: '/storyboard-first-frame/frame/recheck-quality',
    body: { fingerprint: 'frame-fp', shotId: 'slot' },
  }]);
  assert.equal(retainedFrame.project().spec.automatedReplicationProgress.shot.firstFrameMaterialId, 'frame');
  assert.ok(retainedFrame.project().spec.automatedReplicationProgress.shot.firstFrameQaRecheckedAt);
}
const unavailableRecheck = fixture();
unavailableRecheck.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp' } };
const unavailableRecheckResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: unavailableRecheck.store }, {
  ...deps,
  materials: () => [{ id: 'frame', tenantId: 'tenant', provenance: { firstFrameQualityState: 'service_unavailable' } }],
  call: async (_surface, _method, route) => {
    assert.equal(route, '/storyboard-first-frame/frame/recheck-quality', 'an unavailable QA service must recheck the retained frame instead of regenerating it');
    return { status: 503, body: { code: 'FIRST_FRAME_QA_SERVICE_UNAVAILABLE', error: '视觉质检服务暂不可用' } };
  },
});
assert.equal(unavailableRecheckResult.state, 'blocked');
assert.equal(unavailableRecheckResult.blockerCode, 'FIRST_FRAME_QA_SERVICE_UNAVAILABLE');
assert.equal(unavailableRecheck.project().spec.automatedReplicationProgress.shot.firstFrameMaterialId, 'frame');
const rejectedRecheck = fixture();
rejectedRecheck.project().spec.contentOrder = { operatingContext: { productionBudgetMode: 'protected', maxAigcRetries: 1 } };
rejectedRecheck.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp' } };
const rejectedRecheckResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: rejectedRecheck.store }, {
  ...deps,
  materials: () => [{ id: 'frame', tenantId: 'tenant', provenance: { firstFrameQualityState: 'service_unavailable' } }],
  call: async (_surface, _method, route) => {
    assert.equal(route, '/storyboard-first-frame/frame/recheck-quality');
    return { status: 422, body: { code: 'FIRST_FRAME_QA_FAILED', error: '首帧真实视觉质检未通过' } };
  },
});
assert.equal(rejectedRecheckResult.state, 'pending', 'a completed QA rejection must reach the bounded regeneration branch instead of blocking the project');
assert.equal(rejectedRecheck.project().spec.automatedReplicationProgress.shot.firstFrameMaterialId, 'frame');
assert.ok(rejectedRecheck.project().spec.automatedReplicationProgress.shot.firstFrameQaRecheckedAt);
const protectedFrameRetry = fixture();
protectedFrameRetry.project().spec.contentOrder = { operatingContext: { productionBudgetMode: 'protected', maxAigcRetries: 1 } };
protectedFrameRetry.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp' } };
const protectedFrameRetryResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: protectedFrameRetry.store }, {
  ...deps,
  materials: () => [{ id: 'frame', tenantId: 'tenant', provenance: { firstFrameQualityState: 'evaluated', firstFrameQuality: { passed: false, reasonCodes: ['PRODUCT_MISMATCH'] } } }],
  call: async () => { throw new Error('a rejected retained frame must be checkpointed before a bounded regeneration'); },
});
assert.equal(protectedFrameRetryResult.state, 'pending');
assert.equal(protectedFrameRetry.project().spec.automatedReplicationProgress.shot.firstFrameMaterialId, '');
assert.equal(protectedFrameRetry.project().spec.automatedReplicationProgress.shot.firstFrameRetryCount, 1);
assert.equal(protectedFrameRetry.project().spec.automatedReplicationProgress.shot.firstFrameHistory[0].materialId, 'frame');
assert.equal(protectedFrameRetry.project().spec.automatedReplicationShots[0].firstFrameRequest.generationRevision, 'quality-retry-1');
assert.deepEqual(protectedFrameRetry.project().spec.automatedReplicationShots[0].firstFrameRequest.qualityRepairReasonCodes, ['PRODUCT_MISMATCH']);
const directedFrameRepair = fixture();
directedFrameRepair.project().spec.contentOrder = { operatingContext: { productionBudgetMode: 'protected', maxAigcRetries: 1, budgetApprovedAt: '2026-10-13T00:00:00.000Z' } };
directedFrameRepair.project().spec.automatedReplicationProgress = { shot: {
  firstFrameMaterialId: 'second-frame', firstFrameFingerprint: 'second-fp', firstFrameRetryCount: 1,
  firstFrameHistory: [{ materialId: 'first-frame', reasonCodes: ['PRODUCT_IDENTITY_FAILED'], rejectedAt: '2026-10-13T00:00:00.000Z' }],
} };
const directedFrameRepairResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: directedFrameRepair.store }, {
  ...deps,
  materials: () => [{ id: 'second-frame', tenantId: 'tenant', provenance: { firstFrameQualityState: 'evaluated', firstFrameQuality: { passed: false, reasonCodes: ['LAYOUT_FAILED'] } } }],
  call: async () => { throw new Error('directed repair must checkpoint before another provider call'); },
});
assert.equal(directedFrameRepairResult.state, 'pending');
assert.equal(directedFrameRepair.project().spec.automatedReplicationProgress.shot.firstFrameRetryCount, 2);
assert.equal(directedFrameRepair.project().spec.automatedReplicationShots[0].firstFrameRequest.generationRevision, 'quality-directed-repair-2');
assert.deepEqual(directedFrameRepair.project().spec.automatedReplicationShots[0].firstFrameRequest.qualityRepairReasonCodes,
  ['PRODUCT_IDENTITY_FAILED', 'LAYOUT_FAILED']);
const protectedVideoRetry = fixture();
protectedVideoRetry.project().spec.contentOrder = { operatingContext: { productionBudgetMode: 'protected', maxAigcRetries: 1 } };
protectedVideoRetry.project().spec.automatedReplicationProgress = { shot: {
  firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp', videoMaterialId: 'video', providerTaskId: 'original-provider-task',
} };
const protectedVideoRetryResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: protectedVideoRetry.store }, {
  ...deps,
  materials: () => [{ id: 'video', tenantId: 'tenant', scope: 'own', type: 'video' }],
  validateVideo: async () => 'a'.repeat(64),
  call: async (_surface, _method, route) => {
    assert.equal(route, '/storyboard-quality-check');
    return { status: 200, body: { quality: { passed: false, reasonCodes: ['ACTION_ORDER'] } } };
  },
});
assert.equal(protectedVideoRetryResult.state, 'pending');
assert.equal(protectedVideoRetry.project().spec.automatedReplicationProgress.shot.videoMaterialId, '');
assert.equal(protectedVideoRetry.project().spec.automatedReplicationProgress.shot.videoRetryCount, 1);
assert.equal(protectedVideoRetry.project().spec.automatedReplicationProgress.shot.videoGenerationRevision, 'quality-retry-1');
assert.equal(protectedVideoRetry.project().spec.automatedReplicationProgress.shot.videoHistory[0].materialId, 'video');
const protectedProviderRetry = fixture();
protectedProviderRetry.project().spec.contentOrder = { operatingContext: { productionBudgetMode: 'protected', maxAigcRetries: 1 } };
protectedProviderRetry.project().spec.automatedReplicationProgress = { shot: {
  firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp', providerTaskId: 'failed-provider-task',
} };
const protectedProviderRetryResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: protectedProviderRetry.store }, {
  ...deps,
  call: async (_surface, _method, route) => {
    assert.equal(route, '/seedance-video');
    return { status: 409, body: { code: 'STORYBOARD_VIDEO_PROVIDER_FAILED', error: '供应商任务已失败', providerTaskId: 'failed-provider-task', providerStatus: 'failed' } };
  },
});
assert.equal(protectedProviderRetryResult.state, 'pending');
assert.equal(protectedProviderRetry.project().spec.automatedReplicationProgress.shot.videoRetryCount, 1);
assert.equal(protectedProviderRetry.project().spec.automatedReplicationProgress.shot.videoGenerationRevision, 'provider-retry-1');
assert.equal(protectedProviderRetry.project().spec.automatedReplicationProgress.shot.videoHistory[0].providerTaskId, 'failed-provider-task');
const rejectedFrame = fixture();
rejectedFrame.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'frame' } };
const rejectedFrameResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: rejectedFrame.store }, {
  ...deps,
  materials: () => [{ id: 'frame', tenantId: 'tenant', provenance: { firstFrameQualityState: 'evaluated', firstFrameQuality: { passed: false, reasonCodes: ['PRODUCT_MISMATCH'] } } }],
  call: async () => { throw new Error('Rejected frame must never reach video generation'); },
});
assert.equal(rejectedFrameResult.blockerCode, 'FIRST_FRAME_QA_FAILED');

const controlledFallback = fixture();
controlledFallback.project().spec.contentOrder = { operatingContext: { productionBudgetMode: 'protected', maxAigcRetries: 0, budgetApprovedAt: '2026-10-13T00:00:00.000Z' } };
controlledFallback.project().spec.storyboardSourcePlans = { slot: { mode: 'ai', fallbackMode: 'enterprise_product_display' } };
controlledFallback.project().spec.automatedReplicationShots[0].firstFrameRequest = {
  mode: 'free_creation', sceneType: 'product', fallbackMode: 'enterprise_product_display',
  productIds: ['product-1'], shotDescription: 'Use the authorized enterprise product image for a static product detail shot',
};
const controlledShotSpec: any = { version: 'storyboard-shot-spec-v2', shotId: 'slot', mode: 'free_creation', scene: 'product',
  description: 'Static product detail', startSeconds: 0, endSeconds: 2, targetDurationSeconds: 2,
  assets: [{ role: 'product', source: 'knowledge_base', id: 'product-1', version: 'source-version' }],
  layout: { ratio: '9:16', subject: 'product', productPosition: '', environment: '', contactSurface: '',
    handOrPersonPosition: '', cameraAngle: '', preserveSourceComposition: false },
  action: { startState: '', beats: [], endState: '', cameraMotion: 'slow push', forbiddenChanges: [], evidence: 'confirmed_storyboard', multiStep: false },
  constraints: ['product_identity'],
};
controlledFallback.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'failed-frame', firstFrameRetryCount: 0 } };
let controlledCalls = 0;
const controlledResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: controlledFallback.store }, {
  ...deps,
  materials: () => [{ id: 'failed-frame', tenantId: 'tenant', provenance: { firstFrameQualityState: 'evaluated',
    firstFrameQuality: { passed: false, reasonCodes: ['PRODUCT_IDENTITY_FAILED'] }, shotSpec: controlledShotSpec, projectShotFingerprint: 'project-shot-fp' } },
  { id: 'enterprise-product', tenantId: 'tenant', scope: 'own', type: 'image', sourceType: 'enterprise_product_table',
    productId: 'product-1', commercialUseApproved: true, rightsStatus: 'authorized' }],
  call: async () => { controlledCalls++; throw new Error('terminal identity fallback must not call a supplier'); },
  createControlledProductAnimation: async input => {
    assert.equal(input.productImage.id, 'enterprise-product');
    assert.equal(input.shotId, 'slot');
    return { reused: false,
      frame: { id: 'controlled-frame', provenance: { fingerprint: 'controlled-fp' } } as any,
      video: { id: 'controlled-video' } as any };
  },
});
assert.equal(controlledResult.state, 'pending');
assert.equal(controlledCalls, 0);
assert.equal(controlledFallback.project().spec.automatedReplicationProgress.shot.firstFrameMaterialId, 'controlled-frame');
assert.equal(controlledFallback.project().spec.automatedReplicationProgress.shot.videoMaterialId, 'controlled-video');
assert.equal(controlledFallback.project().spec.automatedReplicationProgress.shot.controlledProductFallback, true);

const fallbackFrame = fixture();
fallbackFrame.project().spec.storyboardSourcePlans = { slot: { mode: 'ai', fallbackMode: 'enterprise_product_display' } };
fallbackFrame.project().spec.automatedReplicationProgress = { shot: { firstFrameMaterialId: 'frame', firstFrameFingerprint: 'frame-fp' } };
fallbackFrame.project().spec.automatedReplicationShots[0].firstFrameRequest = {
  mode: 'free_creation', fallbackMode: 'enterprise_product_display', shotDescription: 'Enterprise product display' };
let fallbackVideoCalled = false;
const fallbackFrameResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: fallbackFrame.store }, {
  ...deps,
  materials: () => [{ id: 'frame', tenantId: 'tenant', provenance: { mode: 'free_creation', firstFrameQualityState: 'evaluated',
    shotSpec: { mode: 'free_creation', constraints: ['product_identity'] },
    firstFrameQuality: { passed: false, automatedPassed: true, findings: [], reasonCodes: [], checks: {}, phase: 'first_frame',
      sceneType: 'product', status: 'needs_review', requiresHumanReview: true, evidenceFrameLabels: ['候选首帧'],
      reportId: 'report', version: 'storyboard-aigc-qa-v1', checkedAt: '2026-10-13T00:00:00.000Z' } } }],
  call: async (_surface, _method, route) => {
    assert.equal(route, '/seedance-video'); fallbackVideoCalled = true;
    return { status: 202, body: { code: 'STORYBOARD_VIDEO_IN_PROGRESS', providerTaskId: 'supplier',
      providerAcceptedAt: '2026-10-13T00:00:00.000Z', providerModel: 'seedance' } };
  },
});
assert.equal(fallbackFrameResult.state, 'pending');
assert.equal(fallbackVideoCalled, true, 'verified managed fallback reuses the already paid all-pass first frame');

const fallbackVideo = fixture();
fallbackVideo.project().spec.storyboardSourcePlans = { slot: { mode: 'ai', fallbackMode: 'enterprise_product_display' } };
fallbackVideo.project().spec.automatedReplicationProgress = { shot: {
  fingerprint: shotFingerprint(fallbackVideo.project().spec.shotProductions['video-1:shot'], '', 'shot'),
  firstFrameMaterialId: 'fallback-frame',
  videoMaterialId: 'fallback-video',
} };
const fallbackVideoReport = {
  reportId: 'video-report', version: 'storyboard-aigc-qa-v1', phase: 'video', sceneType: 'product',
  status: 'needs_review', automatedPassed: true, passed: false, requiresHumanReview: true,
  reasonCodes: [], findings: [], evidenceFrameLabels: ['0s', '3.5s'], checkedAt: '2026-10-13T00:00:00.000Z',
  checks: {
    product_identity: { key: 'product_identity', verdict: 'pass', evidenceFrames: ['0s', '3.5s'], note: 'pass' },
    layout_continuity: { key: 'layout_continuity', verdict: 'pass', evidenceFrames: ['0s', '3.5s'], note: 'pass' },
    visual_integrity: { key: 'visual_integrity', verdict: 'pass', evidenceFrames: ['0s', '3.5s'], note: 'pass' },
  },
};
const fallbackVideoResult = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: fallbackVideo.store }, {
  ...deps,
  materials: () => [{ id: 'fallback-video', tenantId: 'tenant', scope: 'own', type: 'video',
    provenance: { shotSpec: { mode: 'free_creation', constraints: ['product_identity'] }, storyboardQualityReport: fallbackVideoReport } }],
  call: async () => { throw new Error('a persisted all-pass video report must not be analyzed twice'); },
});
assert.equal(fallbackVideoResult.state, 'pending', JSON.stringify(fallbackVideoResult));
assert.equal(fallbackVideo.project().spec.automatedReplicationProgress.shot.qualityChecked, true,
  'managed fallback accepts an all-pass video report without requesting a human click');
