import {freezeSocialAccountProductionConstraints} from './socialAccountProductionConstraints.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { createSocialDigitalPresenterAdapter } from './socialContentDigitalPresenterAdapter.js';
import { auditSocialHeyGenPresenters, createSocialHeyGenBridgePorts, createSocialHeyGenHookAudioPort, createMvpSocialHeyGenHookAudioPort, socialHeyGenBridgeReadiness } from './socialContentHeyGenBridge.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-heygen-bridge-'));
const previousCwd = process.cwd();
process.chdir(tmp);

type Row = Record_ & Record<string, any>;
class MemoryStore implements DataStore {
  rows = new Map<string, Row[]>();
  sequence = 0;
  async getById<T = Record_>(collection: string, id: string) { return (this.rows.get(collection) || []).find(row => row.id === id) as T || null; }
  async create<T = Record_>(collection: string, data: Record<string, unknown>) {
    const bucket = this.rows.get(collection) || [];
    if (bucket.some(row => row.tenant_id === data.tenant_id && row.request_id === data.request_id)) return null;
    const row = { id: `row-${++this.sequence}`, ...structuredClone(data) } as Row; bucket.push(row); this.rows.set(collection, bucket); return row as T;
  }
  async update(collection: string, id: string, data: Record<string, unknown>) { const row = (this.rows.get(collection) || []).find(item => item.id === id); if (!row) return false; Object.assign(row, data); return true; }
  async delete() { return false; }
  async list<T = Record_>(collection: string, query: ListQuery = {}) {
    const items = (this.rows.get(collection) || []).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
    return { items: items as T[], totalItems: items.length, page: 1, perPage: query.perPage || 20, totalPages: 1 };
  }
}

assert.deepEqual(socialHeyGenBridgeReadiness({ enabled: 'false', generationEnabled: 'true', apiKey: 'key', storageReady: true,
  budget: { allowed: true, reservationCny: 1, reason: '' } }), { ready: false, reasons: ['SOCIAL_CONTENT_HEYGEN_ENABLED'] });
assert.deepEqual(socialHeyGenBridgeReadiness({ enabled: 'true', generationEnabled: 'true', apiKey: 'key', storageReady: true,
  budget: { allowed: false, reservationCny: 1, reason: '预算余额不足，已禁止新付费任务；已有任务仍可刷新' } }),
{ ready: true, reasons: [] }, 'budget exhaustion must not disable recovery of an already-paid idempotent task');

assert.deepEqual(auditSocialHeyGenPresenters([
  { id: 'ready', authorized: true, toolMappings: { heygen: { avatarId: 'avatar', voiceId: 'voice' } }, authorizationRef: 'rights', consentRef: 'consent' },
  { id: 'blocked', authorized: true, avatarId: 'avatar' },
]), { total: 2, executable: 1, missingByPresenter: [{ presenterAssetId: 'blocked', requirements: ['HeyGen voiceId', 'authorizationRef', 'consentRef'] }] });

const store = new MemoryStore();
store.rows.set('studio_production_defaults', [{ id: 'defaults', tenant_id: 'tenant-a', payload: { presenters: [{
  id: 'presenter-a', authorized: true, assetVersion: 2, avatarId: 'avatar-a', voiceId: 'voice-a',
  rightsEvidence: { authorizationRef: 'rights://tenant-a/presenter-a/v1', consentRef: 'consent://tenant-a/presenter-a/v1',
    grantedAt: '2026-09-01T00:00:00Z', subjectAdultConfirmed: true, permittedProviders: ['heygen'],
    permittedUses: ['digital_presenter', 'voice_synthesis'] },
}] } }]);
let creates = 0;
let reserves = 0;
const ports = createSocialHeyGenBridgePorts({ store,
  client: {
    async create(_input, requestId) { creates += 1; assert.match(requestId, /^social-presenter:/); return 'provider-task-a'; },
    async status() { return { status: 'completed' as const, url: 'https://files.heygen.ai/output.mp4', duration: 3 }; },
  },
  budget: { status: () => ({ allowed: true, reservationCny: 1.2, remainingCny: 10, reason: '' }), async reserve() { reserves += 1; } },
  storageReady: () => true,
  download: async () => Buffer.alloc(12_000, 1),
  upload: async () => 'https://storage.test/object',
  head: async () => ({ size: 12_000, etag: 'etag-a', contentType: 'video/mp4', lastModified: new Date() }),
  pollIntervalMs: 0,
});
assert.deepEqual(ports.capabilities, {
  methods: ['talking'],
  controls: ['scripted_speech', 'timing_control'],
});
const adapter = createSocialDigitalPresenterAdapter(ports);
const context: any = { tenantId: 'tenant-a', taskId: 'task-a', outputDirectory: tmp,
  shot: { shotId: 'shot-a', sourceStrategy: 'authorized_digital_presenter', sourceRefs: ['presenter-a'],
    digitalHumanPlan: { method: 'talking', presenterAssetIds: ['presenter-a'], executionState: 'ready_for_capability_check' } },
  baselineScene: { narration: '已确认口播' }, availableAssets: [] };
