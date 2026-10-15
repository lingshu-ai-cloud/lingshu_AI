import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {reserveDailyCollection,collectionBusinessDate} from './dailyCollectionQuota.js';
test('daily ceiling spans runs and sources, retains failed/unknown reservations and uses Shanghai midnight',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-15T12:00:00Z');
 const reserve=(runId:string,requestKey:string,requested:number,tenantId='tenant-a')=>reserveDailyCollection(store,{tenantId,runId,requestKey,requested,now});
 assert.equal(await reserve('a','q1',4),4);assert.equal(await reserve('b','q2',4),4);assert.equal(await reserve('c','q3',8),2);assert.equal(await reserve('d','q4',1),0);
 await assert.rejects(reserve('a','q1',4),/already_reserved/);
 assert.equal(await reserve('a','q1',10,'foreign'),10);
 assert.equal(collectionBusinessDate(new Date('2026-10-15T16:00:00Z')),'2026-10-16');
 assert.equal(await reserveDailyCollection(store,{tenantId:'tenant-a',runId:'tomorrow',requestKey:'q',requested:10,now:new Date('2026-10-15T16:00:00Z')}),10);
});
test('preexisting same-day collection consumes quota without double counting ledger-backed runs',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-15T12:00:00Z');
 await store.create('social_discovery_runs',{tenant_id:'tenant-a',runId:'legacy',startedAt:now.toISOString(),modeStats:{momentum:{requested:7}}});
 assert.equal(await reserveDailyCollection(store,{tenantId:'tenant-a',runId:'new',requestKey:'q',requested:10,now}),3);
 await store.create('social_discovery_runs',{tenant_id:'tenant-a',runId:'new',startedAt:now.toISOString(),modeStats:{momentum:{requested:3}}});
 assert.equal(await reserveDailyCollection(store,{tenantId:'tenant-a',runId:'next',requestKey:'q',requested:1,now}),0);
});
