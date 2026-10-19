import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,ListQuery,ListResult} from '../storage/datastore.js';
import {admitContentExecutionJob,DurableContentExecutionWorker,readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {runWeeklyPresenterVoiceRecoveryScan} from './weeklyPresenterVoiceRecoveryScan.js';

class MemoryStore implements DataStore{
 rows=new Map<string,Map<string,Record<string,unknown>&{id:string}>>(); sequence=0;
 table(name:string){let value=this.rows.get(name);if(!value){value=new Map();this.rows.set(name,value);}return value;}
 async getById<T>(c:string,id:string){return (this.table(c).get(id) as T|undefined)??null;}
 async create<T>(c:string,data:Record<string,unknown>){const id=String(data.id||`row${++this.sequence}`).slice(0,15),table=this.table(c);if(table.has(id))return null;if(c==='durable_operation_leases'&&[...table.values()].some(r=>r.tenant_id===data.tenant_id&&r.lease_scope===data.lease_scope&&r.subject_id===data.subject_id))return null;const row={...data,id};table.set(id,row);return row as T;}
 async update(c:string,id:string,data:Record<string,unknown>){const old=this.table(c).get(id);if(!old)return false;this.table(c).set(id,{...old,...data,id});return true;}
 async delete(c:string,id:string){return this.table(c).delete(id);}
 async list<T>(c:string,q:ListQuery={}){let items=[...this.table(c).values()].filter(r=>Object.entries(q.where||{}).every(([k,v])=>r[k]===v));const page=q.page||1,per=q.perPage||items.length||1,total=items.length;items=items.slice((page-1)*per,page*per);return{items:items as T[],totalItems:total,totalPages:Math.ceil(total/per),page,perPage:per} as ListResult<T>;}
}

const checkpoint={version:'1',inputHash:'a'.repeat(64),updatedAt:'2026-10-19T00:00:00Z',payload:{executor:'langgraph',inputHash:'a'.repeat(64),approvedContext:{version:'1',assetSupplyPlan:{shots:[{shotId:'s1',sourceStrategy:'authorized_digital_presenter',sourceRefs:['sales'],digitalHumanPlan:{presenterAssetIds:['sales']}}]}}}};
const person={id:'sales',authorized:true,avatarId:'look',voiceId:'voice',assetVersion:1,toolMappings:{heygen:{avatarId:'look',voiceId:'voice'}},rightsEvidence:{authorizationRef:'document://studio_presenter_assets/source/look',consentRef:'consent://user-declaration/source',grantedAt:'2026-01-01T00:00:00Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}};

test('weekly voice repair retries the same frozen job and reaches the next real blocker',async()=>{
 const store=new MemoryStore();
 const admitted=await admitContentExecutionJob({dataStore:store,tenantId:'tenant',userId:'owner',taskId:'content',runId:'run',taskType:'social_content_weekly',initialCheckpoints:{'social.executor':checkpoint}});
 await store.update('content_execution_jobs',admitted.id,{status:'blocked',last_error:'user_input_required:weekly_default_voice_registry_missing',worker_id:'',lease_expires_at:''});
 assert.deepEqual(await runWeeklyPresenterVoiceRecoveryScan({store}),{examined:1,resumed:0,blocked:1,failed:0});
 assert.equal((await readContentExecutionJob(store,'tenant','content','run'))?.status,'blocked');
 await store.create('studio_presenter_assets',{id:'source',tenant_id:'tenant',kind:'import_authorization',payload:{lookId:'look',voiceId:'voice',groupId:'group',authorizationDeclared:true,adultConfirmed:true,reviewed:true,providerConsentAccepted:false}});
 await store.create('studio_production_defaults',{id:'defaults',tenant_id:'tenant',payload:{defaultPresenterId:'sales',presenters:[person]}});
 assert.deepEqual(await runWeeklyPresenterVoiceRecoveryScan({store}),{examined:1,resumed:1,blocked:0,failed:0});
 const resumed=await readContentExecutionJob(store,'tenant','content','run');assert.equal(resumed?.id,admitted.id);assert.equal(resumed?.status,'queued');
 const worker=new DurableContentExecutionWorker({dataStore:store,allowedJobIds:[admitted.id],execute:async()=>{throw Error('production_input_required:weekly_product_footage_required');},env:{CONTENT_EXECUTION_POLL_INTERVAL_MS:'1'}});
 await worker.drain();
 for(let i=0;i<50&&(await readContentExecutionJob(store,'tenant','content','run'))?.status==='running';i++)await new Promise<void>(resolve=>setImmediate(resolve));
 const next=await readContentExecutionJob(store,'tenant','content','run');assert.equal(next?.id,admitted.id);assert.equal(next?.status,'blocked');assert.equal(next?.lastError,'production_input_required:weekly_product_footage_required');
});

test('forged or unrelated presenter records never move the blocked job',async()=>{
 const store=new MemoryStore(),admitted=await admitContentExecutionJob({dataStore:store,tenantId:'tenant',userId:'owner',taskId:'content',runId:'run',taskType:'social_content_weekly',initialCheckpoints:{'social.executor':checkpoint}});
 await store.update('content_execution_jobs',admitted.id,{status:'blocked',last_error:'user_input_required:weekly_default_voice_authorization_missing:sales',worker_id:'',lease_expires_at:''});
 await store.create('studio_presenter_assets',{id:'source',tenant_id:'other',kind:'import_authorization',payload:{lookId:'look',voiceId:'voice',groupId:'group',authorizationDeclared:true,adultConfirmed:true,reviewed:true,providerConsentAccepted:false}});
 await store.create('studio_production_defaults',{id:'defaults',tenant_id:'tenant',payload:{defaultPresenterId:'sales',presenters:[person]}});
 assert.equal((await runWeeklyPresenterVoiceRecoveryScan({store})).resumed,0);
 assert.equal((await readContentExecutionJob(store,'tenant','content','run'))?.status,'blocked');
});