const result = await adapter.execute(context);
assert.equal(result?.asset.providerTaskId, 'provider-task-a');
assert.equal(result?.asset.authorizationRef, 'rights://tenant-a/presenter-a/v1');
assert.equal(creates, 1);
assert.equal(reserves, 1);
assert.equal(store.rows.get('studio_social_presenter_jobs')?.[0]?.status, 'completed');
assert.equal(store.rows.get('studio_social_presenter_jobs')?.[0]?.visual_control?.interaction, 'talking');
assert.equal(store.rows.get('studio_social_presenter_jobs')?.[0]?.visual_control?.precision, 'hook_high');

// The same logical request resumes the recorded supplier task. It may poll and
// verify storage again, but must not create or reserve another paid generation.
await adapter.execute(context);
assert.equal(creates, 1);
assert.equal(reserves, 2); // budget ledger reserve is itself idempotent by request key

// Legacy bad speech is recovery-only: the original provider task remains
// queryable, while a new visual-only input cannot create or reserve anything.
const beforeRecoveryCreates = creates, beforeRecoveryReserves = reserves;
const legacyContext = { ...context, baselineScene: { narration: '', voiceover: '', script: '已确认口播' } };
const acceptedRow = store.rows.get('studio_social_presenter_jobs')![0]!;
acceptedRow.status = 'pending';
const legacyRecovered = await adapter.execute(legacyContext);
assert.equal(legacyRecovered?.asset.providerTaskId, 'provider-task-a');
assert.equal(creates, beforeRecoveryCreates); assert.equal(reserves, beforeRecoveryReserves);
await assert.rejects(adapter.execute({ ...legacyContext, baselineScene: { narration: '', script: '全新导演动作，不能作口播' } }), /spoken_text_required|accepted_provider_job_required_for_recovery/);
assert.equal(creates, beforeRecoveryCreates); assert.equal(reserves, beforeRecoveryReserves);
const priorProviderId = acceptedRow.provider_task_id; acceptedRow.provider_task_id = '';
await assert.rejects(adapter.execute(legacyContext), /accepted_provider_job_required_for_recovery/);
assert.equal(creates, beforeRecoveryCreates); acceptedRow.provider_task_id = priorProviderId;
const priorTask = acceptedRow.task_id; acceptedRow.task_id = 'foreign-task';
await assert.rejects(adapter.execute(legacyContext), /accepted_provider_job_scope_changed/);
assert.equal(creates, beforeRecoveryCreates); acceptedRow.task_id = priorTask;
const providerRows = store.rows.get('studio_social_presenter_jobs')!;
providerRows.push({ ...acceptedRow, id: 'conflicting-accepted-record' });
await assert.rejects(adapter.execute(legacyContext), /duplicate_provider_job_records/);
assert.equal(creates, beforeRecoveryCreates); assert.equal(reserves, beforeRecoveryReserves);
providerRows.pop();


