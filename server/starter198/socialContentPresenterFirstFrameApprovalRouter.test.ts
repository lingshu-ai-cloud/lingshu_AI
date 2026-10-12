import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import express from 'express';
import type {AddressInfo} from 'node:net';
import type {DataStore} from '../storage/datastore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {createPresenterFirstFrameApproval} from './socialContentPresenterFirstFrameApproval.js';
import {createPresenterFirstFrameApprovalRouter} from './socialContentPresenterFirstFrameApprovalRouter.js';
import {SocialContentWorkflowError} from './socialContentValidation.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function memory(){const tables:Record<string,any[]>={};const store={getById:async(c:string,id:string)=>tables[c]?.find(row=>row.id===id)||null,create:async<T=Record<string,unknown>>(c:string,row:Record<string,unknown>):Promise<T|null>=>{const saved={id:`${c}-${(tables[c]?.length||0)+1}`,...structuredClone(row)};(tables[c]??=[]).push(saved);return saved as T;},update:async()=>false,delete:async()=>false,list:async(c:string,q:any={})=>{const items=(tables[c]||[]).filter(row=>Object.entries(q.where||{}).every(([key,value])=>row[key]===value));return{items,totalItems:items.length,totalPages:items.length?1:0,page:1,perPage:q.perPage||500};}} as DataStore;return{store,tables};}

test('review routes expose three safe nodes and confirm one explicitly with isolation and replay safety',async()=>{
 const f=memory(),repository=createStarter198Repository(f.store),scope={tenantId:'tenant-a',taskId:'task-a',runId:'run-a',planHash:sha('plan')};
 await f.store.create(STARTER_COLLECTIONS.socialContentTasks,{id:'task-row',tenant_id:'tenant-a',task_id:'task-a',run_id:'run-a'});
 const approvals:Awaited<ReturnType<typeof createPresenterFirstFrameApproval>>[]=[];for(let index=1;index<=3;index++)approvals.push(await createPresenterFirstFrameApproval(f.store,{...scope,groupId:`group-${index}`,presenterGroupContractHash:sha(`contract-${index}`),referenceCompositionHashes:[sha(`reference-${index}`)],backgroundPlateSha256:sha(`background-${index}`),personRemovalEvidence:{receiptRef:`removal-${index}`,sourceSha256:sha(`person-${index}`),outputSha256:sha(`removed-${index}`)},presenter:{assetId:`presenter-${index}`,assetVersion:1,authorizationRef:'rights',consentRef:'consent',providerId:'heygen',providerPresenterId:`avatar-${index}`,providerVoiceId:`voice-${index}`},compositeFirstFrameSha256:sha(`frame-${index}`),compositeFirstFrameUrl:`/media/tenants/tenant-a/previews/group-${index}.png`,qa:{passed:true,receiptRef:`qa-${index}`,reportHash:sha(`qa-${index}`)},createdAt:'2026-10-12T00:00:00.000Z'}));
 const app=express();app.use(express.json());app.use('/tasks/:taskId/runs/:runId/presenter-first-frame-reviews',createPresenterFirstFrameApprovalRouter({repository,now:()=>new Date('2026-10-12T00:01:00.000Z'),authorize:async(req,_res,level)=>{if(level==='write'&&req.headers['x-role']==='viewer')throw new SocialContentWorkflowError('social_content_write_forbidden',403);return{tenantId:String(req.headers['x-tenant']||'tenant-a'),userId:'owner'};}}));
 const server=app.listen(0),base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/tasks/task-a/runs/run-a/presenter-first-frame-reviews`;
 try{
  const listed=await fetch(base),body=await listed.json() as any;assert.equal(listed.status,200);assert.equal(body.items.length,3);assert.equal(body.items[0].status,'pending_confirmation');assert.equal(body.items[0].previewUrl,'/media/tenants/tenant-a/previews/group-1.png');assert.equal(body.items[0].compositionSummary.referenceCount,1);assert.equal(JSON.stringify(body).includes('authorizationRef'),false);assert.equal(JSON.stringify(body).includes('providerVoiceId'),false);assert.equal(JSON.stringify(body).includes('sourceSha256'),false);
  const request=(key:string,hash=approvals[0].recordHash,headers:Record<string,string>={})=>fetch(`${base}/group-1/confirm`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,...headers},body:JSON.stringify({expectedRecordHash:hash})});
  const confirmed=await request('confirm-group-1'),confirmedBody=await confirmed.json() as any;assert.equal(confirmed.status,200);assert.equal(confirmedBody.item.status,'confirmed');assert.equal(confirmedBody.item.decisionVersion,1);
  assert.equal((await request('confirm-group-1')).status,200);
  assert.equal((await request('different-key')).status,409);
  assert.equal((await request('viewer-key',approvals[0].recordHash,{'x-role':'viewer'})).status,403);
  assert.equal((await fetch(base,{headers:{'x-tenant':'tenant-b'}})).status,404);
  assert.equal((await fetch(base.replace('/run-a/','/run-old/'))).status,409);
  assert.equal(f.tables.social_presenter_first_frame_decisions.length,1);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
