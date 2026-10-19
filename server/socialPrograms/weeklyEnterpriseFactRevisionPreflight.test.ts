import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {updateTenantEnterpriseProfile} from '../routes/enterprise.js';
import {preflightWeeklyEnterpriseFactRevision} from './weeklyEnterpriseFactRevisionPreflight.js';
import type {Record_} from '../storage/datastore.js';

test('confirmed image-only profile change prepares a new immutable fact binding without touching the old package',async context=>{
 const f=await prepareWeeklyEnterpriseFactFixture(context),rows=await f.store.list<Record_>('social_weekly_operating_packages'),old=rows.items[0]!;
 await f.store.update('social_weekly_operating_packages',old.id,{payload:{...f.pkg,status:'draft'},status:'draft'});
 const updated=await updateTenantEnterpriseProfile('tenant-a',{products:{...f.profile.products,items:(f.profile.products.items??[]).map(item=>({...item,images:[{name:'Product',type:'image/png',size:1,updatedAt:'2026-10-18T00:00:00Z',url:'https://example.test/product.png'}]}))}},'owner');
 const scope={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1};
 const ready=await preflightWeeklyEnterpriseFactRevision(f.store,scope);
 assert.equal(ready.currentFactRef.id,updated.factVersion!.id);
 assert.deepEqual(ready.publicationTasks[0]?.factRefs,[ready.currentFactRef]);
 assert.deepEqual((await f.store.getById<Record_>('social_weekly_operating_packages',old.id))?.payload,{...f.pkg,status:'draft'});
 assert.equal((await f.store.list('social_weekly_operating_packages')).totalItems,1);
 await f.store.create('social_weekly_operating_packages',{tenant_id:'tenant-a',program_id:'program-a',package_id:'later',version:1,payload:{weekStart:'2026-10-19'}});
 await assert.rejects(preflightWeeklyEnterpriseFactRevision(f.store,scope),/weekly_fact_revision_historical_week/);
});

test('changed business claim cannot silently reuse frozen operating authority',async context=>{
 const f=await prepareWeeklyEnterpriseFactFixture(context),row=(await f.store.list<Record_>('social_weekly_operating_packages')).items[0]!;
 await f.store.update('social_weekly_operating_packages',row.id,{payload:{...f.pkg,status:'draft'},status:'draft'});
 await updateTenantEnterpriseProfile('tenant-a',{company:{...f.profile.company,description:'A different factory claim'}},'owner');
 await assert.rejects(preflightWeeklyEnterpriseFactRevision(f.store,{tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1}),/weekly_fact_revision_business_facts_changed/);
});

test('a confirmed schedule freeze makes the source ineligible for an unrelated fact revision',async context=>{
 const f=await prepareWeeklyEnterpriseFactFixture(context),row=(await f.store.list<Record_>('social_weekly_operating_packages')).items[0]!;
 await f.store.update('social_weekly_operating_packages',row.id,{payload:{...f.pkg,status:'draft'},status:'draft'});
 await updateTenantEnterpriseProfile('tenant-a',{products:{...f.profile.products,items:(f.profile.products.items??[]).map(item=>({...item,images:[{name:'Product',type:'image/png',size:1,updatedAt:'2026-10-18T00:00:00Z'}]}))}},'owner');
 await f.store.create('social_weekly_execution_freezes',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:1,snapshot_id:'already-confirmed'});
 await assert.rejects(preflightWeeklyEnterpriseFactRevision(f.store,{tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1}),/weekly_fact_revision_source_frozen/);
});