const rules = {recordHash:'a'.repeat(64),audience:['采购'],pillars:['证据'],recurringFormats:[],conversionRoute:{routeId:'route',entryType:'whatsapp' as const,entryRef:'contact',callToAction:'咨询',qualificationFields:[],handoffTarget:null,verifiedAt:null},evidenceRules:['真实参数'],visualRules:[],languageRules:['中文'],presenterRules:['已授权人物'],fixedFactors:[],experimentFactors:[]};
context.accountPlaybookConstraints=freezeSocialAccountProductionConstraints({targetAccountRef:{objectType:'owned_social_account',id:'account',version:'1'},accountPlaybookRef:{objectType:'account_playbook',id:'playbook',version:'1',accountRef:'account'},verifiedAccountPlaybook:rules});
await adapter.execute(context);
assert.equal(creates,2);
const ruleRow=store.rows.get('studio_social_presenter_jobs')![1]!;
const originalConstraints=ruleRow.visual_control.accountPlaybookConstraints;
ruleRow.visual_control.accountPlaybookConstraints=Object.fromEntries(Object.entries(originalConstraints).reverse());
ruleRow.visual_control.accountPlaybookConstraints.rules=Object.fromEntries(Object.entries(originalConstraints.rules).reverse());
await adapter.execute(context);
assert.equal(creates,2,'same canonical rules recover original provider job without POST');
ruleRow.visual_control.accountPlaybookConstraints.rules.languageRules=['changed actual content'];
await assert.rejects(adapter.execute(context),/uncertain:.*digital_presenter_account_constraints_changed/);
assert.equal(creates,2,'drift never creates another provider job');

// Server-owned, verified audio adoption uses IV and never forwards text TTS.
const audioScript = 'Beauty brand owners: stop guessing your next product launch.';
const audioContext = { ...context, accountPlaybookConstraints: undefined, baselineScene: { narration: audioScript } };
const audio = { tenantId: 'tenant-a', taskId: 'task-a', taskVersion: 'revision-2', shotId: 'shot-a',
  presenterAssetId: 'presenter-a', presenterAssetVersion: 2, providerAvatarId: 'avatar-a', voiceId: 'voice-a',
  scriptSha256: createHash('sha256').update(audioScript).digest('hex'), clipSha256: 'a'.repeat(64), durationSeconds: 3.6,
  receiptRef: 'server-tts-receipt', receiptHash: 'b'.repeat(64), audioAssetId: 'uploaded-audio', engine: 'avatar_iv' as const, operationRole: 'hook' as const };
let audioCreates = 0, audioReserves = 0, resolves = 0, verified = true, incoming: any;
const audioPorts = createSocialHeyGenBridgePorts({ store,
  speechAudio: { resolve: async () => { resolves++; return structuredClone(audio); }, verify: async (_request, candidate) => verified && candidate.taskVersion === 'revision-2' },
  client: { create: async input => { audioCreates++; incoming = input; return 'audio-driven-task'; }, status: async () => ({ status: 'completed', url: 'https://files.heygen.ai/audio.mp4', duration: 3.6 }) },
  budget: { status: () => ({ allowed: true, reservationCny: 1, remainingCny: 10, reason: '' }), reserve: async () => { audioReserves++; } },
  storageReady: () => true, download: async () => Buffer.alloc(12000, 2), upload: async () => 'https://storage.test/audio',
  head: async () => ({ size: 12000, etag: 'audio-etag', contentType: 'video/mp4', lastModified: new Date() }), pollIntervalMs: 0,
});
const audioAdapter = createSocialDigitalPresenterAdapter(audioPorts);
assert.equal((await audioAdapter.execute(audioContext))?.asset.providerTaskId, 'audio-driven-task');
assert.equal(incoming.audioAssetId, 'uploaded-audio'); assert.equal(incoming.engine, 'avatar_iv');
assert.equal(incoming.script, ''); assert.equal(incoming.voiceId, '');
assert.equal(audioCreates, 1); assert.equal(audioReserves, 1);
const audioJob = store.rows.get('studio_social_presenter_jobs')!.find(row => row.provider_task_id === 'audio-driven-task')!;
assert.equal(audioJob.visual_control.speechAudio.clipSha256, audio.clipSha256);
await audioAdapter.execute(audioContext); assert.equal(audioCreates, 1, 'audio replay uses original provider ID');
for (const patch of [{ durationSeconds: 4.01 }, { voiceId: 'other-voice' }, { tenantId: 'foreign' }, { scriptSha256: 'c'.repeat(64) }, { presenterAssetVersion: 3 }]) {
  const guarded = createSocialDigitalPresenterAdapter({ ...audioPorts, resolveSpeechAudio: async () => ({ ...audio, ...patch }) });
  const before: number = audioReserves;
  await assert.rejects(guarded.execute(audioContext), /audio_scope_or_duration_invalid/);
  assert.equal(audioReserves, before); assert.equal(audioCreates, 1);
}
verified = false;
await assert.rejects(audioAdapter.execute(audioContext), /audio_receipt_unverified/); assert.equal(audioCreates, 1);
verified = true;
const beforeResolve = resolves, beforeAudioReserve = audioReserves;
await audioAdapter.execute({ ...audioContext, baselineScene: { narration: '已确认口播' } });
assert.equal(resolves, beforeResolve, 'old accepted text task is recovered before generating new TTS');
assert.equal(audioReserves, beforeAudioReserve); assert.equal(audioCreates, 1);

