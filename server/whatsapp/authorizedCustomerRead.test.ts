import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAuthorizedWhatsAppCustomers } from './authorizedCustomerRead.js';
import { whatsappAssetAuthorityHash } from './assetAuthority.js';
import type { TenantPlatformAppRecord } from '../lib/tenantPlatformApps.js';
import type { DataStore } from '../storage/datastore.js';

type State = { app: TenantPlatformAppRecord; config: {id:string;tenant_id:string;status:string;config_version:number;config:{enabledWorkflows:string[];allowRealCustomerMessages:boolean}}; inbound: {id:string;tenantId:string;type:string;waNumber:string;metaMessageId:string;timestamp:number;audit:{inboundSource:string;providerMessageId:string;providerRecipientId:string;accountId:string;phoneNumberId:string;wabaId:string}}; customer: {id:string;name:string;pendingDraft:string;waNumber:string;timeline:{id:string}[];accountId?:string;phoneNumberId?:string;wabaId?:string} };

test('authorized live customer reads bind tenant/account/version/consent/native recipient and redact unverified history', async () => {
  const run = async (mutation?: (state: State) => void, revokeAtEnd = false, driftAtEnd = false) => {
    const app: State['app'] = { id:'app', tenant_id:'tenant', platform:'meta', status:'active', app_id:'meta-app', app_secret:'secret', access_token:'token', phone_number_id:'phone', waba_id:'waba', token_expires_at:new Date(Date.now()+60000).toISOString() };
    app.last_checklist=JSON.stringify({whatsappAssetProof:{authorityHash:whatsappAssetAuthorityHash(app),verifiedAt:new Date().toISOString()}});
    const config: State['config'] = {id:'config',tenant_id:'tenant',status:'active',config_version:1,config:{enabledWorkflows:['batch_followup'],allowRealCustomerMessages:true}};
    const inbound: State['inbound'] = {id:'message',tenantId:'tenant',type:'msg_in',waNumber:'123456789',metaMessageId:'wamid.verified',timestamp:Date.now()-1000,audit:{inboundSource:'verified_meta_webhook',providerMessageId:'wamid.verified',providerRecipientId:'123456789',accountId:'app',phoneNumberId:'phone',wabaId:'waba'}};
    const customer: State['customer'] = {id:'good',name:'old-account-profile',pendingDraft:'old-account-secret',waNumber:'123456789',timeline:[{id:'message'},{id:'foreign-history'}]};
    const state={app,config,inbound,customer}; mutation?.(state); let configReads=0; let accountReads=0;
    const fake = { getById:async()=> { accountReads++; return driftAtEnd && accountReads >= 1 ? {...state.app,access_token:'rotated'} : state.app; }, list:async(collection:string)=> { let items:unknown[]=[]; if(collection==='tenant_platform_apps')items=[state.app]; if(collection==='digital_employee_configs'){configReads++;items=[revokeAtEnd&&configReads>1?{...state.config,config:{...state.config.config,allowRealCustomerMessages:false}}:state.config];} if(collection==='whatsapp_interactions')items=[{id:'stored',tenant_id:'tenant',payload:state.inbound}]; return {items,totalItems:items.length,totalPages:1,page:1,perPage:250};} };
    return readAuthorizedWhatsAppCustomers('tenant',fake as unknown as DataStore,{openSecret:value=>String(value||''),customers:()=>[state.customer,{id:'foreign',waNumber:'999999999'}]});
  };
  const valid=await run(); assert.deepEqual(valid.map(c=>c.id),['good']);assert.deepEqual(valid[0].timeline.map((entry: {id:string})=>entry.id),['message']); assert.equal(valid[0].pendingDraft,undefined); assert.equal(valid[0].name,'123456789');
  for(const mutation of [ (s:State)=>s.customer.accountId='foreign', (s:State)=>s.customer.phoneNumberId='foreign', (s:State)=>s.customer.wabaId='foreign', (s:State)=>s.app.tenant_id='foreign', (s:State)=>s.app.status='pending', (s:State)=>s.app.access_token='changed', (s:State)=>s.inbound.audit.accountId='foreign', (s:State)=>s.inbound.audit.phoneNumberId='foreign', (s:State)=>s.inbound.audit.providerRecipientId='999999999', (s:State)=>s.inbound.tenantId='foreign', (s:State)=>s.config.config.allowRealCustomerMessages=false ]) assert.deepEqual(await run(mutation),[]);
  assert.deepEqual(await run(undefined,true),[]);
  assert.deepEqual(await run(undefined,false,true),[]);
});
