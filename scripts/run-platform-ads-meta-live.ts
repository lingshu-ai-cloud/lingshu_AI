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
import { withPlatformAdTaskLock, getPlatformAdTask } from '../server/platformAds/tasks.js';
import { reconcileAdExecution } from '../server/platformAds/execution.js';
import { isDeepStrictEqual } from 'node:util';

// Explicit operator-run acceptance, real Meta calls. No activation operation.
const root = path.resolve('tmp/platform-ads-live');
if (process.env.PB_URL !== 'http://127.0.0.1:8891' || adReleasePolicy().mode !== 'paused_only') throw new Error('Requires isolated database 8891 and paused_only policy');
// Runtime state is shared by commands: serialize operators as well as tasks.
const operatorLock = path.join(root, 'acceptance-operator.lock');
const operatorLockFd = fs.openSync(operatorLock, 'wx', 0o600);
fs.writeSync(operatorLockFd, String(process.pid));
process.once('exit', () => { fs.closeSync(operatorLockFd); fs.unlinkSync(operatorLock); });
const credentials = JSON.parse(fs.readFileSync(path.join(root, 'credentials.json'), 'utf8'));
const login = await fetch('http://127.0.0.1:8890/api/overseas/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: credentials.email, password: credentials.password }) });
const session = await login.json() as any;
if (!login.ok || !session.token || !session.user?.tenantId) throw new Error('Isolated application login unavailable');
const tenantId = session.user.tenantId;
const targetAccount = process.env.PLATFORM_ADS_ACCEPTANCE_ACCOUNT || '1306761139191078';
if (!['1306761139191078', '1640686001100669'].includes(targetAccount)) throw new Error('Acceptance account is not authorized for this fixture');
const sandboxRun = targetAccount === '1640686001100669';
const requestSuffix = sandboxRun ? '_sandbox' : '';
const stateFile = path.join(root, sandboxRun ? 'sandbox-run.json' : 'run.json');
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
const connection = connections.find(c => c.provider === 'meta' && c.accountId === targetAccount);
if (!connection || connection.status !== 'connected' || connection.currency !== 'CNY') throw new Error('Verified CNY Meta account required');
state.connectionId = connection.id;
const credential = await getConnectionCredential(tenantId, connection.id);
const adapter = new MetaAdsAdapter(credential.accessToken);
const command = process.argv[2];
if (command === 'repair-ad-page-identity') {
  if (!sandboxRun) throw new Error('Only documented sandbox ads may be repaired');
  for (const [kind, allowedAd] of [['traffic', '120330001417556516'], ['views', '120330001417559616']]) {
    const executionId = state[`${kind}Execution`]?.id, taskId = state[`${kind}TaskId`];
    await withPlatformAdTaskLock(tenantId, taskId, async guard => {
      const receipt = await store.getById<any>('platform_ad_executions', executionId);
      const task = await getPlatformAdTask(tenantId, taskId);
      const resources = { ...receipt?.result };
      if (!task || !receipt || receipt.tenant_id !== tenantId || receipt.taskId !== taskId || receipt.connectionId !== connection.id || receipt.status !== 'VERIFIED' || task.managementMode !== 'manual' || resources.adId !== allowedAd || resources.pageIdentityRepair) throw new Error('Repair receipt changed or already attempted');
      const current = await adapter.request(allowedAd, { fields: 'id,account_id,adset_id,creative,status,issues_info' });
      if (current.account_id !== connection.accountId || current.adset_id !== resources.adsetId || current.creative?.id !== resources.creativeId || current.status !== 'PAUSED' || !current.issues_info?.some((issue: any) => issue.error_code === 2446289)) throw new Error('Ad scope or expected issue changed; no write');
      const guarded = new MetaAdsAdapter(credential.accessToken, fetch, () => guard.beforeEffect());
      const pageAdapter = await guarded.pageCreativeAdapter('1323567870837055');
      const validation = await pageAdapter.request(`act_${connection.accountId}/ads`, { name: task.name, adset_id: resources.adsetId, creative: { creative_id: resources.creativeId }, status: 'PAUSED', execution_options: ['validate_only'] }, 'POST');
      if (validation.success !== true) throw new Error('Page-context ad validation failed');
      await guard.beforeEffect();
      resources.pageIdentityRepair = { phase: 'REQUESTED', actorId: session.user.id, at: new Date().toISOString(), adId: allowedAd };
      await store.update('platform_ad_executions', executionId, { status: 'UNKNOWN', result: resources });
      const checkpoint = await store.getById<any>('platform_ad_executions', executionId);
      if (checkpoint?.status !== 'UNKNOWN' || !isDeepStrictEqual(checkpoint.result, resources)) throw new Error('Repair checkpoint not durable');
      await store.update('platform_ad_tasks', taskId, { status: 'unknown', updatedAt: new Date().toISOString() });
      // Update the existing ad only; no edge creation, no new resource ID.
      await pageAdapter.request(allowedAd, { creative: { creative_id: resources.creativeId }, status: 'PAUSED' }, 'POST');
      const actual = await pageAdapter.request(allowedAd, { fields: 'id,account_id,adset_id,creative,status,effective_status,issues_info' });
      if (actual.id !== allowedAd || actual.account_id !== connection.accountId || actual.status !== 'PAUSED' || actual.adset_id !== resources.adsetId || actual.creative?.id !== resources.creativeId) throw new Error('Updated ad needs manual reconciliation');
      await guard.beforeEffect();
      resources.pageIdentityRepair = { ...resources.pageIdentityRepair, phase: 'ACCEPTED', checkedAt: new Date().toISOString(), effectiveStatus: actual.effective_status, issueCodes: (actual.issues_info || []).map((issue: any) => issue.error_code) };
      if (!await store.update('platform_ad_executions', executionId, { result: resources })) throw new Error('Repair result not saved');
    });
    state[`${kind}Execution`] = await reconcileAdExecution(tenantId, taskId, executionId); save();
    console.log(JSON.stringify({ kind, execution: state[`${kind}Execution`] }));
  }
} else if (command === 'recover-traffic') {
  // Explicit one-off recovery of the documented sandbox permission failure.
  // Never recreate the hierarchy, never retry a checkpoint with an unknown ID.
  if (!sandboxRun || state.trafficTaskId !== 'giln3kkz95vbzll' || state.trafficExecution?.id !== 'o8lfx4eqm6rdzc8') throw new Error('Recovery only permits the documented sandbox receipt');
  const executionId = state.trafficExecution.id;
  await withPlatformAdTaskLock(tenantId, state.trafficTaskId, async guard => {
    const receipt = await store.getById<any>('platform_ad_executions', executionId);
    const task = await getPlatformAdTask(tenantId, state.trafficTaskId);
    if (!task || !receipt || receipt.tenant_id !== tenantId || receipt.taskId !== task.id || receipt.connectionId !== connection.id || task.version !== state.trafficInput.expectedVersion || task.managementMode !== 'manual' || task.status !== 'unknown' || receipt.status !== 'UNKNOWN') throw new Error('Recovery scope or version changed');
    const resources = { ...receipt.result };
    if (resources.campaignId !== '120330001417553916' || resources.adsetId !== '120330001417554616') throw new Error('Recovery hierarchy changed');
    if (resources.creativeId && resources.adId) return; // Read-only reconciliation below.
    if (resources.creativeId || resources.adId || resources.recovery || !receipt.error?.includes('10 / 1341012')) throw new Error('Unknown recovery checkpoint: do not retry provider creation');
    const input = state.trafficInput.meta;
    if (input.pageId !== '1323567870837055' || input.videoId !== resources.creativeVideoId || input.videoId !== state.videoId || resources.creativeBindingId !== state.bindingId || state.videoStatus !== 'ready') throw new Error('Recovery creative changed');
    const campaign = await adapter.request(resources.campaignId, { fields: 'id,account_id,status,objective,spend_cap' });
    const adset = await adapter.request(resources.adsetId, { fields: 'id,account_id,campaign_id,status,daily_budget,optimization_goal,destination_type' });
    if ([campaign, adset].some(item => String(item.account_id) !== connection.accountId || item.status !== 'PAUSED') || String(adset.campaign_id) !== campaign.id || campaign.objective !== 'OUTCOME_TRAFFIC' || adset.optimization_goal !== 'LINK_CLICKS' || adset.destination_type !== 'WEBSITE' || Number(campaign.spend_cap) !== Math.round(task.budget * 100) || Number(adset.daily_budget) !== Math.round(input.dailyBudget * 100)) throw new Error('Existing platform resources changed; no writes allowed');
    const pageAdapter = await adapter.pageCreativeAdapter(input.pageId);
    const creativeParams = { name: `${task.name} · 视频`, object_story_spec: { page_id: input.pageId, video_data: { video_id: input.videoId, image_url: input.imageUrl, message: input.message, call_to_action: { type: 'LEARN_MORE', value: { link: input.linkUrl } } } } };
    const validation = await pageAdapter.request(`act_${connection.accountId}/adcreatives`, { ...creativeParams, execution_options: ['validate_only'] }, 'POST');
    if (validation.success !== true) throw new Error('Creative validation not confirmed');
    const guardedAccount = new MetaAdsAdapter(credential.accessToken, fetch, () => guard.beforeEffect());
    const guardedPage = await guardedAccount.pageCreativeAdapter(input.pageId);
    async function checkpoint(phase: string) {
      await guard.beforeEffect();
      resources.recovery = { phase, requestId: 'sandbox_page_identity_recovery_20261022', actorId: session.user.id, checkedAt: new Date().toISOString() };
      if (!await store.update('platform_ad_executions', executionId, { result: resources })) throw new Error('Recovery checkpoint failed; no retry allowed');
      const persisted = await store.getById<any>('platform_ad_executions', executionId);
      if (!isDeepStrictEqual(persisted?.result, resources)) throw new Error('Recovery checkpoint not durable; no retry allowed');
    }
    await checkpoint('CREATIVE_REQUESTED');
    const creative = await guardedPage.request(`act_${connection.accountId}/adcreatives`, creativeParams, 'POST');
    if (!/^\d+$/.test(String(creative.id || ''))) throw new Error('Creative result unknown; do not retry');
    resources.creativeId = String(creative.id);
    await checkpoint('CREATIVE_ACCEPTED');
    await checkpoint('AD_REQUESTED');
    const ad = await guardedPage.request(`act_${connection.accountId}/ads`, { name: task.name, adset_id: resources.adsetId, creative: { creative_id: resources.creativeId }, status: 'PAUSED' }, 'POST');
    if (!/^\d+$/.test(String(ad.id || ''))) throw new Error('Ad result unknown; do not retry');
    resources.adId = String(ad.id);
    await checkpoint('AD_ACCEPTED');
  });
  state.trafficExecution = await reconcileAdExecution(tenantId, state.trafficTaskId, executionId); save();
  console.log(JSON.stringify({ execution: state.trafficExecution }));
} else if (command === 'validate-creative' || command === 'validate-page-creative') {
  // Official AdCreative.ExecutionOptions.validate_only: validate the exact
  // submitted story without creating resources or bypassing partial receipts.
  const input = state.trafficInput?.meta;
  if (!input || state.videoStatus !== 'ready') throw new Error('Saved traffic input and verified video required');
  const validation: Record<string, unknown> = { accountId: connection.accountId, at: new Date().toISOString(), mode: 'validate_only' };
  try {
    const creativeAdapter = command === 'validate-page-creative' ? await adapter.pageCreativeAdapter(input.pageId) : adapter;
    validation.identity = command === 'validate-page-creative' ? 'page' : 'account';
    validation.result = await creativeAdapter.request(`act_${connection.accountId}/adcreatives`, {
      name: 'Lingshu paused integration creative validation', execution_options: ['validate_only'],
      object_story_spec: { page_id: input.pageId, video_data: { video_id: input.videoId, image_url: input.imageUrl, message: input.message, call_to_action: { type: 'LEARN_MORE', value: { link: input.linkUrl } } } },
    }, 'POST');
  } catch (error) { validation.error = error instanceof Error ? error.message : 'Validation failed'; }
  state.creativeValidation = validation; save(); console.log(JSON.stringify(validation));
} else if (command === 'diagnose') {
  const diagnostics: Record<string, unknown> = { accountId: connection.accountId, at: new Date().toISOString() };
  for (const [key, resource, fields] of [
    ['account', `act_${connection.accountId}`, 'id,account_id,name,currency,account_status'],
    ['page', '1323567870837055', 'id,name'],
    ['promotePages', `act_${connection.accountId}/promote_pages`, 'id,name'],
  ]) {
    try { diagnostics[key] = await adapter.request(resource, { fields }); }
    catch (error) { diagnostics[key] = { error: error instanceof Error ? error.message : 'Read failed' }; }
  }
  state.diagnostics = diagnostics; save(); console.log(JSON.stringify(diagnostics));
} else if (command === 'prepare') {
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
    const result = await api('/tasks', { name: `LS API test 20261022 · Traffic${sandboxRun ? ' · Sandbox' : ''} · PAUSED`, video: 'Original integration test clip', market: 'US', goal: '提升网站访问', currency: connection.currency, budget: sandboxRun ? 500 : 100, channels: ['Facebook'], configuration: { startsAt: '', endsAt: '', dailyBudget: 50, audience: 'US adults; API integration test only', placements: '' } });
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
  const result = await api(`/tasks/${state.trafficTaskId}/creatives/${state.bindingId}/upload`, { expectedVersion: state.trafficVersion, requestId: `meta_live_original_upload_20261022${requestSuffix}` });
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
    const result = await api('/tasks', { name: `LS API test 20261022 · ThruPlay${sandboxRun ? ' · Sandbox' : ''} · PAUSED`, video: 'Original integration test clip', market: 'US', goal: '提升有效视频观看', currency: connection.currency, budget: 500, channels: ['Facebook'], configuration: { startsAt: '', endsAt: '', dailyBudget: 50, audience: 'US adults; API integration test only', placements: '' } });
    state.viewsTaskId = result.task.id; save();
  }
  const taskId = state[`${kind}TaskId`];
  const { task } = await api(`/tasks/${taskId}`);
  const attempt = state[`${kind}Attempt`] || 1;
  const input = { expectedVersion: task.version, requestId: `meta_live_${kind}_create_20261022${requestSuffix}${attempt > 1 ? `_retry${attempt}` : ''}`, action: 'create', connectionId: connection.id, ...(kind === 'traffic' ? { creativeId: state.bindingId } : {}), meta: { pageId: '1323567870837055', videoId: state.videoId, imageUrl: state.imageUrl, linkUrl: 'https://www.facebook.com/61594448934963/', message: 'Lingshu API integration test. Test ad must remain paused.', countries: ['US'], dailyBudget: 50 } };
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
    for (const [type, fields] of Object.entries({ campaignId: 'id,name,account_id,status,effective_status,objective,spend_cap', adsetId: 'id,name,account_id,campaign_id,status,effective_status,daily_budget,optimization_goal,billing_event,destination_type,targeting', creativeId: 'id,name,account_id,object_story_spec', adId: 'id,name,account_id,adset_id,status,effective_status,creative,issues_info' })) {
      if (ids[type]) records[type] = await adapter.request(ids[type], { fields });
    }
    for (const type of ['campaignId', 'adsetId', 'adId']) if (records[type] && records[type].status !== 'PAUSED') throw new Error(`${kind} ${type} is not paused`);
    if (Object.values(records).some(record => String(record.account_id) !== connection.accountId)) throw new Error('Readback account mismatch');
    if (records.adsetId && String(records.adsetId.campaign_id) !== ids.campaignId) throw new Error('Readback campaign relationship mismatch');
    if (records.adId && (String(records.adId.adset_id) !== ids.adsetId || String(records.adId.creative?.id) !== ids.creativeId)) throw new Error('Readback ad relationship mismatch');
    if (execution.status === 'VERIFIED' && Object.keys(records).length !== 4) throw new Error('Verified creation is missing a resource');
    if (execution.status === 'VERIFIED') {
      const story = records.creativeId.object_story_spec;
      const planned = state[`${kind}Input`].meta;
      if (story?.page_id !== planned.pageId || story?.video_data?.video_id !== planned.videoId) throw new Error('Readback Page/video mismatch');
      if (kind === 'traffic' && story.video_data.call_to_action?.value?.link !== planned.linkUrl) throw new Error('Readback landing page mismatch');
      if (records.campaignId.objective !== (kind === 'traffic' ? 'OUTCOME_TRAFFIC' : 'OUTCOME_ENGAGEMENT') || records.adsetId.optimization_goal !== (kind === 'traffic' ? 'LINK_CLICKS' : 'THRUPLAY') || records.adsetId.destination_type !== (kind === 'traffic' ? 'WEBSITE' : 'ON_VIDEO') || records.adsetId.billing_event !== 'IMPRESSIONS' || Number(records.adsetId.daily_budget) !== Math.round(planned.dailyBudget * 100)) throw new Error('Readback objective or budget mismatch');
    }
    state[`${kind}Readback`] = { at: new Date().toISOString(), records }; save();
    console.log(JSON.stringify({ kind, executionStatus: execution.status, records }));
    if (records.adId?.issues_info?.some((issue: any) => issue.error_type === 'HARD_ERROR')) throw new Error('Platform reports a hard ad issue; creation IDs alone do not pass acceptance');
  }
  const sync = await api(`/connections/${connection.id}/resources/sync`, {});
  console.log(JSON.stringify({ resourceSync: sync })); state.resourceSync = sync; save();
} else throw new Error('Choose prepare, upload, video-status, create-traffic, create-views or readback');