// Persisted uploads use real decodable WAV bytes, verified sample duration and
// a server-owned receipt reader. This is local contract proof, not cloud TTS.
const samples = Math.round(48000 * 3.6), wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let n = 0; n < samples; n++) wav.writeInt16LE(Math.round(1000 * Math.sin(n * 2 * Math.PI * 220 / 48000)), 44 + n * 2);
const hookPath = path.join(tmp, 'measured-hook.wav'); fs.writeFileSync(hookPath, wav);
const uploadSource = { ...audio, clipSha256: createHash('sha256').update(wav).digest('hex'), filePath: hookPath };
const { audioAssetId: ignoredAsset, ...serverSource } = uploadSource; void ignoredAsset;
const request: any = { tenantId: context.tenantId, taskId: context.taskId, shotId: 'shot-a', idempotencyKey: 'prepared-hook',
  presenter: await audioPorts.resolvePresenter({ tenantId: 'tenant-a', presenterAssetId: 'presenter-a' }), script: audioScript,
  aspectRatio: '9:16', outputDirectory: tmp, maximumCostCny: 2, visualControl: incoming.visualControl };
let uploads = 0, grant = true;
const persistedAudio = createSocialHeyGenHookAudioPort({ store, load: async () => structuredClone(serverSource),
  authorizeUpload: async () => grant, client: { uploadAudio: async bytes => { uploads++; assert.deepEqual(Buffer.from(bytes), wav); return 'real-upload-contract'; } } });
const firstUpload = await persistedAudio.resolve(request); assert.equal(uploads, 1);
assert.equal(await persistedAudio.verify(request, firstUpload), true);
grant = false; assert.equal((await persistedAudio.resolve(request)).audioAssetId, firstUpload.audioAssetId);
assert.equal(uploads, 1, 'saved audio upload survives retry without re-upload or reserve');
fs.writeFileSync(hookPath, Buffer.alloc(wav.length));
await assert.rejects(persistedAudio.resolve(request), /hook_bytes_changed/); assert.equal(uploads, 1); fs.writeFileSync(hookPath, wav);
const longAudio = createSocialHeyGenHookAudioPort({ store, load: async () => ({ ...serverSource, durationSeconds: 3.5 }), authorizeUpload: async () => true, client: { uploadAudio: async () => { throw Error('probe drift must not upload'); } } });
await assert.rejects(longAudio.resolve(request), /probe_duration_invalid/);
let uncertainUploads = 0;
const uncertainAudio = createSocialHeyGenHookAudioPort({ store, load: async () => ({ ...serverSource, receiptRef: 'uncertain-receipt' }), authorizeUpload: async () => true,
  client: { uploadAudio: async () => { uncertainUploads++; throw Error('upload-connection-lost'); } } });
await assert.rejects(uncertainAudio.resolve(request), /upload-connection-lost/);
await assert.rejects(uncertainAudio.resolve(request), /hook_upload_unknown/); assert.equal(uncertainUploads, 1);

// Exercise the concrete persisted speech reader + real bytes/probe mapping.
const { generateMvpHeyGenSpeech } = await import('../lib/mvpHeyGenSpeech.js');
const speechRoot = path.join(tmp, 'mvp-speech');
store.rows.set('starter_social_content_tasks', [{ id: 'task-row', tenant_id: 'tenant-a', task_id: 'task-a', version: '2', run_id: 'audio-run',
  brief: { presenterAssetId: 'presenter-a', requestedPresenterAssetId: 'avatar-a' } }]);
