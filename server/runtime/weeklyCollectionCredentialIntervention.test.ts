import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyCollectionCredentialIntervention } from './weeklyCollectionCredentialIntervention.js';

test('missing credential is a safe, read-only intervention state', () => {
  const item = weeklyCollectionCredentialIntervention({ APIFY_TIKTOK_CRAWL_FALLBACK_ENABLED: '1' });
  assert.equal(item.status, 'needs_intervention');
  assert.deepEqual(item.blockers, ['采集服务凭据未配置']);
  assert.equal(item.operationallyVerified, false);
  assert.match(item.guidance, /不要在任务卡或聊天中填写 API Key/);
});

test('configured credential is never exposed or treated as operational proof', () => {
  const key = 'private-test-value';
  const item = weeklyCollectionCredentialIntervention({ APIFY_TOKEN: key, APIFY_TIKTOK_CRAWL_FALLBACK_ENABLED: 'true' });
  assert.equal(item.status, 'configuration_present');
  assert.deepEqual(item.blockers, []);
  assert.equal(item.operationallyVerified, false);
  assert.equal(JSON.stringify(item).includes(key), false);
});

test('explicitly disabled TikTok fallback remains blocked, while the default is enabled', () => {
  assert.equal(weeklyCollectionCredentialIntervention({ APIFY_TOKEN: 'private-test-value', APIFY_TIKTOK_CRAWL_FALLBACK_ENABLED: '0' }).status, 'needs_intervention');
  assert.equal(weeklyCollectionCredentialIntervention({ APIFY_TOKEN: 'private-test-value' }).status, 'configuration_present');
});

test('missing credential and missing CNY authorization are shown together without implying a paid permit', () => {
  const item=weeklyCollectionCredentialIntervention({APIFY_TIKTOK_CRAWL_FALLBACK_ENABLED:'1'},'weekly_preproduction_collection_budget_authorization_required');
  assert.equal(item.status,'needs_intervention');
  assert.deepEqual(item.blockers,['采集服务凭据未配置','本周账号采集尚无明确人民币周总额及单次上限授权']);
  const configured=weeklyCollectionCredentialIntervention({APIFY_TOKEN:'secret'},'weekly_preproduction_collection_cost_ceiling_unverified');
  assert.equal(configured.status,'needs_intervention');
  assert.match(configured.blockers.join(''),/额度签发不等于付费许可/);
  assert.equal(configured.blockers.length,4);
  assert.deepEqual(configured.costEvidence,{
    actorRunUpperBound:'unverified',
    postRunDatasetReadAndTransferUpperBound:'unverified',
    usdToCnyUpperBound:'unverified',
    sharedWeeklyReservation:'unverified',
    independentIssuer:'unverified',
    prepaidPurchaseCny:'unverified',
    kvMediaAndNetworkUpperBound:'unverified',
  });
  assert.equal(configured.requiredCostEvidence?.length,4);
  assert.match(configured.requiredCostEvidence?.join('')??'',/maxTotalChargeUsd/);
  assert.match(configured.guidance,/证据哈希或签名回执本身不代表已验证原报价/);
  assert.equal(JSON.stringify(configured).includes('secret'),false);
});

test('fresh public scenario is projected without changing blocker or minting a permit; stale data disappears',()=>{
 const now=Date.parse('2026-10-19T10:00:00.000Z');
 const scenario={schema:'weekly-account-collection-cost-preflight.v1',authorizationId:'auth',authorizationHash:'a'.repeat(64),modeledUsage:{candidateCount:5,maximumMediaBytesPerCandidate:100*1024*1024,datasetReads:1,keyValueStoreReads:0,keyValueStoreLists:0,modeledTimedStorageGbHours:15.12,maximumExternalTransferGb:.09},publishedRatesUsd:{datasetReadsPer1000:.0004,keyValueStoreReadsPer1000:.005,keyValueStoreListsPer1000:.05,timedStoragePer1000GbHours:1,externalTransferPerGb:.2},observedCnyPerUsd:7.18,modeledNonRunUsd:.2,maximumRunChargeUsd:.49,modeledTotalCny:4.954,evidenceRef:'apify-published-cost-preflight:'+'b'.repeat(64),checkedAt:'2026-10-19T09:00:00.000Z',validUntil:'2026-10-19T12:00:00.000Z',actorRunUrl:'https://api.apify.com/v2/actors/clockworks~tiktok-scraper/runs?maxItems=5&maxTotalChargeUsd=0.490000',permitsPaidCollection:false,remainingRequirements:['verified_account_fx_ceiling','current_actor_minimum_charge_and_pricing','server_enforced_run_cap_receipt','post_run_storage_retention_control']} as const;
 const item=weeklyCollectionCredentialIntervention({APIFY_TOKEN:'secret'},'weekly_preproduction_collection_cost_ceiling_unverified',scenario,now);
 assert.equal(item.status,'needs_intervention');assert.equal(item.operationallyVerified,false);assert.equal(item.publishedCostScenario?.modeledCeilingCny,4.954);assert.equal(item.publishedCostScenario?.knownNonActorScenarioCny,1.436);assert.equal(item.publishedCostScenario?.permitsPaidCollection,false);
 assert.equal('actorRunUrl' in item.publishedCostScenario!,false,'the task card does not expose a submit URL');
 assert.equal(weeklyCollectionCredentialIntervention({APIFY_TOKEN:'secret'},'weekly_preproduction_collection_cost_ceiling_unverified',scenario,Date.parse('2026-10-19T12:00:00.000Z')).publishedCostScenario,null);
 assert.equal(weeklyCollectionCredentialIntervention({APIFY_TOKEN:'secret'},'weekly_preproduction_collection_budget_authorization_required',scenario,now).publishedCostScenario,null);
});
