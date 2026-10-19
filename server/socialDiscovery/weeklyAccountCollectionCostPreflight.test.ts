import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import type {WeeklyAccountCollectionBudgetAuthorization} from './weeklyAccountCollectionBudget.js';
import {APIFY_PUBLIC_PRICING_URL,APIFY_RUN_ACTOR_API_DOC_URL,evaluateWeeklyAccountCollectionAuthenticatedCostFeasibility,prepareWeeklyAccountCollectionPublishedCostPreflight,readWeeklyAccountCollectionFxObservation,readWeeklyAccountCollectionPublishedCostPreflight,type ApifyPublishedCostEvidence} from './weeklyAccountCollectionCostPreflight.js';
import type {WeeklyAccountCollectionProviderEvidence} from './weeklyAccountCollectionProviderEvidence.js';
import {ECB_FX_URL} from '../lib/heygenPublishedPricing.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const pricing=`Dataset Timed storage 1,000 GB-hours $1.00 Dataset 1,000 reads $0.0004 Key-value store 1,000 reads $0.005 Key-value store 1,000 writes $0.05 Key-value store 1,000 lists $0.05 External/GB $0.20`;
const api=`maxTotalChargeUsd Specifies the maximum total cost of the run. Use it to cap the total amount charged for all pricing models.`;
const fx=`<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"><Cube xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube time="2026-10-19"><Cube currency="USD" rate="1.1"/><Cube currency="CNY" rate="7.9"/></Cube></Cube></gesmes:Envelope>`;
const checkedAt='2026-10-19T08:00:00.000Z';
const evidence=():ApifyPublishedCostEvidence=>({schema:'apify-weekly-account-cost-evidence.v1',pricingSourceUrl:APIFY_PUBLIC_PRICING_URL,pricingSourceBody:pricing,pricingSourceSha256:sha(pricing),runApiSourceUrl:APIFY_RUN_ACTOR_API_DOC_URL,runApiSourceBody:api,runApiSourceSha256:sha(api),fxSourceUrl:ECB_FX_URL,fxSourceBody:fx,fxSourceSha256:sha(fx),checkedAt,validUntil:'2026-10-19T14:00:00.000Z'});
const authorization:WeeklyAccountCollectionBudgetAuthorization={schema:'weekly-account-collection-budget.v1',authorizationId:'auth',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7,scopeId:'scope',scopeVersion:3,scopeHash:'a'.repeat(64),accountUrl:'https://www.tiktok.com/@fixture',actorId:'clockworks/tiktok-scraper',totalLimitCny:5,perRunLimitCny:5,approvedBy:'owner',approvedAt:checkedAt,expiresAt:'2026-10-20T00:00:00.000Z',status:'approved',recordHash:'b'.repeat(64)};

test('published sources yield a bounded run URL but deliberately no paid authority',()=>{
 const result=prepareWeeklyAccountCollectionPublishedCostPreflight({authorization,evidence:evidence(),now:new Date('2026-10-19T09:00:00.000Z')});
 assert(result);assert.equal(result.permitsPaidCollection,false);assert(result.modeledTotalCny<=5);
 assert.match(result.actorRunUrl,/maxItems=5&maxTotalChargeUsd=0\./);
 assert.deepEqual(result.remainingRequirements,['verified_account_fx_ceiling','current_actor_minimum_charge_and_pricing','server_enforced_run_cap_receipt','post_run_storage_retention_control']);
 assert(result.modeledNonRunUsd>0,'Dataset reads, metadata transfer and the disclosed retention scenario are included');
 assert.equal(result.modeledUsage.keyValueStoreReads,0);
 assert.equal(result.modeledUsage.modeledTimedStorageGbHours>0,true);
});