store.rows.set('workflow_runs', [{ id: 'audio-run', tenant_id: 'tenant-a', status: 'running' }]);
const speech = await generateMvpHeyGenSpeech({ scope: { tenantId: 'tenant-a', taskId: 'task-a', version: 2, session: 'A', accountId: null,
  productId: 'product-a', runId: 'audio-run', action: 'generate_media', authority: 'customer', expiresAt: '2099-01-01', revoked: false,
  provider: 'heygen', model: 'starfish', shotIds: ['shot-a'], authorizedBy: 'fixture-reviewer', authorizationRef: 'fixture-grant', budgetPoolId: 'pool-a', budgetLimitCny: 10 },
  shotId: 'shot-a', operationRole: 'hook', voiceId: 'voice-a', text: audioScript, maxDurationSeconds: 4, reservationCny: .2 }, {
  root: speechRoot, apiKey: 'controlled-only', assertCurrentScope: async () => { assert.equal(store.rows.get('starter_social_content_tasks')![0]!.version, '2'); },
  admission: { reserve: async () => null }, legacyBudget: { reserve: async () => undefined }, probe: async () => 3.6,
  fetch: (async (url) => { const address = String(url); if (address.includes('/voices/speech')) return Response.json({ audio_url: 'https://files.heygen.ai/fixture.mp3', duration: 3.6, engine: 'starfish', request_id: 'controlled-speech' });
    if (address.includes('/voices')) return Response.json({ data: [{ voice_id: 'voice-a', available_engines: ['starfish'] }], has_more: false });
    assert.equal(address, 'https://files.heygen.ai/fixture.mp3'); return new Response(wav); }) as typeof fetch,
});
let concreteUploads = 0;
const concrete = createMvpSocialHeyGenHookAudioPort({ store, speechRoot, presenterAssetVersion: 2,
  receiptRef: async () => speech.receiptRef, authorizeUpload: async () => true,
  client: { uploadAudio: async (_bytes, _id, mime) => { concreteUploads++; assert.equal(mime, 'audio/wav'); return 'concrete-mvp-asset'; } } });
const mapped = await concrete.resolve(request); assert.equal(concreteUploads, 1);
assert.equal(await concrete.verify(request, mapped), true);
assert.equal((await concrete.resolve(request)).audioAssetId, mapped.audioAssetId); assert.equal(concreteUploads, 1);
const currentTask = store.rows.get('starter_social_content_tasks')![0]!; currentTask.version = '3';
await assert.rejects(concrete.resolve(request), /mvp_speech_authority_changed/); assert.equal(concreteUploads, 1); currentTask.version = '2';
currentTask.brief.targetAccountRef = { id: 'different-account' };
await assert.rejects(concrete.resolve(request), /mvp_speech_authority_changed/); assert.equal(concreteUploads, 1);
delete currentTask.brief.targetAccountRef;
const currentRun = store.rows.get('workflow_runs')![0]!; currentRun.status = 'paused';
await assert.rejects(concrete.resolve(request), /mvp_speech_authority_changed/); assert.equal(concreteUploads, 1); currentRun.status = 'running';
await assert.rejects(concrete.resolve({ ...request, presenter: { ...request.presenter, providerVoiceId: 'different-voice' } }), /mvp_speech_authority_changed/);
assert.equal(concreteUploads, 1);

store.rows.set('studio_production_defaults', [{ id: 'defaults', tenant_id: 'tenant-a', payload: { presenters: [{
  id: 'presenter-a', authorized: true, avatarId: 'avatar-a', voiceId: 'voice-a', rightsEvidence: {
    authorizationRef: 'rights://tenant-a/presenter-a/v1', consentRef: '', grantedAt: '2026-09-01T00:00:00Z',
    subjectAdultConfirmed: true, permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'] },
}] } }]);
assert.equal(await adapter.execute(context), null);

process.chdir(previousCwd);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('social HeyGen bridge tests passed');
