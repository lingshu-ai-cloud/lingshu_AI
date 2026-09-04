import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import express from 'express';
import ffmpeg from 'ffmpeg-static';
import {DIGITAL_HUMAN_PIPELINE_VERSION} from '../../src/lib/digitalHumanPipeline.js';
import {PERSON_CONSENT_VERSION} from '../../src/lib/personConsentPolicy.js';

// Isolated local HTTP fixture. No real person, provider credential or credits.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-person-assets-'));
const materialsFile = path.join(root, 'materials.json');
let approved = false;
let failed = false;
let createCount = 0;
let renderCount = 0;
let consentCount = 0;
const providerApp = express();
providerApp.use(express.json({limit: '5mb'}));
const look = {id: 'private-look', group_id: 'private-group', status: 'completed', default_voice_id: 'private-voice', supported_api_engines: ['avatar_v']};
providerApp.get('/v3/avatars/looks', (req, res) => res.json({data: req.query.ownership === 'public'
  ? [{...look, id: 'public-look', group_id: 'public-group', name: 'Demo person', default_voice_id: 'public-voice'}]
  : approved ? [look] : []}));
providerApp.get('/v3/avatars/looks/:id', (_req, res) => res.json({data: look}));
providerApp.post('/v3/avatars', (req, res) => {
  createCount++;
  assert.equal(req.body.type, 'digital_twin');
  assert.equal(req.body.file.type, 'base64');
  assert.match(String(req.headers['idempotency-key']), /^[a-f0-9-]{36}$/);
  res.json({data: {avatar_group: {id: 'private-group'}, avatar_item: null}});
});
providerApp.get('/v3/avatars/:id', (_req, res) => res.json({data: {status: failed ? 'failed' : 'completed', consent_status: approved ? 'approved' : 'pending'}}));
providerApp.post('/v3/assets', express.raw({type: () => true, limit: '25mb'}), (req, res) => {
  assert.match(String(req.headers['content-type']), /multipart\/form-data; boundary=/);
  assert.ok(Buffer.isBuffer(req.body));
  assert.ok(req.body.includes(Buffer.from('name="file"')));
  res.json({data: {asset_id: 'consent-asset'}});
});
providerApp.post('/v3/avatars/:id/consent', (req, res) => {
  consentCount++;
  assert.deepEqual(req.body, {consent_video: {type: 'asset_id', asset_id: 'consent-asset'}});
  res.json({data: {avatar_group: {id: 'private-group', consent_status: 'pending'}}});
});
providerApp.post('/v3/videos', (req, res) => {
  renderCount++;
  assert.equal(req.body.avatar_id, 'public-look');
  res.json({data: {video_id: 'mock-render'}});
});
providerApp.get('/v3/videos/:id', (_req, res) => res.json({data: {status: 'pending'}}));
const providerServer = providerApp.listen(0, '127.0.0.1');
await new Promise<void>(resolve => providerServer.once('listening', resolve));
const providerAddress = providerServer.address() as {port: number};
Object.assign(process.env, {
  NODE_ENV: 'test', SUBSCRIPTION_ENFORCED: 'false', DEMO_MODE: 'false',
  DIGITAL_HUMAN_PROVIDER_ROUTING_ENABLED: 'true',
  HEYGEN_CONSENT_VIDEO_UPLOAD_ENABLED: 'false',
  HEYGEN_API_KEY: 'test-only', HEYGEN_API_BASE_URL: `http://127.0.0.1:${providerAddress.port}`,
  STUDIO_MATERIALS_FILE: materialsFile, STUDIO_MEDIA_DIR: path.join(root, 'media'),
  DIGITAL_HUMAN_AVATAR_PREFERENCES_FILE: path.join(root, 'preferences.json'),
  DIGITAL_HUMAN_JOBS_FILE: path.join(root, 'jobs.json'), LINGSHU_LOCAL_STORE_DIR: path.join(root, 'store'),
});
fs.mkdirSync(path.join(root, 'store'), {recursive: true});
fs.writeFileSync(path.join(root, 'store', 'studio_projects.json'), JSON.stringify([{id: 'person-project', tenant_id: 'person-tenant'}]));
const {studioRouter} = await import('./studio.js');
const app = express();
app.use(express.json({limit: '5mb'}));
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as {port: number}).port}/studio`;
async function call(route: string, method = 'GET', body?: unknown, tenantId = 'person-tenant') {
  const token = `local-demo.${Buffer.from(JSON.stringify({userId: 'test-user', tenantId})).toString('base64url')}`;
  const response = await fetch(`${base}${route}`, {method, headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
  return {status: response.status, data: await response.json()};
}
try {
  let result = await call('/digital-human/avatars?includeUnready=1');
  assert.equal(result.status, 200);
  assert.equal(result.data.preferredAvatarMaterialId, 'platform-person-public-look');
  assert.equal(result.data.items[0].productionReady, true);
  assert.deepEqual(result.data.items[0].rightsUsageScope, ['internal_preview']);
  // A platform identity has no uploaded mother file and no preview URL here.
  result = await call('/digital-human/jobs', 'POST', {
    projectId: 'person-project', avatarMaterialId: 'platform-person-public-look', mode: 'quality',
    voiceoverUrl: '/tts/tenants/person-tenant/test.wav', script: '测试人物选择', language: 'zh',
    voiceStrategy: 'person', consentConfirmed: true, usagePurpose: 'internal_preview',
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
  });
  assert.equal(result.status, 202, JSON.stringify(result.data));
  const rendered = await call(`/digital-human/jobs/${result.data.job.id}`);
  assert.equal(renderCount, 1, `platform render must not require an uploaded source video: ${JSON.stringify(rendered.data)}`);

  const fixture = path.join(root, 'synthetic-test.mp4');
  execFileSync(String(ffmpeg), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '16', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', fixture], {windowsHide: true});
  const upload = {name: 'SYNTHETIC TEST ONLY', folder: 'presenter', type: 'video', dataBase64: fs.readFileSync(fixture).toString('base64'), mimeType: 'video/mp4', rightsStatus: 'commercial_cleared', rightsUsageScope: ['internal_preview']};
  result = await call('/materials', 'POST', upload);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const ordinaryId = result.data.material.id;
  assert.equal(result.data.material.assetRole, 'reference_clip');
  assert.equal((await call(`/digital-human/avatars/${ordinaryId}/setup`, 'POST', {action: 'submit_in_app'})).status, 404);
  result = await call('/materials', 'POST', {...upload, sourceType: 'digital-human', assetRole: 'avatar_master'});
  assert.equal(result.data.material.assetRole, 'generated_clip');
  result = await call('/materials', 'POST', {...upload, rightsStatus: 'internal_test', sourceType: 'digital-human-avatar', assetRole: 'avatar_master', providerBindings: {heygen: {avatarId: 'forged', voiceId: 'forged'}}});
  assert.equal(result.status, 201);
  const personId = result.data.material.id;
  assert.equal(result.data.material.providerBindings?.heygen, undefined, 'upload cannot manufacture a trained identity');
  result = await call('/digital-human/avatars?includeUnready=1');
  assert.equal(result.data.items.some((item: any) => item.id === ordinaryId), false);
  assert.equal(result.data.items.find((item: any) => item.id === personId).productionReady, false);
  assert.equal((await call('/digital-human/avatars/preferred', 'PATCH', {preferredAvatarMaterialId: personId})).status, 404);
  const setupRoute = `/digital-human/avatars/${personId}/setup`;
  const submit = {action: 'submit_in_app', consent: {dataBase64: upload.dataBase64, mimeType: 'video/mp4', version: PERSON_CONSENT_VERSION, subjectConfirmed: true, processingConfirmed: true}};
  assert.equal((await call(setupRoute, 'POST', {action: 'create'})).status, 400);
  assert.equal((await call(setupRoute, 'POST', {action: 'consent'})).status, 400, 'hosted consent route is retired');
  assert.equal((await call(setupRoute, 'POST', submit, 'other-tenant')).status, 404);
  assert.equal((await call('/digital-human/person-onboarding')).data.available, false);
  assert.equal((await call(setupRoute, 'POST', submit)).status, 503);
  assert.equal(createCount, 0, 'missing enterprise entitlement must stop before paid creation');
  process.env.HEYGEN_CONSENT_VIDEO_UPLOAD_ENABLED = 'true';
  assert.equal((await call('/digital-human/person-onboarding')).data.available, true);
  assert.equal((await call(setupRoute, 'POST', {...submit, consent: {...submit.consent, subjectConfirmed: false}})).status, 422);
  assert.equal((await call(setupRoute, 'POST', {...submit, consent: {...submit.consent, dataBase64: 'bm90LXZpZGVv'}})).status, 422);
  assert.equal(createCount, 0);
  result = await call(setupRoute, 'POST', submit);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.state, 'consent_review');
  assert.equal(result.data.consentUrl, undefined);
  assert.equal(createCount, 1);
  await call(setupRoute, 'POST', submit);
  assert.equal(createCount, 1, 'repeated click must not train twice');
  assert.equal(consentCount, 1, 'repeated click must not resubmit authorization');
  approved = true;
  assert.equal((await call(setupRoute, 'POST', {action: 'status'})).data.state, 'ready');
  result = await call('/digital-human/avatars?includeUnready=1');
  const ready = result.data.items.find((item: any) => item.id === personId);
  assert.equal(ready.productionReady, true);
  assert.equal(ready.cloudPersonReady, true);
  assert.equal(ready.providerBindings, undefined, 'provider identifiers are server-only');
  assert.equal((await call(`/materials/${personId}`, 'PATCH', {name: 'Attempt', providerBindings: {heygen: {avatarId: 'forged', voiceId: 'forged'}}})).status, 400);
  assert.equal(ready.personSetup.groupId, undefined);
  assert.equal(ready.personSetup.authorization, undefined, 'consent evidence is not returned to browsers');
  assert.equal((await call('/digital-human/avatars/preferred', 'PATCH', {preferredAvatarMaterialId: personId})).status, 200);
  failed = true;
  assert.equal((await call(setupRoute, 'POST', {action: 'status'})).data.state, 'failed');
  result = await call('/digital-human/avatars?includeUnready=1');
  assert.equal(result.data.preferredAvatarMaterialId, personId, 'never silently swap the preferred face');
  assert.equal(result.data.items.find((item: any) => item.id === personId).productionReady, false);
  assert.equal(result.data.items.find((item: any) => item.id === personId).cloudPersonReady, false);
  assert.equal((await call('/digital-human/avatars', 'GET', undefined, 'other-tenant')).data.items.some((item: any) => item.id === personId), false);
  assert.equal(createCount, 1);
  const stored = JSON.parse(fs.readFileSync(materialsFile, 'utf8'));
  const master = stored.find((item: any) => item.id === personId);
  master.personSetup = {requestId: 'uncertain-request', state: 'submitting', updatedAt: '2020-01-01T00:00:00Z'};
  fs.writeFileSync(materialsFile, JSON.stringify(stored));
  assert.equal((await call(setupRoute, 'POST', submit)).status, 409);
  assert.equal(createCount, 1, 'expired idempotency window must require manual reconciliation');
  console.log('person assets HTTP integration passed: platform, upload classification, consent, training, preference, identity lock, tenant isolation; zero paid calls');
} finally {
  server.closeAllConnections(); providerServer.closeAllConnections();
  await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => providerServer.close(() => resolve()))]);
  fs.rmSync(root, {recursive: true, force: true});
}
