import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-execution-'));
process.env.LOCAL_STORE_DIR = dir;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
// Isolated test JSON records and mocked provider calls only.
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';
process.env.META_ADS_API_VERSION = 'v25.0';
const originalFetch = globalThis.fetch;
try {
  const { store } = await import('../storage/index.js');
  const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
  const { createPlatformAdTask } = await import('./tasks.js');
  const { executeAdAction, reconcileAdExecution, listAdExecutions, AD_EXECUTIONS } = await import('./execution.js');
  const task = await createPlatformAdTask('t1', 'u1', { name: 'Test', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] });
  const connection = await store.create<any>('platform_ad_connections', { tenant_id: 't1', provider: 'meta', accountId: '1', status: 'connected', currency: 'USD', tokenCipher: encryptSecret('secret') });
  let writes = 0;
  let corrupt = false;
  let mutateReadback: ((data: Record<string,any>) => void) | undefined;
  const saved: Record<string, any> = {};
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://graph.facebook.com/')) return originalFetch(url, init);
    if (new URL(String(url)).searchParams.get('fields') === 'id,access_token') return Response.json({ id: '1', access_token: 'test-page-token' });
    if (init.method === 'POST') { const id = String(100 + ++writes); saved[id] = Object.fromEntries(new URLSearchParams(init.body)); return Response.json({ id }); }
    const id = new URL(String(url)).pathname.split('/').pop()!;
    const data = { ...saved[id] }; for (const k of ['creative', 'object_story_spec', 'targeting']) if (data[k]) data[k] = JSON.parse(data[k]);
    if (data.creative?.creative_id) data.creative = { id: data.creative.creative_id };
    if (corrupt && data.object_story_spec?.video_data) data.object_story_spec.video_data.video_id = '999';
    const response = { ...data, id, status: 'PAUSED', account_id: '1', currency: 'USD', account_status: 1, daily_budget: '500' };
    mutateReadback?.(response);
    return Response.json(response);
  }) as typeof fetch;
  const staleTask = await createPlatformAdTask('t1', 'u1', { name: 'Stale AI plan', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] }, {
    creationSource: 'ai_assisted',
    proposal: {
      rationale: '待复核方案', audienceStrategy: '待核验受众', creativeStrategy: '待核验素材',
      risks: ['待核验'], assumptions: ['待核验'], expectedOutcome: '暂不可预测', generatedAt: new Date().toISOString(),
      enterpriseFactVersion: 'enterprise-facts-stale',
    },
  });
  await assert.rejects(executeAdAction('t1', staleTask.id, {
    requestId: 'stale_fact_request', expectedVersion: staleTask.version, connectionId: connection.id, action: 'create',
    meta: { pageId: '1', videoId: '2', imageUrl: 'https://example.com/a.jpg', linkUrl: 'https://example.com', countries: ['US'], dailyBudget: 5 },
  }), /\u4f01\u4e1a\u8d44\u6599\u5df2\u66f4\u65b0/);
  assert.equal(writes, 0, 'stale enterprise facts must block execution before provider writes');
  const input = { requestId: 'request_1', expectedVersion: task.version, connectionId: connection.id, action: 'create', meta: { pageId: '1', videoId: '2', imageUrl: 'https://example.com/a.jpg', linkUrl: 'https://example.com', countries: ['US'], dailyBudget: 5 } };
  const first = await executeAdAction('t1', task.id, input);
  assert.equal(first.status, 'VERIFIED');
  assert.equal(writes, 4);
  const immutableSnapshot = (first.result as any).createSnapshot;
  assert.equal(immutableSnapshot.taskVersion, task.version);
  assert.equal(immutableSnapshot.meta.videoId, '2');
  assert.equal(immutableSnapshot.budget, 100);
  const replay = await executeAdAction('t1', task.id, { ...input, expectedVersion: -1 });
  assert.equal(replay.id, first.id);
  assert.equal(writes, 4);
  const previousReleaseMode = process.env.PLATFORM_ADS_RELEASE_MODE;
  try {
    process.env.PLATFORM_ADS_RELEASE_MODE = 'paused_only';
    for (const action of ['activate', 'resume', 'adjust_budget']) {
      await assert.rejects(executeAdAction('t1', task.id, { ...input, requestId: `release_${action}`, action, resourceId: first.resourceId }), /未开放/);
    }
    assert.equal(writes, 4, 'release policy must reject before provider writes');
  } finally { if (previousReleaseMode === undefined) delete process.env.PLATFORM_ADS_RELEASE_MODE; else process.env.PLATFORM_ADS_RELEASE_MODE = previousReleaseMode; }
  await assert.rejects(executeAdAction('t1', task.id, { ...input, requestId: 'request_2' }), /已创建/);
  await assert.rejects(executeAdAction('t2', task.id, input), /未找到/);
  const task2 = await createPlatformAdTask('t1', 'u1', { name: 'Test2', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] });
  const partial = await store.create<any>(AD_EXECUTIONS, { tenant_id: 't1', taskId: task2.id, connectionId: connection.id, requestId: 'uncertain_1', status: 'UNKNOWN', action: 'create', result: { campaignId: '100' } });
  await assert.rejects(reconcileAdExecution('t1', task2.id, partial.id), /部分资源/);
  assert.equal((await store.getById<any>(AD_EXECUTIONS, partial.id))?.status, 'UNKNOWN');
  assert.equal(writes, 4, 'partial-resource reconciliation never recreates missing resources');
  await assert.rejects(executeAdAction('t1', task2.id, input), /核对/);
  assert.equal(writes, 4);
  const old = await createPlatformAdTask('t1', 'u1', { name: 'Old pending', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] });
  await store.create(AD_EXECUTIONS, { tenant_id: 't1', taskId: old.id, requestId: 'old_unknown', status: 'UNKNOWN', action: 'create', createdAt: '2020-01-01' });
  for (let i = 0; i < 201; i++) await store.create(AD_EXECUTIONS, { tenant_id: 't1', taskId: old.id, requestId: `recent_${i}`, status: 'FAILED', action: 'create', createdAt: '2026-10-22' });
  await assert.rejects(executeAdAction('t1', old.id, { ...input, requestId: 'must_not_duplicate', expectedVersion: old.version }), /核对/);
  assert.equal(writes, 4, 'older unresolved receipts beyond page 1 cannot be hidden');
  assert.ok((await listAdExecutions('t1',old.id)).some(receipt => receipt.requestId === 'old_unknown'),'old unresolved receipts remain accessible for manual reconciliation');
  assert.equal((await listAdExecutions('t1',old.id)).length,202);
  assert.deepEqual(await listAdExecutions('t2',old.id),[],'full receipt listing remains tenant isolated');
  const invalid = await createPlatformAdTask('t1', 'u1', { name: 'Invalid future order', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'] });
  await store.update('platform_ad_tasks', invalid.id, { configuration: { ...invalid.configuration, startsAt: new Date(Date.now() + 172800000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() } });
  await assert.rejects(executeAdAction('t1', invalid.id, { ...input, requestId: 'invalid_schedule', expectedVersion: invalid.version }), /结束时间必须/);
  const drift = await createPlatformAdTask('t1', 'u1', { name: 'Mismatch', video: 'video', market: 'US', budget: 100, goal: '提升网站访问', channels: ['Facebook'], configuration: { startsAt: new Date(Date.now()+86400000).toISOString(), endsAt: new Date(Date.now()+172800000).toISOString() } });
  corrupt = true;
  const uncertain = await executeAdAction('t1', drift.id, { ...input, requestId: 'mismatch_readback', expectedVersion: drift.version });
  assert.equal(uncertain.status, 'UNKNOWN'); assert.equal(writes, 8);
  await assert.rejects(executeAdAction('t1', drift.id, { ...input, requestId: 'never_recreate_drift', expectedVersion: drift.version }), /核对/);
  assert.equal(writes, 8, 'mismatched four-level readback keeps resources, never recreates');
  await assert.rejects(reconcileAdExecution('t1', drift.id, uncertain.id), /读回/, 'unresolved video drift cannot be reconciled into a false success');
  assert.equal((await store.getById<any>(AD_EXECUTIONS,uncertain.id)).status,'UNKNOWN');
  assert.equal(writes,8,'reconciliation never corrects drift by creating or updating Meta resources');
  corrupt = false;
  const ids = uncertain.result as Record<string,string>;
  const readbackDrifts: Array<(data:Record<string,any>)=>void> = [
    data=>{if(data.id===ids.campaignId)data.spend_cap='999999';},
    data=>{if(data.id===ids.campaignId)data.objective='OUTCOME_ENGAGEMENT';},
    data=>{if(data.id===ids.adsetId)data.daily_budget='999999';},
    data=>{if(data.id===ids.adsetId)data.start_time='2099-01-01T00:00:00Z';},
    data=>{if(data.id===ids.adsetId)data.end_time='2099-01-02T00:00:00Z';},
    data=>{if(data.id===ids.adsetId)data.targeting.geo_locations.countries=['DE'];},
    data=>{if(data.id===ids.adsetId)data.targeting.publisher_platforms=['instagram'];},
    data=>{if(data.id===ids.creativeId)data.object_story_spec.page_id='999';},
    data=>{if(data.id===ids.creativeId)data.object_story_spec.video_data.call_to_action.value.link='https://wrong.example';},
  ];
  for(const mutate of readbackDrifts){
    mutateReadback=mutate;
    await assert.rejects(reconcileAdExecution('t1',drift.id,uncertain.id),/读回/);
    assert.equal((await store.getById<any>(AD_EXECUTIONS,uncertain.id)).status,'UNKNOWN');assert.equal(writes,8);
  }
  mutateReadback=undefined;
  const noSnapshot = await store.create<any>(AD_EXECUTIONS,{tenant_id:'t1',taskId:task2.id,connectionId:connection.id,requestId:'legacy_full_ids',action:'create',status:'UNKNOWN',result:{campaignId:'101',adsetId:'102',creativeId:'103',adId:'104'}});
  await assert.rejects(reconcileAdExecution('t1',task2.id,noSnapshot.id),/原始执行快照/);
  assert.equal((await store.getById<any>(AD_EXECUTIONS,noSnapshot.id)).status,'UNKNOWN','legacy full IDs without intent cannot claim success');
  // Even an out-of-band local edit must not replace the original executed intent.
  await store.update('platform_ad_tasks',drift.id,{budget:200,version:drift.version+1});
  corrupt = false;
  await assert.rejects(reconcileAdExecution('t2', drift.id, uncertain.id), /未找到/);
  const recovered = await reconcileAdExecution('t1', drift.id, uncertain.id);
  assert.equal(recovered.status, 'VERIFIED');
  assert.equal(writes, 8, 'reconciliation is read-only at the provider');
  assert.deepEqual((recovered.result as any).createSnapshot,(uncertain.result as any).createSnapshot,'reconciliation preserves immutable execution evidence');
  assert.equal((await reconcileAdExecution('t1', drift.id, uncertain.id)).status, 'VERIFIED');
  assert.equal(writes, 8, 'verified receipt reconciliation is idempotent');
  for(let i=0;i<201;i++)await store.create(AD_EXECUTIONS,{tenant_id:'t1',taskId:task.id,connectionId:connection.id,requestId:`later_history_${i}`,action:'pause',status:'FAILED',createdAt:'2099-01-01'});
  const oldCreateRows=await listAdExecutions('t1',task.id);
  assert.equal(oldCreateRows.length,202);assert.ok(oldCreateRows.some(receipt=>receipt.id===first.id),'original create remains accessible after more than 200 later receipts');
  const laterPause=await store.create<any>(AD_EXECUTIONS,{tenant_id:'t1',taskId:task.id,connectionId:connection.id,requestId:'later_pause_unknown',action:'pause',resourceId:first.resourceId,status:'UNKNOWN',createdAt:'2099-02-01'});
  assert.equal((await reconcileAdExecution('t1',task.id,laterPause.id)).status,'VERIFIED','status reconciliation locates the original create beyond page 1');
  assert.equal(writes,8);
  const targeting = { ageMin: 25, ageMax: 55, gender: 'female', locales: [{ id: '6', name: 'English' }], interests: [], customAudiences: [], placementMode: 'manual', facebookPositions: ['feed'], instagramPositions: [] };
  const targeted = await createPlatformAdTask('t1', 'u1', { name: 'Saved targeting', video: 'Video', market: 'CA', budget: 100, goal: '提升网站访问', channels: ['Facebook'], configuration: { metaTargeting: targeting } });
  const targetInput = { ...input, requestId: 'targeting_saved_only', expectedVersion: targeted.version, meta: { ...input.meta, targeting: { ...targeting, gender: 'male', ageMin: 18 } } };
  const targetedReceipt = await executeAdAction('t1', targeted.id, targetInput);
  assert.equal(targetedReceipt.status, 'VERIFIED');
  assert.deepEqual((targetedReceipt.result as any).createSnapshot.meta.targeting, targeting, 'execute cannot override the saved targeting');
  const requested = Object.values(saved).find((r: any) => r.name === 'Saved targeting · 视频');
  assert.deepEqual(JSON.parse(requested.targeting).genders, [2]);
  mutateReadback = data => { if (data.targeting) data.targeting.age_min = 18; };
  const driftedTarget = await createPlatformAdTask('t1', 'u1', { name: 'Target drift', video: 'Video', market: 'CA', budget: 100, goal: '提升网站访问', channels: ['Facebook'], configuration: { metaTargeting: targeting } });
  const targetUnknown = await executeAdAction('t1', driftedTarget.id, { ...targetInput, requestId: 'target_drift', expectedVersion: driftedTarget.version });
  assert.equal(targetUnknown.status, 'UNKNOWN', 'platform targeting drift cannot report success');
  mutateReadback = undefined;
  await store.update('platform_ad_tasks', driftedTarget.id, { configuration: { metaTargeting: { ...targeting, gender: 'male' } }, version: 2 });
  const recoveredTarget = await reconcileAdExecution('t1', driftedTarget.id, targetUnknown.id);
  assert.equal(recoveredTarget.status, 'VERIFIED', 'reconcile uses original saved targeting instead of later draft edits');
  const tikTask = await createPlatformAdTask('t1', 'u1', { name: 'TikTok', video: 'post', market: 'US', budget: 200, goal: '提升有效视频观看', channels: ['TikTok'], configuration: { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 172800000).toISOString() } });
  const tikConnection = await store.create<any>('platform_ad_connections', { tenant_id: 't1', provider: 'tiktok', accountId: '10', status: 'connected', currency: 'USD', tokenCipher: encryptSecret('secret') });
  let tikWrites = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://business-api.tiktok.com/')) return originalFetch(url, init);
    const target = String(url);
    if (init.method === 'POST') { tikWrites++; return Response.json({ code: 0, data: target.includes('/campaign/') ? { campaign_id: '1' } : target.includes('/adgroup/') ? { adgroup_id: '2' } : { ad_ids: ['3'] } }); }
    return Response.json({ code: 0, data: { list: [{ advertiser_id: '10', campaign_id: '1', adgroup_id: '2', ad_id: '3', operation_status: 'DISABLE' }] } });
  }) as typeof fetch;
  const tikInput = { requestId: 'tiktok_req_1', expectedVersion: tikTask.version, connectionId: tikConnection.id, action: 'create', tiktok: { identityId: '12', tiktokItemId: '13', locationIds: ['6252001'], adText: 'Test' } };
  await assert.rejects(executeAdAction('t1', tikTask.id, tikInput), (error: any) => error.code === 'RELEASE_RESTRICTED');
  assert.equal(tikWrites, 0, 'unavailable TikTok cannot create platform ads');
  process.env.GOOGLE_ADS_API_VERSION = 'v25';
  const googleTask = await createPlatformAdTask('t1', 'u1', { name: 'Google', video: 'video', market: 'US', budget: 200, goal: '获取线索或转化', channels: ['YouTube'], configuration: { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 172800000).toISOString() } });
  const googleConnection = await store.create<any>('platform_ad_connections', { tenant_id: 't1', provider: 'google', accountId: '1234567890', status: 'connected', currency: 'USD', tokenCipher: encryptSecret('secret') });
  let googleWrites = 0;
  const base = 'customers/1234567890';
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://googleads.googleapis.com/')) return originalFetch(url, init);
    const body = JSON.parse(init.body);
    if (body.mutateOperations) {
      if (!body.validateOnly) googleWrites++;
      return Response.json({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: `${base}/campaignBudgets/1` } }, { campaignResult: { resourceName: `${base}/campaigns/2` } }, { adGroupResult: { resourceName: `${base}/adGroups/3` } }, { adGroupAdResult: { resourceName: `${base}/adGroupAds/3~4` } }] });
    }
    if (body.query.includes('customer.time_zone')) return Response.json({ results: [{ customer: { timeZone: 'America/Los_Angeles' } }] });
    if (body.query.includes('FROM ad_group_ad')) return Response.json({ results: [{ adGroup: { resourceName: `${base}/adGroups/3`, campaign: `${base}/campaigns/2`, status: 'PAUSED' }, adGroupAd: { resourceName: `${base}/adGroupAds/3~4`, status: 'PAUSED' } }] });
    return Response.json({ results: [{ campaign: { resourceName: `${base}/campaigns/2`, status: 'PAUSED' }, campaignBudget: { totalAmountMicros: '200000000' } }] });
  }) as typeof fetch;
  const googleInput = { requestId: 'google_req_1', expectedVersion: googleTask.version, connectionId: googleConnection.id, action: 'create', google: { targetCpa: 10, videoAssetId: '1', logoAssetId: '2', finalUrl: 'https://example.com', businessName: 'Factory', headline: 'Factory direct', longHeadline: 'Buy from factory', description: 'Request a quote', locationIds: ['2840'] } };
  await assert.rejects(executeAdAction('t1', googleTask.id, googleInput), (error: any) => error.code === 'RELEASE_RESTRICTED');
  assert.equal(googleWrites, 0, 'unavailable Google cannot create platform ads');
  console.log('ad execution tests passed');
} finally { globalThis.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); }
