import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {assessWeeklyAgiCollectionReadiness} from './weeklyAccountCollectionAgiReadiness.js';
import type {WeeklyAccountCollectionBudgetAuthorization} from './weeklyAccountCollectionBudget.js';
import type {WeeklyApifyAgiBalanceObservation,WeeklyApifyPpePreflight} from './weeklyAccountCollectionApifyPreflight.js';

const now='2026-10-19T10:00:00.000Z',token='fixture-secret-only';
const fingerprint=createHash('sha256').update(token).digest('hex');
const actor={actorId:'clockworks/tiktok-scraper',observedAt:now,actorResponseHash:'actor',accountResponseHash:'account',pricingRecordHash:'pricing',pricingStartedAt:now,pricingModel:'PAY_PER_EVENT',accountTier:'FREE',eventPricesUsd:{item:0.01},accountServiceRatesUsd:{datasetRead:4e-7,keyValueStoreRead:5e-6,keyValueStoreList:5e-5,datasetTimedStorageGbyteHour:.001,keyValueStoreTimedStorageGbyteHour:.001,externalDataTransferGbyte:.2},minimalMaxTotalChargeUsd:0,actorPermissionLevel:'LIMITED_PERMISSIONS',agiPrepaidCompatibleByPermission:true} satisfies WeeklyApifyPpePreflight;
const balance={observedAt:now,responseHash:'balance',tokenFingerprint:fingerprint,remainingBalanceUsd:1,expiresAt:'2026-10-20T10:00:00.000Z',permitsWeeklyCollection:false} satisfies WeeklyApifyAgiBalanceObservation;
const budget={actorId:actor.actorId,status:'approved',perRunLimitCny:2,expiresAt:'2026-10-20T10:00:00.000Z',recordHash:'budget'} as WeeklyAccountCollectionBudgetAuthorization;
const input={actorId:actor.actorId,token,now,runCapUsd:0.1,fxCnyPerUsdUpper:10,budget,balance,actor};

test('even complete read-only observations never mint an AGI paid permit',()=>{
 const receipt=assessWeeklyAgiCollectionReadiness(input);
 assert.equal(receipt.permitsPaidCollection,false);
 assert.deepEqual(receipt.blockers,[
  'prepaid_balance_exclusive_reservation_unverified',
  'dataset_and_platform_cost_attribution_unverified',
  'purchase_cny_total_and_fx_upper_unverified',
 ]);
 assert.equal(JSON.stringify(receipt).includes(token),false);
});

test('expired, wrong-token, stale, insufficient and incompatible evidence stays closed',()=>{
 const variants=[
  {...input,balance:{...balance,tokenFingerprint:'wrong'}},
  {...input,balance:{...balance,expiresAt:now}},
  {...input,balance:{...balance,remainingBalanceUsd:0.05}},
  {...input,actor:{...actor,actorPermissionLevel:'FULL_PERMISSIONS' as const,agiPrepaidCompatibleByPermission:false}},
  {...input,actor:{...actor,observedAt:'2026-10-19T09:58:00.000Z'}},
  {...input,budget:{...budget,perRunLimitCny:0.5}},
 ];
 for(const variant of variants){
  const receipt=assessWeeklyAgiCollectionReadiness(variant);
  assert.equal(receipt.permitsPaidCollection,false);
  assert.ok(receipt.blockers.length>3);
 }
});
