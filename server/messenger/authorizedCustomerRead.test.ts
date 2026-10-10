import test from 'node:test';import assert from 'node:assert/strict';
import type{DataStore,Record_}from'../storage/datastore.js';
import {controlledMessengerAccount} from './controlledCapability.fixture.js';
import {messengerCustomerAccountIdentityHash,readAuthorizedMessengerCustomers} from './authorizedCustomerRead.js';
import type{MessengerCustomer}from'./conversations.js';

test('live Messenger reads bind granted Page/PSID/version/current consent and drop unproved aggregate fields',async()=>{
 const run=async(mode='valid')=>{
 const account:Record_={...controlledMessengerAccount({tenantId:'tenant',accountId:'account',pageId:'page'})};const accountHash=messengerCustomerAccountIdentityHash(account);
 const customer:MessengerCustomer={id:'buyer',tenantId:'tenant',pageId:'page',messengerUserId:'psid',name:'old-secret-profile',summary:'old-summary',pendingDraft:'old-draft',lastActiveAt:Date.now()-1000,timeline:[{id:'mid.in',type:'messenger',actor:'buyer',title:'',body:'verified message',time:'',timestamp:Date.now()-1000,audit:{providerMessageId:'mid.in',providerRecipientId:'psid',...{inboundSource:'verified_meta_webhook',accountId:'account',pageId:'page',accountHash}}},{id:'mid.unproved',type:'messenger',actor:'buyer',title:'',body:'old-account-secret',time:'',timestamp:Date.now()-1000}]};
 if(mode==='foreign')account.tenantId='other';if(mode==='token')account.accessToken='changed';if(mode==='seed')account.scope='pages_messaging,pages_manage_metadata';if(mode==='psid')customer.messengerUserId='other';if(mode==='page')customer.pageId='other';if(mode==='provenance')customer.timeline[0]!.audit=undefined;
 let configReads=0;const config={id:'config',tenant_id:'tenant',status:'active',config_version:1,config:{enabledWorkflows:['batch_followup'],allowRealCustomerMessages:true}};
 const fake={getById:async()=>mode==='rotation'?{...account,providerAccountId:'changed'}:account,list:async(collection:string)=>{let items:unknown[]=[];if(collection==='social_accounts')items=[account];if(collection==='digital_employee_configs'){configReads++;items=[{...config,config:{...config.config,allowRealCustomerMessages:mode!=='revoke'&&!(mode==='late-revoke'&&configReads>1)}}];}return{items,totalItems:items.length};}}as unknown as DataStore;
 const clock=Date.now;const current=clock();if(mode==='expired-proof')Date.now=()=>current+11*60*1000;
 try{return await readAuthorizedMessengerCustomers('tenant',fake,{customers:()=>[customer]});}finally{Date.now=clock;}};
 const valid=await run();assert.equal(valid.length,1);assert.equal(valid[0]?.name,'psid');assert.equal(valid[0]?.summary,undefined);assert.equal(valid[0]?.pendingDraft,undefined);assert.deepEqual(valid[0]?.timeline.map(message=>message.id),['mid.in']);
 for(const mode of ['expired-proof','foreign','token','seed','psid','page','provenance','rotation','revoke','late-revoke'])assert.deepEqual(await run(mode),[],mode);
});
