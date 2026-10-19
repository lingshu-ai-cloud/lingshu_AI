import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyNonPresenterPlanningFixture} from './weeklyNonPresenterProduction.fixture.js';

test('controlled planning store rejects stale and foreign CAS expectations',async t=>{
 const {f}=await prepareWeeklyNonPresenterPlanningFixture(t,{ownedReferenceBytes:true});
 const row=f.tables.social_programs!.find(item=>item.program_id==='p');
 assert.ok(row);
 const before=structuredClone(row);
 assert.equal(await f.store.supportsAtomicCompareAndSwap?.(),true);
 assert.equal(await f.store.compareAndSwap?.('social_programs',row.id,{tenant_id:'foreign',payload:before.payload},{payload:{version:999}}),false);
 assert.deepEqual(row,before);
 assert.equal(await f.store.compareAndSwap?.('social_programs',row.id,{tenant_id:'t',payload:before.payload},{payload:{version:2}}),true);
 assert.equal(await f.store.compareAndSwap?.('social_programs',row.id,{tenant_id:'t',payload:before.payload},{payload:{version:999}}),false);
 assert.deepEqual(row.payload,{version:2});
});
