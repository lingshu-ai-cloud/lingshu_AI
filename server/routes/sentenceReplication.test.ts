import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { createProductionRouter } from './production.js';
import { newShotProduction, shotFingerprint } from '../../src/lib/shotProduction.js';

test('sentence first frames resolve the owned project reference without a library material id', async () => {
  const referenceId = 'trend_videos_12345678';
  const videoUrl = `/api/overseas/videos/${referenceId}/media-url`;
  const context = 'reference-context';
  const shot = { ...newShotProduction('Hello', 'sales'), source: 'avatar' as const, digitalHuman: {
    workflow: 'viral_replication' as const, method: 'reenact' as const, replicationMode: 'sentence_first_frame' as const,
    contentConfirmed: true, action: '自然口播', scene: '原片构图', preserve: '人物位置与背景',
    reference: { videoUrl, start: 0, end: 1, originalText: 'Hello', derivativeAuthorized: false,
      cues: [{ id: 'cue-1', start: 0, end: 1, originalText: 'Hello', targetText: '', shotIds: ['slot-1'] }] },
  } };
  const project = { id: 'project-1', tenant_id: 'tenant-a', status: 'draft', spec: { shotProductionContext: context,
    videoKickoff: { video: { referenceRecordId: referenceId, videoUrl } },
    shootingSlots: [{ id: 'shot-1', slotId: 'slot-1', duration: 1, observedPresenterRole: 'sales_presenter', salesPresenterConfirmed: true }],
    shotProductions: { 'assembly-1:shot-1': shot } } };
  const reference = { id: referenceId, tenantId: 'tenant-a', contentFormat: 'video',
    videoFileId: `tenants/tenant-a/reference-videos/${referenceId}.mp4`,
    aiAnalysis: JSON.stringify({ contentSha256: 'a'.repeat(64), usage: 'reference_only' }) };
  const store = { getById: async (collection: string, id: string) => collection === 'studio_projects' && id === project.id ? project
    : collection === 'trend_videos' && id === reference.id ? reference : null } as unknown as DataStore;
  let extracted = 0;
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'tenant-a'; next(); });
  app.use(createProductionRouter(store, async () => 'unused', { prepareSentenceFirstFrames: async input => {
    extracted++; assert.equal(input.referenceMaterialId, referenceId); assert.equal(input.sourceMaterial?.contentSha256, 'a'.repeat(64));
    assert.equal(input.cues[0]?.personShot, true); assert.equal(input.cues[0]?.classificationSource, 'manual'); assert.equal(input.cues[0]?.targetText, 'Hello');
    return input.cues;
  } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (tenant: string) => fetch(`${url}/sentence-first-frames`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant },
    body: JSON.stringify({ projectId: project.id, assemblyId: 'assembly-1', shotId: 'shot-1', fingerprint: shotFingerprint(shot, context, 'shot-1') }) });
  try { assert.equal((await request('tenant-a')).status, 200); assert.equal(extracted, 1); assert.equal((await request('tenant-b')).status, 400); assert.equal(extracted, 1); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('sentence replication persists one paid request and reuses its completed result', async () => {
  const rows = new Map<string, any>(); let seq = 0; let generations = 0;
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>(collection: string, value: Record<string, unknown>) { const row = { ...value, id: `r${++seq}` }; rows.set(`${collection}/${row.id}`, structuredClone(row)); return row as T; },
    async update(collection, id, patch) { const key = `${collection}/${id}`; if (!rows.has(key)) return false; rows.set(key, { ...rows.get(key), ...structuredClone(patch) }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query: ListQuery = {}) { const where = query.where || {}; const items = [...rows.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected)).map(([, value]) => structuredClone(value) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
  const context = 'sentence-context'; const base = newShotProduction('新的企业口播', 'sales');
  const shot = { ...base, source: 'avatar' as const, digitalHuman: { workflow: 'viral_replication' as const, method: 'reenact' as const, replicationMode: 'sentence_first_frame' as const, contentConfirmed: true, action: '逐句复刻', scene: '参考原片', preserve: '构图', reference: { materialId: 'viral-video', videoUrl: '/media/viral.mp4', start: 0, end: 2, originalText: '原口播', derivativeAuthorized: false, cues: [{ id: 'cue-1', start: 0, end: 2, originalText: '原口播', targetText: '新的企业口播', shotIds: ['shot-1'], personShot: true, compositionClusterId: 'front-medium', sourceFirstFrame: { time: 0, materialId: 'source-frame-1' } }] } } };
  const project = { id: 'project-1', tenant_id: 'tenant-a', status: 'draft', spec: { ratio: '9:16', shotProductionContext: context, shootingSlots: [{ id: 'shot-1', slotId: 'slot-1', duration: 2 }], shotProductions: { 'assembly-1:shot-1': shot } } };
  rows.set('studio_projects/project-1', project);
  rows.set('studio_production_defaults/defaults', { id: 'defaults', tenant_id: 'tenant-a', payload: { preference: 'avatar', defaultPresenterId: 'sales', presenters: [{ id: 'sales', name: '销售', authorized: true, assetVersion: 2, referenceMaterialIds: ['sales-photo'] }] } });
  const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.tenantId = 'tenant-a'; next(); });
  app.use(createProductionRouter(store, async () => 'unused', { sentenceReplicationReadiness: () => ({ ready: true, missing: [] }), runSentenceReplication: async input => { generations += 1; await input.onProviderTaskSubmitted?.('cue-1','seedance-task-1'); return { cues: input.cues.map(cue => ({ ...cue, targetFirstFrame: { materialId: 'target-1', state: 'ready' }, generatedClip: { materialId: 'clip-1', state: 'ready', duration: 2 } })), materialId: 'candidate-1', candidateUrl: '/media/candidate.mp4', providerTaskIds: ['seedance-task-1'], candidateOutput: { materialId: 'candidate-1', objectKey: 'materials/tenants/dGVuYW50LWE/candidate.mp4', contentSha256: 'a'.repeat(64), objectEtag: 'etag-1' }, cueQuality:[{cueId:'cue-1',kind:'person_generated',state:'manual_review',checks:[{key:'media',status:'passed',evidence:'validated'},{key:'identity',status:'pending',evidence:'待验收'},{key:'motion',status:'pending',evidence:'待验收'},{key:'product_brand_text',status:'pending',evidence:'待验收'},{key:'background',status:'pending',evidence:'待验收'},{key:'audio_sync',status:'pending',evidence:'待验收'},{key:'reuse_risk',status:'pending',evidence:'待验收'}]}],failedCueIds:[], state: 'completed' }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; const body = { projectId: project.id, assemblyId: 'assembly-1', shotId: 'shot-1', fingerprint: shotFingerprint(shot, context, 'shot-1'), requestId: 'sentence-request-1', confirmed: true };
  try {
    const readinessResponse = await fetch(`${url}/sentence-replication-readiness`);
    assert.equal(readinessResponse.status, 200);
    assert.deepEqual(await readinessResponse.json(), { ready: true, missing: [] });
    const firstResponse = await fetch(`${url}/sentence-replication-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(firstResponse.status, 200, await firstResponse.clone().text()); const first = await firstResponse.json();
    const duplicateResponse = await fetch(`${url}/sentence-replication-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(duplicateResponse.status, 200); const duplicate = await duplicateResponse.json();
    assert.equal(generations, 1); assert.equal(duplicate.executionId, first.executionId); assert.equal(first.providerTaskIds[0], 'seedance-task-1');
    const detailResponse=await fetch(`${url}/sentence-replication-jobs/${first.sentenceJobId}`); assert.equal(detailResponse.status,200); const detail=await detailResponse.json(); assert.equal(detail.sentenceJobId,first.sentenceJobId); assert.equal(detail.cueQuality[0].cueId,'cue-1');
    const executions = [...rows.entries()].filter(([key]) => key.startsWith('studio_digital_human_executions/')).map(([, value]) => value); assert.equal(executions.length, 1); assert.equal(executions[0].payload.materialId, 'candidate-1'); assert.equal(executions[0].payload.quality.state, 'manual_review');
    const jobs=[...rows.entries()].filter(([key])=>key.startsWith('studio_sentence_replication_jobs/')).map(([,value])=>value); assert.equal(jobs[0].payload.providerTasks['cue-1'],'seedance-task-1');
    const decisions=Object.fromEntries(['identity','motion','product_brand_text','background','audio_sync','reuse_risk'].map(key=>[key,{passed:key!=='motion',evidence:`review:${key}`} ])); const reviewedResponse=await fetch(`${url}/sentence-replication-jobs/${first.sentenceJobId}/cue-quality`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decisions:{'cue-1':decisions}})}); assert.equal(reviewedResponse.status,200); const reviewed=await reviewedResponse.json(); assert.deepEqual(reviewed.failedCueIds,['cue-1']); assert.equal(reviewed.cueQuality[0].state,'failed');
    const repairResponse=await fetch(`${url}/sentence-replication-jobs/${first.sentenceJobId}/retry-failed`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'sentence-repair-1',confirmed:true})}); assert.equal(repairResponse.status,200); const repaired=await repairResponse.json(); assert.equal(generations,2); assert.equal(repaired.providerTaskIds[0],'seedance-task-1'); assert.notEqual(repaired.sentenceJobId,first.sentenceJobId);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('uncertain HeyGen photo task resumes from its saved task id without a second submission', async () => {
  const previous = Object.fromEntries(['HEYGEN_GENERATION_ENABLED','HEYGEN_API_KEY','SEEDREAM_API_KEY','OBJECT_STORAGE_DRIVER'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { HEYGEN_GENERATION_ENABLED: 'true', HEYGEN_API_KEY: 'test-only', SEEDREAM_API_KEY: 'test-only', OBJECT_STORAGE_DRIVER: 'local' });
  const rows = new Map<string, any>(); let seq = 0; let attempts = 0; let submissions = 0;
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>(collection: string, value: Record<string, unknown>) { const row = { ...structuredClone(value), id: `r${++seq}` }; rows.set(`${collection}/${row.id}`, row); return structuredClone(row) as T; },
    async update(collection, id, patch) { const key = `${collection}/${id}`; if (!rows.has(key)) return false; rows.set(key, { ...rows.get(key), ...structuredClone(patch) }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query: ListQuery = {}) { const where = query.where || {}; const items = [...rows.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected)).map(([, value]) => structuredClone(value) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
  const context = 'photo-context';
  const shot = { ...newShotProduction('六秒销售口播', 'sales'), source: 'avatar' as const, digitalHuman: { presenterMode: 'photo_talking' as const, workflow: 'viral_replication' as const, method: 'reenact' as const, replicationMode: 'sentence_first_frame' as const, contentConfirmed: true, targetFramesConfirmed: true, action: '口播', scene: '办公室', preserve: '构图', reference: { materialId: 'source-video', videoUrl: '/source.mp4', start: 0, end: 6, originalText: '原台词', derivativeAuthorized: false, cues: [{ id: 'cue-1', start: 0, end: 6, originalText: '原台词', targetText: '六秒销售口播', shotIds: ['shot-1'], personShot: true, compositionClusterId: 'front-medium', sourceFirstFrame: { time: 0, materialId: 'source-frame' }, targetFirstFrame: { materialId: 'target-frame', imageUrl: '/target.jpg', state: 'ready' as const } }] } } };
  rows.set('studio_projects/project-photo', { id: 'project-photo', tenant_id: 'tenant-a', status: 'draft', spec: { ratio: '9:16', shotProductionContext: context, shotProductions: { 'assembly-1:shot-1': shot } } });
  rows.set('studio_production_defaults/defaults', { id: 'defaults', tenant_id: 'tenant-a', payload: { presenters: [{ id: 'sales', name: '销售', authorized: true, assetVersion: 1, voiceId: 'voice-1' }] } });
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'tenant-a'; next(); });
  app.use(createProductionRouter(store, async () => 'unused', { runSentenceReplication: async input => { attempts++; if (attempts === 1) { submissions++; await input.onProviderTaskSubmitted?.('cue-1', 'heygen-original'); throw new Error('逐句视频下载失败：HTTP 503'); } assert.deepEqual(input.existingProviderTasks, { 'cue-1': 'heygen-original' }); return { cues: input.cues, materialId: 'candidate-photo', candidateUrl: '/candidate.mp4', providerTaskIds: ['heygen-original'], candidateOutput: { materialId: 'candidate-photo', objectKey: 'tenant/candidate.mp4', contentSha256: 'a'.repeat(64), objectEtag: 'etag-photo' }, cueQuality: [], failedCueIds: [], state: 'completed' }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; const body = { projectId: 'project-photo', assemblyId: 'assembly-1', shotId: 'shot-1', fingerprint: shotFingerprint(shot, context, 'shot-1'), requestId: 'photo-request', maxCostCny: 5, confirmed: true };
  try {
    const first = await fetch(`${url}/sentence-replication-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(first.status, 400, await first.clone().text());
    const job = [...rows.values()].find(row => row.request_id === 'photo-request'); assert.ok(job);
    const status = await fetch(`${url}/sentence-replication-jobs/${job.id}/status`); assert.equal(status.status, 200); assert.deepEqual((await status.json()).providerTasks, { 'cue-1': 'heygen-original' });
    const pending = await fetch(`${url}/sentence-replication-pending?projectId=project-photo&assemblyId=assembly-1&shotId=shot-1&fingerprint=${encodeURIComponent(body.fingerprint)}`); assert.equal(pending.status, 200); assert.equal((await pending.json()).id, job.id);
    const otherTenant = await fetch(`${url}/sentence-replication-jobs/${job.id}/status`, { headers: { 'x-tenant': 'tenant-b' } }); assert.equal(otherTenant.status, 404);
    const duplicate = await fetch(`${url}/sentence-replication-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(duplicate.status, 400); assert.equal(submissions, 1);
    const alternate = await fetch(`${url}/sentence-replication-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({...body,requestId:'second-photo-request'}) }); assert.equal(alternate.status, 400); assert.equal(submissions, 1);
    const resumed = await fetch(`${url}/sentence-replication-jobs/${job.id}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true, maxCostCny: 5 }) }); assert.equal(resumed.status, 200, await resumed.clone().text()); assert.equal((await resumed.json()).providerTaskIds[0], 'heygen-original'); assert.equal(submissions, 1); assert.equal(attempts, 2);
    const cleared = await fetch(`${url}/sentence-replication-pending?projectId=project-photo&assemblyId=assembly-1&shotId=shot-1&fingerprint=${encodeURIComponent(body.fingerprint)}`); assert.equal(await cleared.json(), null);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
