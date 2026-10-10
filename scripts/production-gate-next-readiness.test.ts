import test from 'node:test';
import assert from 'node:assert/strict';
import { probeWeeklyProductionEnvironment } from '../server/socialPrograms/weeklyProductionEnvironmentProbe.js';
import { instagramLoginOAuthScopes } from '../server/lib/socialOAuthScopes.js';
import { refreshPlatformCapabilityEvidence } from '../server/publishing/platformCapabilities.js';
import type { DataStore } from '../server/storage/datastore.js';

test('offline absent configuration retains nine blockers and six unobserved evidence requirements', async () => {
  const report = await probeWeeklyProductionEnvironment({env:{}, atomicStore:()=>false, queue:async()=>{throw Error('offline');}});
  assert.equal(report.ready,false);
  assert.equal(report.checks.filter(c=>!c.ready).length,9);
  assert.equal(report.runtimeEvidenceRequired.length,6);
});

test('configured admission with simulated infrastructure does not verify the six tenant effects', async () => {
  const report = await probeWeeklyProductionEnvironment({env:{DATA_BACKEND:'postgres',DATABASE_URL:'fixture',QUEUE_BACKEND:'bullmq',REDIS_URL:'fixture',DISABLE_LOCAL_AUTH_FALLBACK:'true',META_SOCIAL_APP_ID:'fixture',META_SOCIAL_APP_SECRET:'fixture',INSTAGRAM_APP_ID:'fixture',INSTAGRAM_APP_SECRET:'fixture',INSTAGRAM_CONTENT_PUBLISH_ENABLED:'true',TIKTOK_CLIENT_KEY:'fixture',TIKTOK_CLIENT_SECRET:'fixture',TIKTOK_DIRECT_POST_RELEASE_MODE:'approved'},atomicStore:()=>true,queue:async()=>{}});
  assert.equal(report.ready,true);
  assert.equal(report.runtimeEvidenceRequired.length,6);
});

test('Instagram Login without a native capability adapter fails closed before any legacy provider call', async () => {
  const scopes=instagramLoginOAuthScopes({INSTAGRAM_CONTENT_PUBLISH_ENABLED:'true'});
  assert.ok(scopes.includes('instagram_business_content_publish'));
  assert.ok(!scopes.includes('instagram_content_publish'));
  const rows:Record<string,unknown>[]=[];
  // Even a mixed scope record must not send an Instagram Login token to the legacy host.
  const dataStore={getById:async()=>({id:'ig',tenantId:'tenant',platform:'instagram',oauthProvider:'instagram_login',status:'connected',providerAccountId:'ig-user',scope:[...scopes,'instagram_content_publish'].join(' ')}),list:async()=>({items:rows,totalItems:rows.length,totalPages:1,page:1,perPage:20}),create:async(_collection:string,data:Record<string,unknown>)=>{const row={id:'evidence',...data};rows.push(row);return row;},update:async()=>true} as unknown as DataStore;
  let providerCalls=0;
  const forbidden=async()=>{providerCalls++;throw Error('forbidden_offline_provider');};
  const evidence=await refreshPlatformCapabilityEvidence({tenantId:'tenant',accountId:'ig',platform:'instagram',capability:'publishing.official',dataStore,providers:{youtube:forbidden,facebook:forbidden,instagram:forbidden,tiktok:forbidden,tiktokReceipt:forbidden}});
  assert.equal(evidence.status,'unavailable');
  assert.equal(evidence.reason_code,'instagram_login_capability_probe_unavailable');
  assert.equal(providerCalls,0);
});
