import { SOCIAL_WORK_PACKAGE_KINDS } from '../../shared/contracts/socialContentReplication.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, Record_, ListQuery } from '../storage/datastore.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from '../starter198/repository.js';
import { executeSocialContentMutation } from '../starter198/socialContentMutation.js';
import { weeklySourceBindingIdempotencyKey } from './socialWeeklyProductionAdapter.js';
function memory(): DataStore {
 const rows = new Map<string, Record_[]>();
 return {
 async getById<T>(c:string,id:string){return (rows.get(c)?.find(r=>r.id===id)??null) as T|null;},
 async list<T>(c:string,q:ListQuery={}){const found=(rows.get(c)??[]).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v));return {items:found as T[],totalItems:found.length,totalPages:1,page:1,perPage:q.perPage??30};},
 async create<T>(c:string,value:Record<string,unknown>){const list=rows.get(c)??[];const row={...value,id:`${c}-${list.length}`};rows.set(c,[...list,row]);return row as T;},
 async update(c:string,id:string,value:Record<string,unknown>){const row=rows.get(c)?.find(r=>r.id===id);if(!row)return false;Object.assign(row,value);return true;},
 async delete(c:string,id:string){rows.set(c,(rows.get(c)??[]).filter(r=>r.id!==id));return true;},
 };
}
for (const legacyKey of ['weekly-reference:frozen-source-v1','weekly-material:shared-material-v1']) {
 test(`${legacyKey}: same source across mother tasks and same-task retry preserve ledger identity`,async()=>{
 const repository=createStarter198Repository(memory());let actions=0;
 const execute=async(taskId:string)=>{const idempotencyKey=await weeklySourceBindingIdempotencyKey({repository,tenantId:'tenant',taskId,legacyKey});return executeSocialContentMutation({repository,tenantId:'tenant',userId:'human',targetId:taskId,idempotencyKey,operation:'add_social_task_source',requestHash:'same-frozen-source',action:async()=>{actions++;return {taskId};},replay:async()=>({taskId})});};
 assert.equal((await execute('mother-a')).repeated,false);
 assert.equal((await execute('mother-b')).repeated,false);
 assert.equal((await execute('mother-a')).repeated,true);
 assert.equal(actions,2);
 });
 test(`${legacyKey}: legacy persisted receipt stays authoritative only for its original task`,async()=>{
 const repository=createStarter198Repository(memory());let actions=0;
 const mutate=(taskId:string,idempotencyKey:string,requestHash='same-frozen-source')=>executeSocialContentMutation({repository,tenantId:'tenant',userId:'human',targetId:taskId,idempotencyKey,requestHash,operation:'add_social_task_source',action:async()=>{actions++;return {taskId};},replay:async()=>({taskId})});
 await mutate('mother-a',legacyKey);
 const original=await weeklySourceBindingIdempotencyKey({repository,tenantId:'tenant',taskId:'mother-a',legacyKey});assert.equal(original,legacyKey);
 assert.equal((await mutate('mother-a',original)).repeated,true);
 const next=await weeklySourceBindingIdempotencyKey({repository,tenantId:'tenant',taskId:'mother-b',legacyKey});assert.notEqual(next,legacyKey);await mutate('mother-b',next);assert.equal(actions,2);
 await assert.rejects(mutate('mother-a',original,'drifted-source'),/social_content_idempotency_conflict/);
 const ledger=await repository.list(STARTER_COLLECTIONS.socialContentOperations,'tenant');assert.equal(ledger.totalItems,2);
 });
}

test('real addSocialTaskSource attaches one shared frozen material to two mothers and replays exact source',async()=>{
 const {addSocialTaskSource}=await import('../starter198/socialContentTasks.js');
 const repository=createStarter198Repository(memory());
 for(const taskId of ['mother-a','mother-b'])await repository.create(STARTER_COLLECTIONS.socialContentTasks,'tenant',{task_id:taskId,package_selection:SOCIAL_WORK_PACKAGE_KINDS.map(kind=>({kind,packageKey:kind,version:'1',name:kind})),status:'draft',version:'1',brief:{title:taskId,objective:'真实产品说明',markets:[],languages:[],platforms:[],formats:[],restrictions:[]},title:taskId,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
 const sourceOptions:NonNullable<Parameters<typeof addSocialTaskSource>[0]['sourceOptions']>={list:async()=>({items:[],totalItems:0,totalPages:0,page:1,perPage:30}),resolve:async()=>({optionId:'shared',type:'video',thumbnailHref:null,kind:'material',sourceRef:'cloudmaterial:shared',sourceVersion:'sha256-shared',label:'共享产品实拍'})};
 const attach=async(taskId:string)=>addSocialTaskSource({repository,tenantId:'tenant',userId:'human',taskId,idempotencyKey:await weeklySourceBindingIdempotencyKey({repository,tenantId:'tenant',taskId,legacyKey:'weekly-material:shared-sha256'}),sourceOptions,value:{kind:'material',sourceRef:'cloudmaterial:shared',sourceVersion:'sha256-shared',label:'共享产品实拍'}});
 const a=await attach('mother-a');const b=await attach('mother-b');const replay=await attach('mother-a');assert.notEqual(a.source.sourceId,b.source.sourceId);assert.equal(replay.source.sourceId,a.source.sourceId);
 assert.equal((await repository.list(STARTER_COLLECTIONS.socialTaskSources,'tenant')).totalItems,2);
});
