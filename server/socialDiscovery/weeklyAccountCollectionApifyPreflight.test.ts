import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateWeeklyApifyAccountLimits,evaluateWeeklyApifyAgiBalance,evaluateWeeklyApifyPpeResponses,probeWeeklyApifyAccountLimits,probeWeeklyApifyAgiBalance,probeWeeklyApifyPpe} from './weeklyAccountCollectionApifyPreflight.js';

const now='2026-10-19T12:00:00.000Z';
const actorResponse={data:{actorPermissionLevel:'LIMITED_PERMISSIONS',pricingInfos:[
  {startedAt:'2026-10-01T00:00:00.000Z',pricingModel:'PAY_PER_EVENT',minimalMaxTotalChargeUsd:0.1,pricingPerEvent:{actorChargeEvents:{result:{eventTieredPricingUsd:{BRONZE:{tieredEventPriceUsd:0.002},FREE:{tieredEventPriceUsd:0.003}}},start:{eventPriceUsd:0.01}}}},
  {startedAt:'2026-11-01T00:00:00.000Z',pricingModel:'PAY_PER_EVENT',pricingPerEvent:{actorChargeEvents:{result:{eventPriceUsd:99}}}},
]}};
const servicePrices={DATASET_READS:4e-7,KEY_VALUE_STORE_READS:5e-6,KEY_VALUE_STORE_LISTS:5e-5,DATASET_TIMED_STORAGE_GBYTE_HOURS:.001,KEY_VALUE_STORE_TIMED_STORAGE_GBYTE_HOURS:.001,DATA_TRANSFER_EXTERNAL_GBYTES:.2};
const accountResponse={data:{plan:{isEnabled:true,tier:'BRONZE',planPricing:{chargeableServiceUnitPricesUsd:servicePrices}}}};
const evaluate=(actor:unknown=actorResponse,account:unknown=accountResponse)=>evaluateWeeklyApifyPpeResponses({actorId:'clockworks/tiktok-scraper',actorResponse:actor,accountResponse:account,observedAt:now});

test('read-only snapshot selects effective PPE tier, not a future or public price',()=>{
 const proof=evaluate();
 assert.equal(proof.pricingModel,'PAY_PER_EVENT');
 assert.equal(proof.accountTier,'BRONZE');
 assert.deepEqual(proof.eventPricesUsd,{result:0.002,start:0.01});
 assert.equal(proof.accountServiceRatesUsd.externalDataTransferGbyte,.2);
 assert.equal(proof.minimalMaxTotalChargeUsd,0.1);
 assert.equal(proof.actorPermissionLevel,'LIMITED_PERMISSIONS');
 assert.equal(proof.agiPrepaidCompatibleByPermission,true);
 assert.match(proof.actorResponseHash,/^[a-f0-9]{64}$/);
});

test('AGI prepaid compatibility requires an explicit limited-permissions Actor receipt',()=>{
 const full=evaluate({data:{...actorResponse.data,actorPermissionLevel:'FULL_PERMISSIONS'}});
 assert.equal(full.actorPermissionLevel,'FULL_PERMISSIONS');
 assert.equal(full.agiPrepaidCompatibleByPermission,false);
 const missing=evaluate({data:{pricingInfos:actorResponse.data.pricingInfos}});
 assert.equal(missing.actorPermissionLevel,'UNVERIFIED');
 assert.equal(missing.agiPrepaidCompatibleByPermission,false);
 const unknown=evaluate({data:{...actorResponse.data,actorPermissionLevel:'SOMETHING_ELSE'}});
 assert.equal(unknown.actorPermissionLevel,'UNVERIFIED');
 assert.equal(unknown.agiPrepaidCompatibleByPermission,false);
});

