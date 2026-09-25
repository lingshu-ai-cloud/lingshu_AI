import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore } from '../storage/datastore.js';
import { HeyGenClient } from '../lib/heygen.js';
import { candidateOutputFromImport, createProductionRouter } from './production.js';
import { newShotProduction, shotFingerprint } from '../../src/lib/shotProduction.js';
import { createProjectRevisionGuard, projectRevisionMatches } from '../lib/projectRevision.js';
import { DefinitiveSupplierSubmissionError, type DigitalHumanExecutionAdapter } from '../lib/digitalHumanProviderRegistry.js';

test('draft revisions serialize competing saves and reject stale snapshots', async () => {
  const guard = createProjectRevisionGuard(); let revision = 'v1';
  const save = () => guard('tenant:draft', async () => { if (!projectRevisionMatches('v1', revision, true)) return false; await Promise.resolve(); revision = 'v2'; return true; });
  assert.deepEqual(await Promise.all([save(), save()]), [true, false]);
  assert.equal(projectRevisionMatches(undefined, 'v2', true), false);
  assert.equal(projectRevisionMatches(undefined, 'v2', false), true);
  assert.equal(await guard('tenant:draft', async () => projectRevisionMatches('v2', revision, true)), true);
});

test('candidate evidence accepts versioned objects or tenant-local files only with a content hash', () => {
  const sha = 'A'.repeat(64);
  assert.deepEqual(candidateOutputFromImport({ materialId: 'object', objectKey: 'materials/tenants/a/video.mp4', objectEtag: 'v1', contentSha256: sha }),
    { materialId: 'object', objectKey: 'materials/tenants/a/video.mp4', objectEtag: 'v1', contentSha256: sha.toLowerCase() });
  assert.deepEqual(candidateOutputFromImport({ materialId: 'local', localFile: 'tenants/a/video.mp4', contentSha256: sha }),
    { materialId: 'local', localFile: 'tenants/a/video.mp4', contentSha256: sha.toLowerCase() });
  assert.equal(candidateOutputFromImport({ materialId: 'missing-version', objectKey: 'video.mp4', contentSha256: sha }), undefined);
  assert.equal(candidateOutputFromImport({ materialId: 'bad-hash', localFile: 'video.mp4', contentSha256: 'not-a-hash' }), undefined);
});