test('authenticated account rates prove the direct-Dataset five-yuan path fits without KV video retention',()=>{
 const published=prepareWeeklyAccountCollectionPublishedCostPreflight({authorization,evidence:evidence(),now:new Date('2026-10-19T09:00:00.000Z')});assert(published);
 const provider={schema:'weekly-account-provider-evidence.v2',evidenceId:'provider',authorizationId:authorization.authorizationId,authorizationHash:authorization.recordHash,recordHash:'c'.repeat(64),permitsPaidCollection:false,provider:{accountTier:'BRONZE',minimalMaxTotalChargeUsd:.5,accountServiceRatesUsd:{datasetRead:4e-7,keyValueStoreRead:5e-6,keyValueStoreList:5e-5,datasetTimedStorageGbyteHour:.001,keyValueStoreTimedStorageGbyteHour:.001,externalDataTransferGbyte:.2}},accountLimits:{dataRetentionDays:31}} as WeeklyAccountCollectionProviderEvidence;
 const result=evaluateWeeklyAccountCollectionAuthenticatedCostFeasibility({authorization,providerEvidence:provider,published});
 assert(result);assert.equal(result.dataRetentionDays,31);assert.equal(result.maximumStoredBytes,90_000_000);assert.equal(result.fitsAuthorizedBudget,true);assert.equal(result.reason,'authenticated_cost_fits_observed_scenario');assert(result.availableRunCapUsd>=.5);assert.equal(result.permitsPaidCollection,false);
 const shorter=evaluateWeeklyAccountCollectionAuthenticatedCostFeasibility({authorization,providerEvidence:{...provider,accountLimits:{...provider.accountLimits,dataRetentionDays:1}},published});
 assert(shorter);assert.equal(shorter.fitsAuthorizedBudget,true);
});

test('expired, altered, incomplete, or unaffordable evidence fails closed',()=>{
 const now=new Date('2026-10-19T15:00:00.000Z');
 assert.equal(prepareWeeklyAccountCollectionPublishedCostPreflight({authorization,evidence:evidence(),now}),null);
 let changed=evidence();changed={...changed,pricingSourceBody:changed.pricingSourceBody+' changed'};assert.equal(prepareWeeklyAccountCollectionPublishedCostPreflight({authorization,evidence:changed,now:new Date('2026-10-19T09:00:00.000Z')}),null);
 changed=evidence();changed={...changed,runApiSourceBody:'maxTotalChargeUsd'};changed.runApiSourceSha256=sha(changed.runApiSourceBody);assert.equal(prepareWeeklyAccountCollectionPublishedCostPreflight({authorization,evidence:changed,now:new Date('2026-10-19T09:00:00.000Z')}),null);
 assert.equal(prepareWeeklyAccountCollectionPublishedCostPreflight({authorization:{...authorization,totalLimitCny:.1,perRunLimitCny:.1},evidence:evidence(),now:new Date('2026-10-19T09:00:00.000Z')}),null);
});

test('runtime reader uses only the three exact public sources and still cannot mint a permit',async()=>{
 const calls:string[]=[];
 const result=await readWeeklyAccountCollectionPublishedCostPreflight({authorization,now:()=>new Date(checkedAt),fetchOfficial:async url=>{calls.push(url);return {url,status:200,body:url===APIFY_PUBLIC_PRICING_URL?pricing:url===APIFY_RUN_ACTOR_API_DOC_URL?api:fx};}});
 assert.deepEqual(calls.sort(),[APIFY_PUBLIC_PRICING_URL,APIFY_RUN_ACTOR_API_DOC_URL,ECB_FX_URL].sort());
 assert(result);assert.equal(result.permitsPaidCollection,false);
 const redirected=await readWeeklyAccountCollectionPublishedCostPreflight({authorization,now:()=>new Date(checkedAt),fetchOfficial:async url=>({url:url+'?mirror=1',status:200,body:pricing})});
 assert.equal(redirected,null);
});

test('authenticated pricing path can read ECB independently of the dynamic public pricing page',async()=>{
 const observation=await readWeeklyAccountCollectionFxObservation({authorization,now:()=>new Date(checkedAt),fetchOfficial:async url=>({url,status:200,body:fx})});
 assert(observation);assert.equal(observation.observedCnyPerUsd,7.9/1.1);assert.equal(observation.permitsPaidCollection,false);assert.match(observation.sourceSha256,/^[a-f0-9]{64}$/);
 const redirected=await readWeeklyAccountCollectionFxObservation({authorization,fetchOfficial:async url=>({url:url+'?mirror',status:200,body:fx})});assert.equal(redirected,null);
});
