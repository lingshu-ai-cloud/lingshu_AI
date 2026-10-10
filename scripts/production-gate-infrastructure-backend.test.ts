import assert from 'node:assert/strict';
// Dedicated test process, no .env load, all datastore calls replaced before invocation.
process.env.DATA_BACKEND='postgres';
const [{store,auth,dataBackend},{postgresStore},{pbStore,pbAuth}]=await Promise.all([
 import('../server/storage/index.js'),import('../server/storage/postgres.js'),import('../server/storage/pbStore.js'),
]);
assert.equal(dataBackend,'postgres');assert.equal(auth,pbAuth);
const calls:string[]=[];
const originals={pgList:postgresStore.list,pgGet:postgresStore.getById,pgCreate:postgresStore.create,pbList:pbStore.list,pbGet:pbStore.getById,pbCreate:pbStore.create,pgAtomic:postgresStore.supportsAtomicOperationLease};
try{
 postgresStore.list=async collection=>{calls.push(`postgres.list:${collection}`);return {items:[],totalItems:0,totalPages:0,page:1,perPage:1};};
 postgresStore.getById=async collection=>{calls.push(`postgres.get:${collection}`);return null;};
 postgresStore.create=async collection=>{calls.push(`postgres.create:${collection}`);return null;};
 pbStore.list=async collection=>{calls.push(`auth.list:${collection}`);return {items:[],totalItems:0,totalPages:0,page:1,perPage:1};};
 pbStore.getById=async collection=>{calls.push(`auth.get:${collection}`);return null;};
 pbStore.create=async collection=>{calls.push(`auth.create:${collection}`);return null;};
 postgresStore.supportsAtomicOperationLease=async()=>true;
 for(const collection of ['workflow_runs','durable_operation_leases','users']){await store.list(collection);await store.getById(collection,'fixture');await store.create(collection,{id:'fixture'});}
 assert.equal(await store.supportsAtomicOperationLease?.(),true);
 assert.deepEqual(calls,['postgres.list:workflow_runs','postgres.get:workflow_runs','postgres.create:workflow_runs','postgres.list:durable_operation_leases','postgres.get:durable_operation_leases','postgres.create:durable_operation_leases','auth.list:users','auth.get:users','auth.create:users']);
 console.log('DATA_BACKEND=postgres actual storage/index routing passed: business/lease→Postgres; users/auth→PocketBase; no database calls');
}finally{Object.assign(postgresStore,{list:originals.pgList,getById:originals.pgGet,create:originals.pgCreate,supportsAtomicOperationLease:originals.pgAtomic});Object.assign(pbStore,{list:originals.pbList,getById:originals.pbGet,create:originals.pbCreate});}
