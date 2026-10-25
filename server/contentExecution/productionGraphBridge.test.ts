import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import { assertProductionGraphCompletionBoundary, admitProductionGraphJob, productionGraphIdentityFromJob } from './productionGraphBridge.js';

class Store implements DataStore {
  rows = new Map<string, Map<string, any>>();
  c(name:string){let rows=this.rows.get(name);if(!rows){rows=new Map();this.rows.set(name,rows);}return rows;}
  async getById<T>(name:string,id:string){return (this.c(name).get(id) as T)??null;}
  async create<T>(name:string,data:Record<string,unknown>){const rows=this.c(name),id=String(data.id);if(rows.has(id))return null;const row={...data,id};rows.set(id,row);return row as T;}
  async update(name:string,id:string,data:Record<string,unknown>){const row=this.c(name).get(id);if(!row)return false;this.c(name).set(id,{...row,...data,id});return true;}
  async delete(name:string,id:string){return this.c(name).delete(id);}
  async list<T>(name:string,q:ListQuery={}):Promise<ListResult<T>>{const all=[...this.c(name).values()].filter(row=>Object.entries(q.where??{}).every(([k,v])=>row[k]===v));return{items:all as T[],totalItems:all.length,totalPages:all.length?1:0,page:1,perPage:q.perPage??20};}
}
const base={tenantId:'tenant',userId:'owner',taskId:'task',runId:'run',accountId:'account',taskType:'social_content_weekly',planVersion:'7',inputHash:'a'.repeat(64)};

test('bridge admits one frozen graph identity and rejects changed replay',async()=>{
 const dataStore=new Store();const first=await admitProductionGraphJob({dataStore,...base});const replay=await admitProductionGraphJob({dataStore,...base});
 assert.equal(replay.id,first.id);assert.equal(productionGraphIdentityFromJob(first).planVersion,'7');
 await assert.rejects(admitProductionGraphJob({dataStore,...base,inputHash:'b'.repeat(64)}),/replay_changed/);
});

test('completion boundary requires settled queue identity and matching receipt',async()=>{
 const dataStore=new Store();const job=await admitProductionGraphJob({dataStore,...base});const identity=productionGraphIdentityFromJob(job);
 const receipt={...identity,approval:{approved:true,receiptRef:'approval',subjectVersion:'2',contentHash:'c'.repeat(64)},artifactIds:['artifact'],packageIds:['package']};
 await dataStore.update('content_execution_jobs',job.id,{status:'succeeded',worker_id:'',lease_expires_at:'',checkpoints:{...job.checkpoints,'social.graph_completion':{version:'1',inputHash:identity.inputHash,updatedAt:new Date().toISOString(),payload:receipt}}});
 const settled=await dataStore.getById<any>('content_execution_jobs',job.id);settled.tenantId=settled.tenant_id;settled.taskId=settled.task_id;settled.runId=settled.run_id;settled.jobKey=settled.job_key;settled.userId=settled.user_id;settled.accountId=settled.account_id;settled.taskType=settled.task_type;settled.workerId=null;settled.leaseExpiresAt=null;settled.providerReceipts=[];settled.createdAt=settled.created_at;settled.updatedAt=settled.updated_at;settled.lastStartedAt=null;settled.completedAt=null;
 assert.equal(assertProductionGraphCompletionBoundary(settled).jobId,job.id);
 settled.checkpoints['social.graph_completion'].payload.planVersion='8';
 assert.throws(()=>assertProductionGraphCompletionBoundary(settled),/completion_invalid/);
});

test('re-admitting a v2 job after rollout keeps its original frozen version',async()=>{
 const {PRODUCTION_GRAPH_BRIDGE_CHECKPOINT}=await import('./productionGraphBridge.js');
 const {PREVIOUS_CONTENT_GRAPH_VERSION}=await import('./langgraphIdentity.js');
 const dataStore=new Store(),original=await admitProductionGraphJob({dataStore,...base});
 const checkpoint=original.checkpoints[PRODUCTION_GRAPH_BRIDGE_CHECKPOINT]!;
 await dataStore.update('content_execution_jobs',original.id,{checkpoints:{...original.checkpoints,[PRODUCTION_GRAPH_BRIDGE_CHECKPOINT]:{...checkpoint,payload:{...(checkpoint.payload as object),graphVersion:PREVIOUS_CONTENT_GRAPH_VERSION}}}});
 const replayed=await admitProductionGraphJob({dataStore,...base});
 assert.equal(replayed.id,original.id);assert.equal(productionGraphIdentityFromJob(replayed).graphVersion,PREVIOUS_CONTENT_GRAPH_VERSION);
});