test('missing account tier, current PPE record or tier price fails closed',()=>{
 assert.throws(()=>evaluate(actorResponse,{data:{plan:'Starter'}}),/account_tier_unverified/);
 assert.throws(()=>evaluate(actorResponse,{data:{pricingTier:'BRONZE',discountTier:'BRONZE'}}),/account_tier_unverified/);
 assert.throws(()=>evaluate(actorResponse,{data:{plan:{isEnabled:false,tier:'BRONZE'}}}),/account_tier_unverified/);
 assert.throws(()=>evaluate(actorResponse,{data:{plan:{isEnabled:true,tier:'BRONZE',planPricing:{chargeableServiceUnitPricesUsd:{...servicePrices,DATASET_READS:undefined}}}}}),/account_service_pricing_unverified/);
 assert.throws(()=>evaluate({data:{pricingInfos:[{...actorResponse.data.pricingInfos[0],pricingModel:'PRICE_PER_DATASET_ITEM'}]}},accountResponse),/ppe_unverified/);
 assert.throws(()=>evaluate(actorResponse,{data:{plan:{isEnabled:true,tier:'GOLD',planPricing:{chargeableServiceUnitPricesUsd:servicePrices}}}}),/event_price_unverified/);
 assert.throws(()=>evaluate({data:{pricingInfos:[{...actorResponse.data.pricingInfos[0],pricingPerEvent:{actorChargeEvents:{result:{eventPriceUsd:0.01,eventTieredPricingUsd:{BRONZE:{tieredEventPriceUsd:0.002}}}}}}]}},accountResponse),/event_price_unverified/);
});

test('provider probe uses authenticated GET only and never leaks token in URL',async()=>{
 const calls:Array<{url:string;method:string|undefined;authorization:string|null}>=[];
 const fetcher=(async(url:string,init:RequestInit)=>{
  calls.push({url,method:init.method,authorization:new Headers(init.headers).get('Authorization')});
  return {ok:true,json:async()=>url.endsWith('/users/me')?accountResponse:actorResponse} as Response;
 }) as typeof fetch;
 const proof=await probeWeeklyApifyPpe({actorId:'clockworks/tiktok-scraper',token:'secret-fixture',fetcher,now:()=>Date.parse(now)});
 assert.equal(proof.accountTier,'BRONZE');
 assert.equal(calls.length,2);
 assert.ok(calls.every(call=>call.method==='GET'&&call.authorization==='Bearer secret-fixture'&&!call.url.includes('secret-fixture')));
 assert.ok(!JSON.stringify(proof).includes('secret-fixture'));
 assert.ok(!JSON.stringify(proof).includes('Authorization'));
 assert.ok(!JSON.stringify(proof).includes('plan'));
});

test('unknown and hostile provider responses fail closed without exposing response or token',async()=>{
 const bad=(async()=>({ok:true,json:async()=>({data:{token:'provider-secret',unexpected:'private-account-data'}})} as Response)) as typeof fetch;
 await assert.rejects(probeWeeklyApifyPpe({actorId:'clockworks/tiktok-scraper',token:'user-secret',fetcher:bad}),error=>{
  assert.ok(error instanceof Error);
  assert.equal(error.message,'weekly_apify_preflight_account_tier_unverified');
  assert.ok(!error.message.includes('provider-secret')&&!error.message.includes('user-secret'));
  return true;
 });
 await assert.rejects(probeWeeklyApifyPpe({actorId:'clockworks/tiktok-scraper?token=secret',token:'user-secret',fetcher:bad}),/credentials_required/);
 const http=(async()=>({ok:false,status:403} as Response)) as typeof fetch;
 await assert.rejects(probeWeeklyApifyPpe({actorId:'clockworks/tiktok-scraper',token:'user-secret',fetcher:http}),/provider_http_unverified/);
});

const limitsResponse={data:{monthlyUsageCycle:{startAt:'2026-10-01T00:00:00.000Z',endAt:'2026-10-31T23:59:59.999Z'},limits:{maxMonthlyUsageUsd:100,dataRetentionDays:14,maxMonthlyExternalDataTransferGbytes:10},current:{monthlyUsageUsd:43,monthlyExternalDataTransferGbytes:2.5}}};
test('account billing-cycle limit is read-only headroom, never a weekly paid permit',async()=>{
 const calls:Array<{url:string;method:string|undefined;authorization:string|null}>=[];
 const fetcher=(async(url:string,init:RequestInit)=>{
  calls.push({url,method:init.method,authorization:new Headers(init.headers).get('Authorization')});
  return {ok:true,json:async()=>limitsResponse} as Response;
 }) as typeof fetch;
 const observed=await probeWeeklyApifyAccountLimits({token:'fixture-secret',fetcher,now:()=>Date.parse(now)});
 assert.equal(observed.maxMonthlyUsageUsd,100);
 assert.equal(observed.currentMonthlyUsageUsd,43);
 assert.equal(observed.observedHeadroomUsd,57);
 assert.equal(observed.dataRetentionDays,14);
 assert.equal(observed.observedExternalDataTransferHeadroomGbytes,7.5);
 assert.equal(observed.permitsWeeklyCollection,false);
 assert.deepEqual(calls,[{url:'https://api.apify.com/v2/users/me/limits',method:'GET',authorization:'Bearer fixture-secret'}]);
 assert.ok(!JSON.stringify(observed).includes('fixture-secret'));
});