test('Qwen first-frame draft route persists its receipt, reuses the same request and isolates tenants', async () => {
  const rows = new Map<string, any>(); let seq = 0;
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>(collection: string, value: Record<string, unknown>) { const row = { ...structuredClone(value), id: `draft-${++seq}` }; rows.set(`${collection}/${row.id}`, row); return structuredClone(row) as T; },
    async update(collection, id, patch) { const key = `${collection}/${id}`; if (!rows.has(key)) return false; rows.set(key, { ...rows.get(key), ...structuredClone(patch) }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query = {}) { const where = (query as { where?: Record<string, unknown> }).where || {}; const items = [...rows.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected)).map(([, value]) => structuredClone(value) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
  const context = 'draft-context';
  const shot = { ...newShotProduction('目标口播', 'person-1'), source: 'avatar' as const, digitalHuman: {
    workflow: 'viral_replication' as const, method: 'reenact' as const, replicationMode: 'sentence_first_frame' as const, contentConfirmed: true,
    action: '复用动作意图', scene: '重建画面', preserve: '构图', reference: { videoUrl: '/source.mp4', start: 0, end: 2, originalText: '原片', derivativeAuthorized: false,
      cues: [{ id: 'cue-1', start: 0, end: 2, originalText: '原片', targetText: '目标', shotIds: ['s1'], personShot: true, sourceFirstFrame: { time: 0, materialId: 'frame-1' } }] },
  } };
  rows.set('studio_projects/project-1', { id: 'project-1', tenant_id: 'tenant-a', status: 'draft', spec: { shotProductionContext: context, shotProductions: { 'assembly-1:shot-1': shot } } });
  rows.set('studio_production_defaults/defaults-1', { id: 'defaults-1', tenant_id: 'tenant-a', payload: { presenters: [{ id: 'person-1', name: 'Person', authorized: true }] } });
  let generationCalls = 0;
  const result = { cues: shot.digitalHuman.reference.cues, operationIds: ['op-1'], estimatedCostCny: .22, provider: 'qwen' as const, state: 'completed' as const };
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'tenant-a'; next(); });
  app.use(createProductionRouter(store, async () => 'unused', { generateSentenceFirstFrameDrafts: async () => { generationCalls++; return result; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (tenant: string) => fetch(`${url}/sentence-first-frame-drafts`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant }, body: JSON.stringify({ projectId: 'project-1', assemblyId: 'assembly-1', shotId: 'shot-1', fingerprint: shotFingerprint(shot, context, 'shot-1'), requestId: 'qwen-draft-request-1', confirmed: true }) });
  try {
    assert.equal((await request('tenant-a')).status, 200);
    assert.equal((await request('tenant-a')).status, 200);
    assert.equal(generationCalls, 1);
    assert.equal((await request('tenant-b')).status, 400);
    const receipts = await store.list<any>('studio_first_frame_draft_jobs', { where: { tenant_id: 'tenant-a', request_id: 'qwen-draft-request-1' } });
    assert.equal(receipts.items.length, 1); assert.equal(receipts.items[0].payload.state, 'completed'); assert.deepEqual(receipts.items[0].payload.result.operationIds, ['op-1']);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('production router persists jobs, never resubmits uncertain operations, isolates tenants, and never overwrites a draft', async () => {
  const rows = new Map<string, any>(); let seq = 0; let failWrites = false;
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>(collection: string, value: Record<string, unknown>) { if (failWrites) return null; const row = { ...value, id: `r${++seq}` }; rows.set(`${collection}/${row.id}`, structuredClone(row)); return row as T; },
    async update(collection, id, patch) { if (failWrites || !rows.has(`${collection}/${id}`)) return false; rows.set(`${collection}/${id}`, { ...rows.get(`${collection}/${id}`), ...structuredClone(patch) }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query = {}) { const where = (query as { where?: Record<string, unknown> }).where || {}; const items = [...rows.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected)).map(([, value]) => structuredClone(value) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
  const calls: { url: string; body: any; key: string }[] = []; let loseResponse = false;
  const client = new HeyGenClient('unit-test-key', (async (url: string, init: RequestInit) => {
    calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, key: (init.headers as Record<string, string>)['Idempotency-Key'] });
    if (loseResponse) { loseResponse = false; throw new Error('network response lost'); }
    if (url.endsWith('/assets')) return new Response(JSON.stringify({ data: { asset_id: 'audio1' } }));
    return new Response(JSON.stringify({ data: init.method === 'POST' ? { video_id: 'remote1' } : { status: 'completed', video_url: 'https://files.heygen.ai/video/test.mp4', duration: 3 } }));
  }) as typeof fetch);
  const context = 'ctx'; const shot = { ...newShotProduction('hello', 'alice'), source: 'avatar' as const, sound: 'source' as const };
  const project = { id: 'draft', tenant_id: 'A', status: 'draft', spec: { ratio: '9:16', shootingSlots: [{ id: 'shot1', slotId: 'slot-1', duration: 3 }], shotProductions: { 'video-1:shot1': shot }, shotProductionContext: context, storyboardAssignments: { 'slot-1': 'keep-existing' } } };
  rows.set('studio_projects/draft', project);
  rows.set('studio_production_defaults/defaults', { id: 'defaults', tenant_id: 'A', payload: { preference: 'avatar', defaultPresenterId: 'alice', presenters: [{ id: 'alice', name: 'Alice', avatarId: 'avatar1', voiceId: 'voice1', authorized: true }] } });
  let imports = 0; let budgetDenied = false; let importRejected = true; let importEvidenceMissing = false; let candidateCurrent = true; const audioRefs: Array<{ start: number; duration: number }> = [];
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'A'; next(); });
  app.use(createProductionRouter(store, async () => { if (importRejected) throw new Error('数字人文件缺少音轨'); imports++; if (importEvidenceMissing) return 'new-material'; return { materialId: 'new-material', objectKey: 'materials/A/new-material.mp4', contentSha256: 'c'.repeat(64), objectEtag: 'candidate-v3' }; }, { client, enabled: () => true, reserve: async () => { if (budgetDenied) throw new Error('预算余额不足'); }, verifyCandidateOutput: async (evidence, tenantId) => { assert.equal(tenantId, 'A'); assert.equal(evidence.objectEtag, 'candidate-v3'); return candidateCurrent; }, toolUnavailableReasons: { runway_act_two: 'Runway Act-Two 尚不可执行，缺少：对象存储、逐镜预算' }, prepareAudio: async ref => { audioRefs.push(ref); return { bytes: new Uint8Array([1, 2, 3]), segmentId: 'segment-test', checksumSha256: 'a'.repeat(64), start: ref.start, duration: ref.duration }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown, tenant = 'A') => fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const input = { projectId: 'draft', assemblyId: 'video-1', shotId: 'shot1', fingerprint: shotFingerprint(shot, context), ratio: '9:16', requestId: 'req1', confirmed: true };
  try {
    const capabilities = await (await request('/capabilities')).json();
    assert.equal(capabilities.tools.find((item: any) => item.id === 'heygen').execution, capabilities.configured);
    assert.equal(capabilities.tools.find((item: any) => item.id === 'runway_seedance').execution, false);
    assert.match(capabilities.tools.find((item: any) => item.id === 'runway_seedance').reason, /通用 Seedance/);
    assert.match(capabilities.tools.find((item: any) => item.id === 'runway_act_two').reason, /对象存储、逐镜预算/);
    const referenceOnlyDefaults = await request('/defaults', { preference: 'auto', defaultPresenterId: 'reference-person', presenters: [{ id: 'reference-person', name: 'Reference Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, referenceMaterialIds: ['photo-1', 'video-1', 'photo-1'] }] });
    assert.equal(referenceOnlyDefaults.status, 200);
    const referenceOnlyAsset = (await referenceOnlyDefaults.json()).presenters[0];
    assert.deepEqual(referenceOnlyAsset.referenceMaterialIds, ['photo-1', 'video-1']);
    assert.deepEqual(referenceOnlyAsset.capabilities, ['reference_image', 'reference_video', 'person_replacement']);
    assert.deepEqual(referenceOnlyAsset.toolMappings.runway.referenceMaterialIds, ['photo-1', 'video-1']);
    const renamedReference = await (await request('/defaults', { preference: 'auto', defaultPresenterId: 'reference-person', presenters: [{ ...referenceOnlyAsset, name: 'Reference Person Renamed' }] })).json();
    assert.equal(renamedReference.presenters[0].assetVersion, 1, 'display name does not invalidate generated media');
    const changedReference = await (await request('/defaults', { preference: 'auto', defaultPresenterId: 'reference-person', presenters: [{ ...renamedReference.presenters[0], referenceMaterialIds: ['photo-1', 'video-2'] }] })).json();
    assert.equal(changedReference.presenters[0].assetVersion, 2, 'generation input changes create a new presenter asset version');
    const talkingDefaults = await request('/defaults', { preference: 'avatar', defaultPresenterId: 'alice', defaultSound: 'source', defaultLayout: 'split', presenters: [{ id: 'alice', name: 'Alice', avatarId: 'avatar1', voiceId: 'voice1', authorized: true, supportsAlpha: false, nativeOrientation: 'unknown' }] });
    assert.equal(talkingDefaults.status, 200);
    const talkingDefaultsValue = await talkingDefaults.json();
    assert.deepEqual(talkingDefaultsValue.presenters[0].capabilities, ['talking']);
    assert.equal(talkingDefaultsValue.defaultSound, 'source'); assert.equal(talkingDefaultsValue.defaultLayout, 'split');
    const savedPlan = await (await request('/plans', { projectId: 'draft', assemblyId: 'video-1', shotId: 'shot1', fingerprint: shotFingerprint(shot, context) })).json();
    assert.equal(savedPlan.state, 'ready'); assert.deepEqual(savedPlan.candidateTools, ['heygen']); assert.equal(savedPlan.presenterAssetVersion, 1);
    assert.equal(savedPlan.routeSteps.find((step: any) => step.id === 'generation').status, 'ready');
    assert.equal(savedPlan.inputSnapshot.narration, 'hello'); assert.deepEqual(savedPlan.inputSnapshot.voiceMapping, { avatarId: 'avatar1', voiceId: 'voice1' });
    const duplicatePlan = await (await request('/plans', { projectId: 'draft', assemblyId: 'video-1', shotId: 'shot1', fingerprint: shotFingerprint(shot, context) })).json();
    assert.equal(duplicatePlan.id, savedPlan.id, 'same saved shot version reuses its durable plan');
    assert.equal((await request('/plans', { projectId: 'draft', assemblyId: 'video-1', shotId: 'shot1', fingerprint: shotFingerprint(shot, context) }, 'B')).status, 400);
    assert.equal((await (await request('/plans?projectId=draft')).json()).length, 1);
    assert.deepEqual(await (await request('/plans?projectId=draft', undefined, 'B')).json(), []);
    assert.equal((await request('/jobs', { ...input, confirmed: false })).status, 400); assert.equal(calls.length, 0);
    assert.equal((await request('/jobs', input)).status, 400); assert.equal(calls.length, 0);
    rows.get('studio_production_defaults/defaults').payload.presenters[0].nativeOrientation = 'landscape';
    assert.equal((await request('/jobs', input)).status, 400); assert.equal(calls.length, 0);
    rows.get('studio_production_defaults/defaults').payload.presenters[0].nativeOrientation = 'portrait';
    const referenceShot = { ...shot, digitalHuman: {
      workflow: 'viral_replication' as const, method: 'replace' as const, contentConfirmed: true,
      action: '展示产品', scene: '展厅', preserve: '背景与产品',
      reference: { videoUrl: '/original.mp4', start: 0, end: 3, originalText: 'hello', derivativeAuthorized: true, derivativeAuthorizationEvidence: 'enterprise-owned source AUTH-1' },
    } };
    rows.get('studio_production_defaults/defaults').payload.presenters[0].referenceMaterialIds = ['presenter-reference'];
    rows.get('studio_production_defaults/defaults').payload.presenters[0].capabilities = ['talking', 'reference_image', 'reference_video'];
    rows.get('studio_projects/draft').spec.shotProductions['video-1:shot1'] = referenceShot;
    const referencePlan = await (await request('/plans', { projectId: 'draft', assemblyId: 'video-1', shotId: 'shot1', fingerprint: shotFingerprint(referenceShot, context) })).json();
    assert.equal(referencePlan.state, 'preview_only'); assert.equal(referencePlan.executable, false); assert.ok(referencePlan.candidateTools.includes('runway_kling_motion'));
    const referenceResponse = await request('/jobs', { ...input, requestId: 'reference-not-talking', fingerprint: shotFingerprint(referenceShot, context) });
    assert.equal(referenceResponse.status, 400);
    assert.match((await referenceResponse.json()).error, /不会改用口播接口/);
    assert.equal(calls.length, 0, 'reference requirements must never reach the paid talking adapter');
    delete rows.get('studio_production_defaults/defaults').payload.presenters[0].referenceMaterialIds;
    rows.get('studio_production_defaults/defaults').payload.presenters[0].capabilities = ['talking'];
    rows.get('studio_projects/draft').spec.shotProductions['video-1:shot1'] = shot;
    budgetDenied = true; assert.equal((await request('/jobs', input)).status, 400); assert.equal(calls.length, 0); budgetDenied = false;
    assert.equal((await request('/jobs', input, 'B')).status, 400); assert.equal(calls.length, 0);
    failWrites = true; assert.equal((await request('/jobs', input)).status, 400); assert.equal(calls.length, 0); failWrites = false;
    const first = await (await request('/jobs', input)).json(); assert.equal(first.status, 'pending');
    const executionsAfterSubmit = await (await request('/executions?projectId=draft')).json();
    assert.equal(executionsAfterSubmit.length, 1); assert.equal(executionsAfterSubmit[0].planId, savedPlan.id);
    assert.equal(executionsAfterSubmit[0].jobId, first.id); assert.equal(executionsAfterSubmit[0].state, 'pending');
    assert.equal(executionsAfterSubmit[0].tool, 'heygen'); assert.equal(executionsAfterSubmit[0].externalTaskId, 'remote1');
    assert.equal(executionsAfterSubmit[0].routeSteps.find((step: any) => step.id === 'generation').status, 'running');
    assert.equal(executionsAfterSubmit[0].actualCostCny, null); assert.equal(executionsAfterSubmit[0].costStatus, 'estimated');
    assert.deepEqual(await (await request('/executions?projectId=draft', undefined, 'B')).json(), []);
    const duplicate = await (await request('/jobs', input)).json(); assert.equal(duplicate.id, first.id); assert.equal(calls.length, 1);
    assert.equal((await request('/jobs', { ...input, requestId: 'parallel-new-id' })).status, 400); assert.equal(calls.length, 1);
    assert.equal(calls[0].body.script, 'hello'); assert.equal(calls[0].body.avatar_id, 'avatar1');
    assert.deepEqual(await (await request('/jobs?projectId=draft', undefined, 'B')).json(), []);
    assert.equal((await request(`/jobs/${first.id}/refresh`, {}, 'B')).status, 400);
    const rejected = await (await request(`/jobs/${first.id}/refresh`, {})).json();
    assert.equal(rejected.status, 'pending'); assert.equal(rejected.materialId, undefined); assert.match(rejected.error, /技术检查未通过/);
    assert.equal(rows.get(`studio_avatar_jobs/${first.id}`).payload.error, rejected.error);
    const executionAfterRejectedImport = (await (await request('/executions?projectId=draft')).json())[0];
    assert.equal(executionAfterRejectedImport.state, 'pending'); assert.match(executionAfterRejectedImport.error, /技术检查未通过/);
    assert.equal(calls.filter(call => call.body?.type === 'avatar').length, 1);
    importRejected = false; importEvidenceMissing = true;
    const missingEvidence = await (await request(`/jobs/${first.id}/refresh`, {})).json(); assert.equal(missingEvidence.status, 'pending'); assert.match(missingEvidence.error, /缺少可复核的存储引用/); assert.equal(imports, 1);
    importEvidenceMissing = false;
    const completed = await (await request(`/jobs/${first.id}/refresh`, {})).json(); assert.equal(completed.materialId, 'new-material'); assert.equal(imports, 2);
    const executionAfterCompletion = (await (await request('/executions?projectId=draft')).json())[0];
    assert.equal(executionAfterCompletion.state, 'completed'); assert.equal(executionAfterCompletion.materialId, 'new-material');
    assert.deepEqual(executionAfterCompletion.candidateOutput, { materialId: 'new-material', objectKey: 'materials/A/new-material.mp4', contentSha256: 'c'.repeat(64), objectEtag: 'candidate-v3' });
    assert.equal(executionAfterCompletion.costStatus, 'awaiting_invoice'); assert.equal(executionAfterCompletion.actualCostCny, null);
    assert.equal(executionAfterCompletion.quality.state, 'manual_review');
    assert.equal(executionAfterCompletion.routeSteps.find((step: any) => step.id === 'generation').status, 'completed');
    assert.equal(executionAfterCompletion.routeSteps.find((step: any) => step.id === 'manual_review').status, 'ready');
    assert.equal(executionAfterCompletion.quality.checks.find((item: any) => item.key === 'media_import').status, 'passed');
    assert.equal(executionAfterCompletion.quality.checks.find((item: any) => item.key === 'identity').status, 'pending');
    assert.equal((await request(`/executions/${executionAfterCompletion.id}/quality`, { decisions: { unknown: { passed: true, evidence: 'x' } } })).status, 400);
    const partialReview = await request(`/executions/${executionAfterCompletion.id}/quality`, { decisions: { identity: { passed: true, evidence: '人物一致' } } });
    assert.equal(partialReview.status, 400); assert.match(String((await partialReview.json()).error), /全部待人工验收项目/);
    const qualityDecisions = Object.fromEntries(executionAfterCompletion.quality.checks.filter((item: any) => item.mode === 'manual')
      .map((item: any) => [item.key, { passed: true, evidence: `review:${item.key}` }]));
    const acceptedExecution = await (await request(`/executions/${executionAfterCompletion.id}/quality`, { decisions: qualityDecisions })).json();
    assert.equal(acceptedExecution.quality.state, 'accepted');
    assert.equal(acceptedExecution.routeSteps.find((step: any) => step.id === 'assembly').status, 'ready');
    const immutableReview = await request(`/executions/${executionAfterCompletion.id}/quality`, { decisions: qualityDecisions });
    assert.equal(immutableReview.status, 400); assert.match(String((await immutableReview.json()).error), /人工验收已经结束/);
    assert.equal((await request(`/executions/${executionAfterCompletion.id}/cost`, { actualCostCny: -1, sourceRef: 'invoice-1' })).status, 400);
    assert.equal((await request(`/executions/${executionAfterCompletion.id}/cost`, { actualCostCny: 2.34567, sourceRef: 'heygen-invoice-2026-09' }, 'B')).status, 400);
    const reconciled = await (await request(`/executions/${executionAfterCompletion.id}/cost`, { actualCostCny: 2.34567, sourceRef: 'heygen-invoice-2026-09' })).json();
    assert.equal(reconciled.actualCostCny, 2.3457); assert.equal(reconciled.costStatus, 'reconciled'); assert.equal(reconciled.costSourceRef, 'heygen-invoice-2026-09');
    assert.equal(calls.filter(call => call.body?.type === 'avatar').length, 1, 'technical check retry must not create a paid generation');
    await request(`/jobs/${first.id}/refresh`, {}); assert.equal(imports, 2);
    assert.equal(rows.get('studio_projects/draft').spec.storyboardAssignments['slot-1'], 'keep-existing');
    const acceptedForAdoption = acceptedExecution;
    const adoptionCandidate = { id: 'candidate-adopted', materialId: 'new-material', source: 'avatar', fingerprint: input.fingerprint, jobId: first.id, createdAt: '' };
    rows.get('studio_projects/draft').spec.shotProductions['video-1:shot1'].candidates = [adoptionCandidate];
    rows.get(`studio_digital_human_executions/${acceptedForAdoption.id}`).payload.candidateOutput = { materialId: 'new-material', objectKey: 'materials/A/new-material.mp4', contentSha256: 'c'.repeat(64), objectEtag: 'candidate-v3' };
    assert.equal((await request(`/executions/${acceptedForAdoption.id}/adopt`, { candidateId: adoptionCandidate.id, materialId: adoptionCandidate.materialId }, 'B')).status, 400);
    const adoptionExecutionRow = rows.get(`studio_digital_human_executions/${acceptedForAdoption.id}`); const reviewedAt = adoptionExecutionRow.payload.quality.reviewedAt;
    adoptionExecutionRow.payload.quality.reviewedAt = null;
    const missingReviewTime = await request(`/executions/${acceptedForAdoption.id}/adopt`, { candidateId: adoptionCandidate.id, materialId: adoptionCandidate.materialId });
    assert.equal(missingReviewTime.status, 400); assert.match(String((await missingReviewTime.json()).error), /逐项人工验收/);
    adoptionExecutionRow.payload.quality.reviewedAt = reviewedAt;
    candidateCurrent = false;
    const changedCandidate = await request(`/executions/${acceptedForAdoption.id}/adopt`, { candidateId: adoptionCandidate.id, materialId: adoptionCandidate.materialId });
    assert.equal(changedCandidate.status, 400); assert.match(String((await changedCandidate.json()).error), /对象版本已变化/);
    candidateCurrent = true;
    const adopted = await (await request(`/executions/${acceptedForAdoption.id}/adopt`, { candidateId: adoptionCandidate.id, materialId: adoptionCandidate.materialId })).json();
    assert.equal(adopted.adoption.candidateId, adoptionCandidate.id); assert.ok(adopted.adoption.assemblyVersion);
    assert.equal(adopted.adoption.planId, acceptedForAdoption.planId); assert.equal(adopted.adoption.fingerprint, input.fingerprint);
    assert.equal(adopted.adoption.presenterAssetVersion, 1); assert.equal(adopted.adoption.qualityReviewedAt, reviewedAt);
    assert.equal(adopted.adoption.candidateObjectKey, 'materials/A/new-material.mp4'); assert.equal(adopted.adoption.candidateContentSha256, 'c'.repeat(64)); assert.equal(adopted.adoption.candidateObjectEtag, 'candidate-v3');
    assert.equal(adopted.routeSteps.find((step: any) => step.id === 'assembly').status, 'completed');
    assert.equal(rows.get('studio_projects/draft').spec.shotProductions['video-1:shot1'].adoptedId, adoptionCandidate.id);
    assert.equal(rows.get('studio_projects/draft').spec.storyboardAssignments['slot-1'], 'new-material');
    const assemblyEvidence = rows.get('studio_projects/draft').spec.digitalHumanAssemblyAdoptions['video-1:shot1'];
    assert.equal(assemblyEvidence.planId, acceptedForAdoption.planId); assert.equal(assemblyEvidence.fingerprint, input.fingerprint);
    assert.equal(assemblyEvidence.presenterAssetVersion, 1); assert.equal(assemblyEvidence.qualityReviewedAt, reviewedAt);
    assert.equal(assemblyEvidence.candidateContentSha256, 'c'.repeat(64)); assert.equal(assemblyEvidence.candidateObjectEtag, 'candidate-v3');
    const duplicateAdoption = await (await request(`/executions/${acceptedForAdoption.id}/adopt`, { candidateId: adoptionCandidate.id, materialId: adoptionCandidate.materialId })).json();
    assert.equal(duplicateAdoption.adoption.assemblyVersion, adopted.adoption.assemblyVersion);
    assert.equal((await request(`/executions/${acceptedForAdoption.id}/quality`, { decisions: qualityDecisions })).status, 400);
    loseResponse = true;
    const uncertain = await (await request('/jobs', { ...input, requestId: 'req2' })).json(); assert.equal(uncertain.status, 'uncertain');
    const beforeRefresh = calls.length;
    const recovered = await request(`/jobs/${uncertain.id}/refresh`, {}); assert.equal(recovered.status, 400);
    assert.match((await recovered.json()).error, /刷新不会再次付费生成/);
    assert.equal(calls.length, beforeRefresh);
    assert.equal((await request('/jobs', { ...input, requestId: 'do-not-rebill' })).status, 400);
    assert.equal(calls.length, beforeRefresh);
    const shared = { ...shot, sound: 'voiceover' }; project.spec.shotProductions['video-1:shot1'] = shared as typeof shot;
    Object.assign(project.spec, { voiceoverMode: 'upload', voiceoverUrl: '/tts/shared.wav', shootingSlots: [{ id: 'shot1', duration: 3 }] }); rows.set('studio_projects/draft', project);
    const beforeUnaligned = calls.length;
    assert.equal((await request('/jobs', { ...input, requestId: 'unaligned', fingerprint: shotFingerprint(shared as typeof shot, context) })).status, 400);
    assert.equal(calls.length, beforeUnaligned);
    Object.assign(project.spec, { lang: 'en', voiceoverDur: 3, voiceoverAudios: { en: { alignmentSource: 'manual_confirmed', cues: [{ text: 'hello', start: 0.5, end: 2.5 }] } } });
    const sharedFingerprint = shotFingerprint(shared as typeof shot, context);
    assert.equal((await request('/plans', { projectId: 'draft', assemblyId: 'video-1', shotId: 'shot1', fingerprint: sharedFingerprint })).status, 200);
    const sharedJob = await (await request('/jobs', { ...input, requestId: 'req3', fingerprint: sharedFingerprint })).json();
    assert.equal(calls.at(-1)!.body.audio_asset_id, 'audio1'); assert.equal(calls.at(-1)!.body.script, undefined);
    assert.equal(audioRefs.at(-1)?.start, 0.5); assert.equal(audioRefs.at(-1)?.duration, 2);
    const sharedExecution = (await (await request('/executions?projectId=draft')).json()).find((item: any) => item.jobId === sharedJob.id);
    assert.deepEqual(sharedExecution.inputSnapshot.audioSegment, { segmentId: 'segment-test', checksumSha256: 'a'.repeat(64), start: 0.5, duration: 2 });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('reference adapter uses durable idempotent execution records and refreshes without resubmitting', async () => {
  const rows = new Map<string, any>(); let seq = 0;
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>(collection: string, value: Record<string, unknown>) { const row = { ...value, id: `ref-${++seq}` }; rows.set(`${collection}/${row.id}`, structuredClone(row)); return row as T; },
    async update(collection, id, patch) { if (!rows.has(`${collection}/${id}`)) return false; rows.set(`${collection}/${id}`, { ...rows.get(`${collection}/${id}`), ...structuredClone(patch) }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query = {}) { const where = (query as { where?: Record<string, unknown> }).where || {}; const items = [...rows.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected)).map(([, value]) => structuredClone(value) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
  const context = 'reference-context';
  const shot = { ...newShotProduction('这是本片口播', 'person-1'), source: 'avatar' as const, digitalHuman: {
    workflow: 'viral_replication' as const, method: 'replace' as const, contentConfirmed: true,
    action: '按参考视频展示产品', scene: '原展厅', preserve: '产品、背景和构图',
    reference: { materialId: 'source-material-1', videoUrl: '/source.mp4', start: 0, end: 3, originalText: 'source line', derivativeAuthorized: true, derivativeAuthorizationEvidence: 'enterprise-owned source AUTH-REF-1' },
  } };
  rows.set('studio_projects/project-ref', { id: 'project-ref', tenant_id: 'tenant-a', status: 'draft', spec: {
    ratio: '9:16', lang: 'zh', activeAssemblyId: 'assembly-1', shotProductionContext: context, shotProductions: { 'assembly-1:shot-1': shot },
    shootingSlots: [{ id: 'shot-1', slotId: 'agent-shot-1', duration: 3 }], socialDigitalHumanPlans: [{ shotId: 'agent-shot-1', shotIndex: 0, sourceTaskId: 'social-task-1', sourceTaskVersion: 'v1' }],
  } });
  rows.set('studio_production_defaults/default-ref', { id: 'default-ref', tenant_id: 'tenant-a', payload: {
    preference: 'avatar', defaultPresenterId: 'person-1', presenters: [{ id: 'person-1', name: 'Person', avatarId: '', voiceId: '', authorized: true, supportsAlpha: false, assetVersion: 3, toolMappings: { runway: { referenceMaterialIds: ['portrait-1'] } } }],
  } });
  let submitCalls = 0; let statusCalls = 0; let costCalls = 0; let cancelCalls = 0; let statusFailure = false; let rejectSubmission = false; let referenceInputsCurrent = true; let remoteState: 'pending' | 'completed' = 'pending'; const submittedInputs: any[] = [];
  const adapter: DigitalHumanExecutionAdapter = {
    id: 'local_head_pipeline', methods: ['replace'],
    executionProfile: { maxDurationSeconds: 10, preserves: ['identity', 'motion', 'product', 'background', 'composition'], qualityInspection: true, estimatedCostCnyPerSecond: 0.5 },
    async submit(input, key) { submitCalls++; submittedInputs.push(input); assert.match(key, /^tenant-a:reference-request/); if (rejectSubmission) throw new DefinitiveSupplierSubmissionError('供应商明确拒绝输入'); return { externalTaskId: 'external-ref-1' }; },
    async status(id) { statusCalls++; assert.equal(id, 'external-ref-1'); if (statusFailure) throw new Error('未知任务状态：NEW_STATE'); return remoteState === 'completed' ? { state: 'completed', outputUrl: 'https://files.example/reference.mp4' } : { state: 'pending' }; },
    async cost(id) { costCalls++; assert.equal(id, 'external-ref-1'); return { actualCostCny: 3.45678, costSourceRef: 'supplier-usage-ref-1' }; },
    async cancel(id) { cancelCalls++; assert.equal(id, 'external-ref-1'); return { cancelled: true, reason: 'supplier_cancelled' }; },
  };
  let reserves = 0; let releases = 0; let releaseFails = true; let imports = 0; let modelInspections = 0;
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'tenant-a'; next(); });
  app.use(createProductionRouter(store, async () => 'unused', {
    enabled: () => false, adapters: [adapter],
    maxAttemptsPerShot: 2,
    referenceBudgetLimitCny: 2,
    reserveReference: async (tool, key) => { reserves++; assert.equal(tool, 'local_head_pipeline'); assert.match(key, /^tenant-a:reference-request/); },
    releaseReference: async (tool, key) => { releases++; assert.equal(tool, 'local_head_pipeline'); assert.match(key, /^tenant-a:reference-request/); if (releaseFails) throw new Error('ledger unavailable'); },
    verifyCandidateOutput: async (evidence, tenantId) => { assert.equal(tenantId, 'tenant-a'); assert.equal(evidence.objectEtag, 'candidate-v1'); return true; },
    verifyReferenceInputs: async (snapshot, tenantId) => { assert.equal(tenantId, 'tenant-a'); assert.equal(snapshot.presenterInput?.objectEtag, 'person-v4'); assert.equal(snapshot.referenceInput?.clipObjectEtag, 'clip-v1'); return referenceInputsCurrent; },
    resolveReferenceInputs: async ({ tenantId }) => { assert.equal(tenantId, 'tenant-a'); return { characterUrl: 'https://assets.example/person.png', characterType: 'image' as const, characterMaterialId: 'portrait-1', characterObjectKey: 'tenant-a/portrait-1.png', characterObjectEtag: 'person-v4', referenceVideoUrl: 'https://assets.example/reference-shot.mp4', referenceClipKey: 'tenant-a/exact-reference.mp4', referenceClipObjectEtag: 'clip-v1', referenceSourceObjectEtag: 'source-v2', referenceMaterialId: 'source-material-1', referenceStart: 0, referenceDuration: 3 }; },
    importReferenceVideo: async (url, execution, tenantId) => {
      imports++; assert.equal(url, 'https://files.example/reference.mp4'); assert.equal(execution.tool, 'local_head_pipeline'); assert.equal(tenantId, 'tenant-a');
      return {
        materialId: 'reference-material-1', objectKey: 'materials/tenant-a/reference.mp4', contentSha256: 'b'.repeat(64), objectEtag: 'candidate-v1',
        technicalMetrics: { durationDeltaFrames: 0, audioCorrelation: 0.999, temporalMotionDifference: 1.5, freezeMismatchRatio: 0, comparedFrames: 24 },
        visualMetrics: { normalizedPoseError: 0.03, posePairCount: 24, handPckAt008: 0.84, handPairCount: 12, wristSeparationMae: 0.1, wristMotionCorrelation: 0.92, wristPosePairCount: 20, backgroundSsim: 0.94, landmarkArtifactCount: 0, faceAppearanceCorrelationProxy: 0.91, facePairCount: 20 },
      };
    },
    inspectReferenceQuality: async input => {
      modelInspections++; assert.equal(input.referenceClipObjectKey, 'tenant-a/exact-reference.mp4'); assert.equal(input.referenceMaterialId, 'source-material-1');
      assert.deepEqual(input.presenterReferenceMaterialIds, ['portrait-1']); assert.equal(input.candidateMaterialId, 'reference-material-1');
      assert.equal(input.candidateVideoUrl, 'https://files.example/reference.mp4'); assert.equal(input.tenantId, 'tenant-a');
      return {
        identity: { passed: true, confidence: 0.98, model: 'enterprise-face-test', evidence: '人物资产 V4 对比通过' },
        product_fidelity: { passed: true, confidence: 0.93, model: 'sku-vision-test', evidence: '产品结构与文字一致' },
        local_artifacts: { passed: true, confidence: 0.9, model: 'artifact-test', evidence: '抽检帧未发现局部伪影' },
      };
    },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown, tenant = 'tenant-a') => fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const fingerprint = shotFingerprint(shot, context);
  try {
    const capabilities = await (await request('/capabilities')).json();
    assert.equal(capabilities.tools.find((item: any) => item.id === 'local_head_pipeline').execution, true);
    assert.equal(capabilities.tools.find((item: any) => item.id === 'local_head_pipeline').cancellation, true);
    assert.equal(capabilities.tools.find((item: any) => item.id === 'local_head_pipeline').costReconciliation, true);
    assert.equal(capabilities.tools.find((item: any) => item.id === 'local_head_pipeline').executionProfile.maxDurationSeconds, 10);
    assert.equal(capabilities.referenceBudgetLimitCny, 2);
    assert.equal(capabilities.maxAttemptsPerShot, 2);
    const synced = await (await request('/plans/sync-agent', { projectId: 'project-ref' })).json();
    assert.equal(synced.length, 1); assert.equal(synced[0].origin, 'content_agent'); assert.equal(synced[0].sourceTaskId, 'social-task-1'); assert.equal(synced[0].sourceTaskVersion, 'v1');
    rows.get('studio_projects/project-ref').spec.socialDigitalHumanPlans[0].sourceTaskVersion = 'v2';
    const resynced = await (await request('/plans/sync-agent', { projectId: 'project-ref' })).json();
    assert.equal(resynced[0].id, synced[0].id); assert.equal(resynced[0].sourceTaskVersion, 'v2');
    rows.get('studio_production_defaults/default-ref').payload.presenters[0].assetVersion = 4;
    const upgraded = await (await request('/plans/sync-agent', { projectId: 'project-ref' })).json();
    assert.notEqual(upgraded[0].id, synced[0].id, 'a new presenter asset version keeps the historic plan and creates a new one');
    assert.equal(upgraded[0].presenterAssetVersion, 4);
    assert.equal((await request('/plans/sync-agent', { projectId: 'project-ref' }, 'tenant-b')).status, 400);
    const planResponse = await request('/plans', { projectId: 'project-ref', assemblyId: 'assembly-1', shotId: 'shot-1', fingerprint });
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json(); assert.equal(plan.state, 'ready'); assert.equal(plan.executable, true); assert.equal(plan.provider, 'local_head_pipeline'); assert.equal(plan.origin, 'content_agent'); assert.equal(plan.sourceTaskVersion, 'v2');
    assert.equal(plan.routeSteps.find((step: any) => step.id === 'generation').tool, 'local_head_pipeline');
    assert.equal(plan.estimatedCostCny, 1.5);
    assert.equal(plan.routeDecision.selectedTool, 'local_head_pipeline');
    assert.equal(plan.routeDecision.budgetLimitCny, 2);
    assert.deepEqual(plan.routeDecision.requiredPreservation, ['identity', 'product', 'background', 'composition']);
    assert.equal(plan.routeDecision.evaluations[0].compatible, true);
    assert.equal(plan.inputSnapshot.language, 'zh'); assert.equal(plan.inputSnapshot.targetDurationSeconds, 3); assert.equal(plan.inputSnapshot.presenterAssetVersion, 4);
    assert.deepEqual(plan.inputSnapshot.presenterReferenceMaterialIds, ['portrait-1']); assert.equal(plan.inputSnapshot.requirements.method, 'replace');
    assert.equal(plan.inputSnapshot.derivativeAuthorization.evidence, 'enterprise-owned source AUTH-REF-1'); assert.ok(Date.parse(plan.inputSnapshot.derivativeAuthorization.confirmedAt));
    assert.equal(plan.inputSnapshot.modelInputAuthorization.evidence, 'enterprise-owned source AUTH-REF-1'); assert.ok(Date.parse(plan.inputSnapshot.modelInputAuthorization.confirmedAt));
    const input = { projectId: 'project-ref', assemblyId: 'assembly-1', shotId: 'shot-1', fingerprint, requestId: 'reference-request', confirmed: true };
    assert.equal((await request('/reference-jobs', input, 'tenant-b')).status, 400);
    rejectSubmission = true;
    const explicitlyRejected = await (await request('/reference-jobs', { ...input, requestId: 'reference-request-rejected' })).json();
    assert.equal(explicitlyRejected.state, 'failed'); assert.equal(explicitlyRejected.submissionOutcome, 'rejected'); assert.match(explicitlyRejected.error, /明确拒绝.*预算预占释放失败.*ledger unavailable/); assert.equal(releases, 1);
    rejectSubmission = false; releaseFails = false;
    const submitted = await (await request('/reference-jobs', input)).json();
    assert.equal(submitted.state, 'pending'); assert.equal(submitted.submissionOutcome, 'created'); assert.equal(submitted.externalTaskId, 'external-ref-1'); assert.equal(submitted.tool, 'local_head_pipeline');
    assert.equal(submitted.routeSteps.find((step: any) => step.id === 'generation').status, 'running');
    assert.deepEqual(submitted.inputSnapshot, { ...plan.inputSnapshot, revisionFeedback: null,
      presenterInput: { materialId: 'portrait-1', objectKey: 'tenant-a/portrait-1.png', type: 'image', objectEtag: 'person-v4' },
      referenceInput: { materialId: 'source-material-1', clipObjectKey: 'tenant-a/exact-reference.mp4', start: 0, duration: 3, sourceObjectEtag: 'source-v2', clipObjectEtag: 'clip-v1' } });
    assert.equal(submittedInputs[1].characterUrl, 'https://assets.example/person.png'); assert.equal(submittedInputs[1].characterType, 'image'); assert.equal(submittedInputs[1].referenceVideoUrl, 'https://assets.example/reference-shot.mp4'); assert.equal(submittedInputs[1].ratio, '720:1280');
    assert.equal(submitCalls, 2); assert.equal(reserves, 2);
    const duplicate = await (await request('/reference-jobs', input)).json();
    assert.equal(duplicate.id, submitted.id); assert.equal(submitCalls, 2); assert.equal(reserves, 2);
    const concurrent = await request('/reference-jobs', { ...input, requestId: 'reference-request-2' });
    assert.equal(concurrent.status, 400); assert.match(String((await concurrent.json()).error), /已有未结束的参考人物任务/);
    assert.equal(submitCalls, 2); assert.equal(reserves, 2);
    assert.equal((await request(`/reference-jobs/${submitted.id}/refresh`, {}, 'tenant-b')).status, 400);
    statusFailure = true;
    const failedRefresh = await request(`/reference-jobs/${submitted.id}/refresh`, {});
    assert.equal(failedRefresh.status, 400); assert.match((await failedRefresh.json()).error, /未知任务状态：NEW_STATE/);
    const afterFailedRefresh = (await (await request('/executions?projectId=project-ref')).json()).find((item: any) => item.id === submitted.id);
    assert.equal(afterFailedRefresh.state, 'pending'); assert.match(afterFailedRefresh.error, /系统不会重新提交生成/); assert.equal(submitCalls, 2);
    statusFailure = false;
    const pending = await (await request(`/reference-jobs/${submitted.id}/refresh`, {})).json();
    assert.equal(pending.state, 'pending'); assert.equal(statusCalls, 2); assert.equal(imports, 0);
    remoteState = 'completed';
    referenceInputsCurrent = false;
    const changedInputs = await (await request(`/reference-jobs/${submitted.id}/refresh`, {})).json();
    assert.equal(changedInputs.state, 'pending'); assert.match(changedInputs.error, /对象版本已变化/); assert.equal(imports, 0);
    referenceInputsCurrent = true;
    const completed = await (await request(`/reference-jobs/${submitted.id}/refresh`, {})).json();
    assert.equal(completed.state, 'completed'); assert.equal(completed.materialId, 'reference-material-1'); assert.equal(completed.costStatus, 'awaiting_invoice');
    assert.deepEqual(completed.candidateOutput, { materialId: 'reference-material-1', objectKey: 'materials/tenant-a/reference.mp4', contentSha256: 'b'.repeat(64), objectEtag: 'candidate-v1' });
    assert.equal(completed.actualCostCny, null); assert.equal(costCalls, 0);
    assert.equal((await request(`/executions/${submitted.id}/reconcile-cost`, {}, 'tenant-b')).status, 400);
    const reconciledCost = await (await request(`/executions/${submitted.id}/reconcile-cost`, {})).json();
    assert.equal(reconciledCost.actualCostCny, 3.4568); assert.equal(reconciledCost.costSourceRef, 'supplier-usage-ref-1'); assert.equal(reconciledCost.costStatus, 'reconciled'); assert.equal(costCalls, 1);
    const duplicateCost = await (await request(`/executions/${submitted.id}/reconcile-cost`, {})).json();
    assert.equal(duplicateCost.actualCostCny, 3.4568); assert.equal(costCalls, 1, 'reconciled cost lookup is idempotent');
    assert.equal(completed.quality.state, 'manual_review');
    assert.equal(completed.routeSteps.find((step: any) => step.id === 'automatic_quality').status, 'completed');
    assert.equal(completed.routeSteps.find((step: any) => step.id === 'manual_review').status, 'ready');
    for (const key of ['media_import', 'reference_duration', 'reference_audio', 'reference_motion', 'reference_pose_proxy', 'reference_background_proxy', 'reference_artifacts_proxy']) assert.equal(completed.quality.checks.find((item: any) => item.key === key).status, 'passed');
    assert.equal(completed.quality.checks.find((item: any) => item.key === 'identity').status, 'passed');
    assert.equal(completed.quality.checks.find((item: any) => item.key === 'identity').mode, 'automatic');
    assert.equal(completed.quality.checks.find((item: any) => item.key === 'product_fidelity').status, 'passed');
    assert.equal(completed.quality.checks.find((item: any) => item.key === 'local_artifacts').status, 'passed');
    assert.equal(modelInspections, 1);
    await request(`/reference-jobs/${submitted.id}/refresh`, {});
    assert.equal(statusCalls, 4, 'completed execution does not query supplier again'); assert.equal(imports, 1); assert.equal(submitCalls, 2);
    const manualDecisions = Object.fromEntries(completed.quality.checks.filter((item: any) => item.mode === 'manual').map((item: any) => [item.key, { passed: false, evidence: '人物动作需要调整' }]));
    const rejected = await (await request(`/executions/${submitted.id}/quality`, { decisions: manualDecisions, reviewNote: '人物抬手慢半拍，请保持背景并只重做这一镜' })).json();
    assert.equal(rejected.quality.state, 'failed');
    const retried = await (await request('/reference-jobs', { ...input, requestId: 'reference-request-retry' })).json();
    assert.equal(retried.inputSnapshot.revisionFeedback, '人物抬手慢半拍，请保持背景并只重做这一镜');
    assert.equal(submittedInputs[2].revisionFeedback, '人物抬手慢半拍，请保持背景并只重做这一镜'); assert.equal(submitCalls, 3);
    assert.equal((await request(`/reference-jobs/${retried.id}/cancel`, {}, 'tenant-b')).status, 400);
    const cancelled = await (await request(`/reference-jobs/${retried.id}/cancel`, {})).json();
    assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.error, 'supplier_cancelled'); assert.equal(cancelCalls, 1);
    assert.equal(cancelled.routeSteps.find((step: any) => step.id === 'generation').status, 'failed');
    const duplicateCancel = await (await request(`/reference-jobs/${retried.id}/cancel`, {})).json();
    assert.equal(duplicateCancel.state, 'cancelled'); assert.equal(cancelCalls, 1);
    const capped = await request('/reference-jobs', { ...input, requestId: 'reference-request-over-cap' });
    assert.equal(capped.status, 400); assert.match(String((await capped.json()).error), /达到 2 次生成上限/);
    assert.equal(submitCalls, 3); assert.equal(reserves, 3); assert.equal(releases, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
