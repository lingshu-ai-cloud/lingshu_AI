import test from 'node:test';
import assert from 'node:assert/strict';
import {pbStore} from '../storage/pbStore.js';
import {PostgresStore} from '../storage/postgres.js';
import {runInDataAuthorityRequestScope,currentDataAuthority,runWithDataAuthority} from '../storage/dataAuthority.js';
import {publishVideoToAccount} from './platformPublisher.js';
import {executeWeeklyPublication} from './weeklyLineage.js';
import {assertPublicationAtomicStore} from './publicationAtomicStore.js';
import type {DataStore} from '../storage/datastore.js';

test('background PB fallback cannot reach storage or provider and does not auto retry',async()=>{
 const previous=process.env.ENABLE_LOCAL_DEV_FALLBACK;process.env.ENABLE_LOCAL_DEV_FALLBACK='true';
 try {await runInDataAuthorityRequestScope(async()=>{
  assert.equal(currentDataAuthority(),null);let calls=0;
  const input={dataStore:pbStore,adapter:{publish:async()=>{calls++;}}} as unknown as Parameters<typeof executeWeeklyPublication>[0];
  await assert.rejects(executeWeeklyPublication(input),{code:'publication_atomic_store_unavailable'});
  assert.equal(calls,0);
  await assert.rejects(publishVideoToAccount({} as never),{code:'publication_atomic_store_unavailable'});
 });} finally {if(previous===undefined)delete process.env.ENABLE_LOCAL_DEV_FALLBACK;else process.env.ENABLE_LOCAL_DEV_FALLBACK=previous;}
 await runWithDataAuthority('local',()=>assert.rejects(assertPublicationAtomicStore(pbStore),{code:'publication_atomic_store_unavailable'}));
});

test('undeclared custom store is denied; explicit controlled capability remains compatible',async()=>{
 await assert.rejects(assertPublicationAtomicStore({} as DataStore),{code:'publication_atomic_store_unavailable'});
 await assertPublicationAtomicStore({supportsAtomicOperationLease:()=>true} as DataStore);
});

test('Postgres capability requires observed valid unique subject index, failures close access',async()=>{
 const index={valid:true,key1:"(data ->> 'tenant_id'::text)",key2:"(data ->> 'lease_scope'::text)",key3:"(data ->> 'subject_id'::text)",predicate:"(collection = 'durable_operation_leases'::text)"};
 const configured=(rows:unknown[])=>new PostgresStore({query:async()=>({rows,rowCount:rows.length})} as never);
 assert.equal(await configured([index]).supportsAtomicOperationLease(),true);
 assert.equal(await configured([]).supportsAtomicOperationLease(),false);
 assert.equal(await configured([{...index,valid:false}]).supportsAtomicOperationLease(),false);
 assert.equal(await configured([{...index,key3:"data ->> 'wrong_id'"}]).supportsAtomicOperationLease(),false);
 assert.equal(await configured([{...index,predicate:index.predicate+" AND (data ->> 'tenant_id') = 'one-tenant'"}]).supportsAtomicOperationLease(),false);
 assert.equal(await configured([{...index,key2:"lower(data ->> 'lease_scope')"}]).supportsAtomicOperationLease(),false);
 assert.equal(await new PostgresStore({query:async()=>{throw Error('database unavailable');}} as never).supportsAtomicOperationLease(),false);
});