test('account limit absent, stale, malformed or already exceeded never implies a permit',()=>{
 assert.throws(()=>evaluateWeeklyApifyAccountLimits({data:{...limitsResponse.data,limits:{},current:{monthlyUsageUsd:43}}},now),/account_limit_usage_unverified/);
 assert.throws(()=>evaluateWeeklyApifyAccountLimits({data:{...limitsResponse.data,current:{...limitsResponse.data.current,monthlyUsageUsd:-1}}},now),/account_limit_usage_unverified/);
 assert.throws(()=>evaluateWeeklyApifyAccountLimits({data:{...limitsResponse.data,limits:{...limitsResponse.data.limits,dataRetentionDays:0}}},now),/account_storage_or_transfer_limit_unverified/);
 assert.throws(()=>evaluateWeeklyApifyAccountLimits(limitsResponse,'2026-11-01T00:00:00.000Z'),/account_limit_cycle_unverified/);
 const exceeded=evaluateWeeklyApifyAccountLimits({data:{...limitsResponse.data,current:{...limitsResponse.data.current,monthlyUsageUsd:101}}},now);
 assert.equal(exceeded.observedHeadroomUsd,0);
 assert.equal(exceeded.permitsWeeklyCollection,false);
});

test('AGI balance probe is authenticated GET-only and never returns the token',async()=>{
 const calls:Array<{url:string;method:string|undefined;authorization:string|null}>=[];
 const fetcher=(async(url:string,init:RequestInit)=>{
  calls.push({url,method:init.method,authorization:new Headers(init.headers).get('Authorization')});
  return {ok:true,json:async()=>({remainingBalanceUsd:1.25,expiresAt:'2026-10-20T12:00:00.000Z',token:'unexpected-response-secret'})} as Response;
 }) as typeof fetch;
 const receipt=await probeWeeklyApifyAgiBalance({token:'fixture-prepaid-secret',fetcher,now:()=>Date.parse(now)});
 assert.deepEqual(calls,[{url:'https://agi.apify.com/prepaid-tokens/balance',method:'GET',authorization:'Bearer fixture-prepaid-secret'}]);
 assert.equal(receipt.remainingBalanceUsd,1.25);
 assert.equal(receipt.permitsWeeklyCollection,false);
 assert.match(receipt.tokenFingerprint,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(receipt).includes('fixture-prepaid-secret'));
 assert.ok(!JSON.stringify(receipt).includes('unexpected-response-secret'));
});

test('AGI observation fails closed for missing, expired or malformed balances',async()=>{
 const body={remainingBalanceUsd:1,expiresAt:'2026-10-20T12:00:00.000Z'};
 const check=(response:unknown)=>evaluateWeeklyApifyAgiBalance({response,token:'fixture-prepaid-secret',observedAt:now});
 assert.throws(()=>check({expiresAt:body.expiresAt}),/agi_balance_unverified/);
 assert.throws(()=>check({...body,remainingBalanceUsd:-1}),/agi_balance_unverified/);
 assert.throws(()=>check({...body,remainingBalanceUsd:Infinity}),/agi_balance_unverified/);
 assert.throws(()=>check({...body,remainingBalanceUsd:'1'}),/agi_balance_unverified/);
 assert.throws(()=>check({...body,expiresAt:now}),/agi_balance_expired_or_unverified/);
 assert.throws(()=>check({...body,expiresAt:'not-a-date'}),/agi_balance_expired_or_unverified/);
 const denied=(async()=>({ok:false,status:401} as Response)) as typeof fetch;
 await assert.rejects(probeWeeklyApifyAgiBalance({token:'fixture-prepaid-secret',fetcher:denied}),/agi_balance_http_unverified/);
});
