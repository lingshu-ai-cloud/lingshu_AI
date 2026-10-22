import '../server/loadEnvironment.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { store } from '../server/storage/index.js';
import { storeSocialContentFile } from '../server/starter198/socialContentFiles.js';
import { listConnections, getConnectionCredential } from '../server/platformAds/connections.js';
import { MetaAdsAdapter } from '../server/platformAds/metaAdapter.js';
import { adReleasePolicy } from '../server/platformAds/releasePolicy.js';

// Explicit operator-run acceptance, real Meta calls. No activation operation.
const root = path.resolve('tmp/platform-ads-live');
if (process.env.PB_URL !== 'http://127.0.0.1:8891' || adReleasePolicy().mode !== 'paused_only') throw new Error('Requires isolated database 8891 and paused_only policy');
const credentials = JSON.parse(fs.readFileSync(path.join(root, 'credentials.json'), 'utf8'));
const login = await fetch('http://127.0.0.1:8890/api/overseas/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: credentials.email, password: credentials.password }) });
const session = await login.json() as any;
if (!login.ok || !session.token || !session.user?.tenantId) throw new Error('Isolated application login unavailable');
const tenantId = session.user.tenantId;
const stateFile = path.join(root, 'run.json');
const state: Record<string, any> = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { tenantId, startedAt: new Date().toISOString() };
if (state.tenantId !== tenantId) throw new Error('Acceptance tenant changed');
function save() { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 }); }
async function api(endpoint: string, body?: unknown, method?: 'PATCH') {
  const response = await fetch(`http://127.0.0.1:8890/api/overseas/platform-ads${endpoint}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(150_000) });
  const result = await response.json() as any;
  if (!response.ok) throw new Error(`${endpoint}: ${result.error || response.status}`);
  return result;
}
const connections = await listConnections(tenantId);
const connection = connections.find(c => c.provider === 'meta' && c.accountId === '1306761139191078');
if (!connection || connection.status !== 'connected' || connection.currency !== 'CNY') throw new Error('Verified CNY Meta account required');
state.connectionId = connection.id;
const credential = await getConnectionCredential(tenantId, connection.id);
const adapter = new MetaAdsAdapter(credential.accessToken);
const command = process.argv[2];
if (command === 'prepare') {
  if (!state.artifactId) {
    if (!ffmpeg) throw new Error('Installed ffmpeg unavailable');
    const clip = path.join(root, 'integration-test.mp4');
    // Original neutral test media, no product claims or third-party footage.
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x2563eb:s=720x1280:r=30', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-vf', 'drawbox=x=60:y=480:w=600:h=320:color=white:t=8', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', clip]);
    const media = await storeSocialContentFile({ stream: fs.createReadStream(clip), tenantId, name: 'Meta integration test - keep paused.mp4', mimeType: 'video/mp4', declaredLength: fs.statSync(clip).size });
    const sourceTaskId = 'meta-live-integration-20261022';
    const fileId = `socialfile_${createHash('sha256').update(tenantId + media.sha256).digest('hex').slice(0, 24)}`;
    const now = new Date().toISOString(), operationId = 'meta-live-fixture-20261022';
    const audit = { last_operation_id: operationId, created_by: session.user.id, updated_by: session.user.id, created_at: now, updated_at: now };
    if (!(await store.list('starter_social_content_tasks', { where: { tenant_id: tenantId, task_id: sourceTaskId } })).items.length) {
      await store.create('starter_social_content_tasks', { ...audit, tenant_id: tenantId, task_id: sourceTaskId, status: 'draft', version: '1', brief: { title: 'Meta paused integration test', objective: 'Original synthetic media for paused API acceptance only' }, package_selection: [{ kind: 'integration_fixture' }], create_idempotency_key: operationId, create_request_hash: media.sha256 });
    }
    const file = (await store.list('starter_social_content_files', { where: { tenant_id: tenantId, file_id: fileId } })).items[0] || await store.create('starter_social_content_files', { ...audit, tenant_id: tenantId, task_id: sourceTaskId, file_id: fileId, usage: 'artifact_media', byte_size: media.byteSize, content_sha256: media.sha256, name: media.name, mime_type: media.mimeType, storage_kind: media.storageKind, storage_key: media.storageKey });
    if (!file) throw new Error('Test media persistence failed');
    const artifactId = 'meta-live-original-test-video';
    const artifact = (await store.list('starter_social_content_artifacts', { where: { tenant_id: tenantId, task_id: sourceTaskId, artifact_id: artifactId } })).items[0] || await store.create('starter_social_content_artifacts', { ...audit, tenant_id: tenantId, task_id: sourceTaskId, artifact_id: artifactId, status: 'draft', origin: 'manual', artifact_kind: 'short_video', platform: 'facebook', language: 'en', resource_ref: `socialfile:${fileId}`, version: '1', content_hash: media.sha256, created_operation_id: operationId });
    if (!artifact) throw new Error('Test artifact persistence failed');
    state.artifactId = artifactId; state.sourceTaskId = sourceTaskId; state.mediaSha256 = media.sha256; save();
  }
  if (!state.trafficTaskId) {
    const result = await api('/tasks', { name: 'LS API test 20261022 · Traffic · PAUSED', video: 'Original integration test clip', market: 'US', goal: '提升网站访问', currency: 'CNY', budget: 100, channels: ['Facebook'], configuration: { startsAt: '', endsAt: '', dailyBudget: 50, audience: 'US adults; API integration test only', placements: '' } });
    state.trafficTaskId = result.task.id; save();
  }
  if (!state.bindingId) {
    const { task } = await api(`/tasks/${state.trafficTaskId}`);
    const bound = await api(`/tasks/${task.id}/creatives`, { expectedVersion: task.version, sourceTaskId: state.sourceTaskId, artifactId: state.artifactId, connectionId: connection.id });
    state.bindingId = bound.creative.id; state.trafficVersion = bound.taskVersion; save();
  }
  console.log(JSON.stringify({ tenantId, trafficTaskId: state.trafficTaskId, bindingId: state.bindingId, mediaSha256: state.mediaSha256 }));
} else if (command === 'repair-budget') {
  if (state.trafficExecution?.status !== 'FAILED' || state.trafficExecution?.resourceId) throw new Error('Budget repair requires a definitive failure with no created campaign');
  const { task } = await api(`/tasks/${state.trafficTaskId}`);
  const { task: updated } = await api(`/tasks/${task.id}`, { ...task, expectedVersion: task.version, budget: 500 }, 'PATCH');
  const bound = await api(`/tasks/${task.id}/creatives`, { expectedVersion: updated.version, sourceTaskId: state.sourceTaskId, artifactId: state.artifactId, connectionId: connection.id });
  if (bound.creative.status !== 'ready' || bound.creative.platformVideoId !== state.videoId) throw new Error('Verified source upload was not preserved');
  state.trafficVersion = bound.taskVersion; state.trafficAttempt = (state.trafficAttempt || 1) + 1; save();
  console.log(JSON.stringify({ taskId: task.id, version: bound.taskVersion, budget: 500, currency: 'CNY', videoReused: true }));
} else if (command === 'upload') {
  const result = await api(`/tasks/${state.trafficTaskId}/creatives/${state.bindingId}/upload`, { expectedVersion: state.trafficVersion, requestId: 'meta_live_original_upload_20261022' });
  console.log(JSON.stringify(result)); state.upload = result; save();
} else if (command === 'video-status') {
  const result = await api(`/tasks/${state.trafficTaskId}/creatives/${state.bindingId}/reconcile`, {});
  const creative = result.creative || result;
  state.videoId = creative.platformVideoId; state.videoStatus = creative.status; save();
  if (state.videoId) {
    const video = await adapter.request(state.videoId, { fields: 'id,status,picture,thumbnails' });
    const cover = video.thumbnails?.data?.find((item: any) => item.is_preferred) || video.thumbnails?.data?.[0];
    state.imageUrl = cover?.uri || video.picture || ''; save();
  }
  console.log(JSON.stringify({ videoId: state.videoId, status: state.videoStatus, thumbnailAvailable: !!state.imageUrl }));
} else if (command === 'create-traffic' || command === 'create-views') {
  if (state.videoStatus !== 'ready' || !state.imageUrl) throw new Error('Verified video and platform thumbnail required');
  const kind = command === 'create-traffic' ? 'traffic' : 'views';
  if (kind === 'views' && !state.viewsTaskId) {
    const result = await api('/tasks', { name: 'LS API test 20261022 · ThruPlay · PAUSED', video: 'Original integration test clip', market: 'US', goal: '提升有效视频观看', currency: 'CNY', budget: 500, channels: ['Facebook'], configuration: { startsAt: '', endsAt: '', dailyBudget: 50, audience: 'US adults; API integration test only', placements: '' } });
    state.viewsTaskId = result.task.id; save();
  }
  const taskId = state[`${kind}TaskId`];
  const { task } = await api(`/tasks/${taskId}`);
  const attempt = state[`${kind}Attempt`] || 1;
  const input = { expectedVersion: task.version, requestId: `meta_live_${kind}_create_20261022${attempt > 1 ? `_retry${attempt}` : ''}`, action: 'create', connectionId: connection.id, ...(kind === 'traffic' ? { creativeId: state.bindingId } : {}), meta: { pageId: '1323567870837055', videoId: state.videoId, imageUrl: state.imageUrl, linkUrl: 'https://www.facebook.com/61594448934963/', message: 'Lingshu API integration test. Test ad must remain paused.', countries: ['US'], dailyBudget: 50 } };
  state[`${kind}Input`] = input; save();
  const preflight = await api(`/tasks/${taskId}/preflight`, input);
  if (!preflight.canSubmit) { console.log(JSON.stringify(preflight)); throw new Error('Preflight blocked; no provider creation attempted'); }
  const result = await api(`/tasks/${taskId}/execute`, input);
  state[`${kind}Execution`] = result.execution; save();
  console.log(JSON.stringify(result));
  if (result.execution?.status !== 'VERIFIED') throw new Error('Creation is not verified. Preserve the receipt and reconcile; do not create another request.');
} else if (command === 'readback') {
  for (const kind of ['traffic', 'views']) {
    const execution = state[`${kind}Execution`];
    if (!execution?.result?.campaignId) continue;
    const ids = execution.result;
    const records: Record<string, any> = {};
    for (const [type, fields] of Object.entries({ campaignId: 'id,name,account_id,status,effective_status,objective,spend_cap', adsetId: 'id,name,account_id,campaign_id,status,effective_status,daily_budget,optimization_goal,billing_event,destination_type,targeting', creativeId: 'id,name,account_id,object_story_spec', adId: 'id,name,account_id,adset_id,status,effective_status,creative' })) {
      if (ids[type]) records[type] = await adapter.request(ids[type], { fields });
    }
    for (const type of ['campaignId', 'adsetId', 'adId']) if (records[type] && records[type].status !== 'PAUSED') throw new Error(`${kind} ${type} is not paused`);
    state[`${kind}Readback`] = { at: new Date().toISOString(), records }; save();
    console.log(JSON.stringify({ kind, executionStatus: execution.status, records }));
  }
  const sync = await api(`/connections/${connection.id}/resources/sync`, {});
  console.log(JSON.stringify({ resourceSync: sync })); state.resourceSync = sync; save();
} else throw new Error('Choose prepare, upload, video-status, create-traffic, create-views or readback');
