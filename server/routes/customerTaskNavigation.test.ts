import {assertCustomerWorkspaceIdentity} from '../../src/lib/customerWorkspaceIdentity.js';
import {customerItemProductionLink,readCustomerItemNavigation,matchCustomerItemNavigation} from '../../src/lib/weeklyCustomerProductionLink.js';
import {once} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createCustomerTaskNavigationRouter} from './customerTaskNavigation.js';
import {nativeDispatchFixture} from '../digitalEmployees/weeklyNativeFollowupDispatch.fixture.js';
import {readCustomerTaskNavigation} from '../digitalEmployees/customerTaskNavigation.js';
import {followupItemContentHash,type FollowupBatchItemRecord} from '../digitalEmployees/customerWorkflow.js';
for(const channel of ['messenger','instagram'] as const)test(`${channel} real member navigation HTTP resolves original item and never sends, rejecting forged scope`,async t=>{
 const f=await nativeDispatchFixture(channel);t.after(f.restore);const app=express();app.use((req,res,next)=>{if(req.headers.authorization){res.locals.tenantId='tenant';res.locals.userId='owner';}next();});app.use('/runs/:runId/customer-task-navigation',createCustomerTaskNavigationRouter(f.store));const server=app.listen(0,'127.0.0.1');t.after(()=>server.close());await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/runs/run/customer-task-navigation?taskId=followup_dispatch&itemId=item`;
 assert.equal((await fetch(base)).status,401);const response=await fetch(base,{headers:{Authorization:'controlled'}});assert.equal(response.status,200);const actual=await response.json();assert.equal(actual.item.customerId,'buyer');assert.equal(actual.item.channel,channel);assert.equal(actual.item.accountId,'account');assert.equal(actual.item.batchId,'batch');assert.equal(f.sends(),0);
 const workspaceResponse=await fetch(base.replace('/customer-task-navigation?','/customer-task-navigation/workspace?'),{headers:{Authorization:'controlled'}});assert.equal(workspaceResponse.status,200);const workspace=await workspaceResponse.json();assert.equal(workspace.batch.id,'batch');assert.equal(workspace.items[0].id,'item');assert.equal(workspace.navigation.customerId,'buyer');assert.doesNotThrow(()=>assertCustomerWorkspaceIdentity(workspace,customerItemProductionLink({runId:'run',taskId:'followup_dispatch',itemId:'item'}),actual.item));
 f.data.followup_batches!.push({...f.batch,id:'newer-batch',version:3,segment_id:'newer-segment'});
 const oldWorkspace=await (await fetch(base.replace('/customer-task-navigation?','/customer-task-navigation/workspace?'),{headers:{Authorization:'controlled'}})).json();assert.equal(oldWorkspace.batch.id,'batch');assert.equal(oldWorkspace.segment.id,'segment');assert.equal(oldWorkspace.items[0].id,'item');assert.equal(oldWorkspace.readOnly,true);
 const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=> 'controlled'}});
 globalThis.fetch=(input,init)=>originalFetch(`http://127.0.0.1:${address.port}${String(input).replace('/api/overseas/digital-employees','')}`,init);
 try{const link=customerItemProductionLink({runId:'run',taskId:'followup_dispatch',itemId:'item'}),binding=await readCustomerItemNavigation(link);assert.equal(binding.customerId,'buyer');assert.equal(binding.channel,channel);const customer={id:'buyer',source:channel,pageId:'native-account',instagramAccountId:'native-account',isMock:false};assert.equal(matchCustomerItemNavigation(binding,[customer])?.id,'buyer');assert.equal(matchCustomerItemNavigation(binding,[{...customer,pageId:'foreign-native',instagramAccountId:'foreign-native'}]),null);assert.equal(matchCustomerItemNavigation(binding,[{...customer,isMock:true}]),null);}finally{globalThis.fetch=originalFetch;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:originalStorage});}
 assert.equal((await fetch(base+'&customerId=forged',{headers:{Authorization:'controlled'}})).status,400);
 await assert.rejects(readCustomerTaskNavigation(f.store,{tenantId:'foreign',runId:'run',taskId:'followup_dispatch',itemId:'item'}));
 await assert.rejects(readCustomerTaskNavigation(f.store,{tenantId:'tenant',runId:'foreign-run',taskId:'followup_dispatch',itemId:'item'}));
 f.item.customer_id='forged';await assert.rejects(readCustomerTaskNavigation(f.store,{tenantId:'tenant',runId:'run',taskId:'followup_dispatch',itemId:'item'}));f.item.customer_id='buyer';
 f.item.account_id='foreign-account';await assert.rejects(readCustomerTaskNavigation(f.store,{tenantId:'tenant',runId:'run',taskId:'followup_dispatch',itemId:'item'}));assert.equal(f.sends(),0);
});
test('legacy actual WhatsApp member navigation requires matching real frozen phone and refuses missing native proof',async t=>{
 const f=await nativeDispatchFixture();t.after(f.restore);const member=f.data.customer_segment_members![0]!;member.customer_snapshot={source:'whatsapp',waNumber:'8613800000000'};Object.assign(f.item,{wa_number:'8613800000000',channel:'whatsapp',channel_selection:null,weekly_channel_evidence_hash:null});f.item.content_hash=followupItemContentHash(f.item as unknown as FollowupBatchItemRecord);
 const input={tenantId:'tenant',runId:'run',taskId:'followup_dispatch',itemId:'item'};await assert.rejects(readCustomerTaskNavigation(f.store,input),/manual_takeover_customer_scope_invalid/);f.data.social_weekly_customer_bindings=[];const result=await readCustomerTaskNavigation(f.store,input);assert.equal(result.channel,'whatsapp');assert.equal(result.accountId,null);assert.equal(result.customerId,'buyer');assert.equal(f.sends(),0);
 f.item.wa_number='other';await assert.rejects(readCustomerTaskNavigation(f.store,input));
});
