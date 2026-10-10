import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Socket } from 'node:net';
import type { DataStore, ListQuery, Record_ } from '../server/storage/datastore.js';

function memoryStore(rows: Map<string, Record_[]>): DataStore {
 return { supportsAtomicOperationLease:()=>true,
  async getById<T>(collection:string,id:string){return (rows.get(collection)?.find(row=>row.id===id)??null) as T|null;},
  async list<T>(collection:string,query:ListQuery={}){let items=rows.get(collection)??[];for(const [key,value] of Object.entries(query.where??{}))items=items.filter(row=>row[key]===value);const page=query.page??1,perPage=query.perPage??100;return {items:items.slice((page-1)*perPage,page*perPage) as T[],totalItems:items.length,totalPages:Math.ceil(items.length/perPage),page,perPage};},
  async create<T>(collection:string,data:Record<string,unknown>){const row={...data,id:String(data.id??`${collection}-${(rows.get(collection)?.length??0)+1}`)};rows.set(collection,[...(rows.get(collection)??[]),row]);return row as T;},
  async update(collection:string,id:string,data:Record<string,unknown>){const row=rows.get(collection)?.find(row=>row.id===id);if(!row)return false;Object.assign(row,data);return true;},
  async delete(collection:string,id:string){const list=rows.get(collection)??[];const next=list.filter(row=>row.id!==id);rows.set(collection,next);return next.length!==list.length;},
 };
}

test('messaging readiness exercises existing security and receipt contracts with no network or real sends',async()=>{
 const oldFetch=globalThis.fetch,oldConnect=Socket.prototype.connect;
 const envKeys=['NODE_ENV','TENANT_PLATFORM_APP_KEY','FOLLOWUP_WORKER_ENABLED'] as const;
 const oldEnv=new Map(envKeys.map(key=>[key,process.env[key]]));let outbound=0,controlledSends=0;
 globalThis.fetch=(async()=>{outbound++;throw Error('controlled_test_network_forbidden');}) as typeof fetch;
 Socket.prototype.connect=function(){outbound++;throw Error('controlled_test_socket_forbidden');} as typeof oldConnect;
 process.env.NODE_ENV='test';process.env.TENANT_PLATFORM_APP_KEY='controlled-test-key-no-real-credential';process.env.FOLLOWUP_WORKER_ENABLED='true';
 try{
  const [{verifyMetaSignature,signOAuthState,parseOAuthState},{verifyWhatsAppWebhook},{resolveTenantWhatsAppConfig},{selectWhatsAppInboundWebhookPayload,selectInstagramWebhookEntries,webhookAppPlatform},{readCustomerMessagingAuthorization},{createCustomerChannelSendRequestService},{metaOAuthScopes,instagramLoginOAuthScopes}]=await Promise.all([
   import('../server/lib/tenantPlatformApps.js'),import('../server/integrations/whatsapp.js'),import('../server/whatsapp/send.js'),import('../server/routes/webhooks.js'),import('../server/digitalEmployees/customerMessagingPolicy.js'),import('../server/digitalEmployees/customerChannelSendRequests.js'),import('../server/lib/socialOAuthScopes.js'),
  ]);
  const raw=Buffer.from('{"object":"page","entry":[]}'),secret='controlled-signing-secret';const sig=`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`;
  assert.equal(verifyMetaSignature(secret,raw,sig),true);assert.equal(verifyMetaSignature('foreign-secret',raw,sig),false);assert.equal(verifyMetaSignature(secret,Buffer.from('{}'),sig),false);
  const signed=signOAuthState({tenantId:'tenant-a',userId:'actor-a',platform:'facebook',purpose:'messenger',returnTo:'/settings',expiresAt:Date.now()+60000});assert.equal(parseOAuthState(signed)?.tenantId,'tenant-a');assert.equal(parseOAuthState(signed)?.purpose,'messenger');assert.equal(parseOAuthState(`${signed.slice(0,-1)}!`),null);assert.equal(parseOAuthState(signOAuthState({tenantId:'tenant-a',userId:'actor-a',platform:'instagram',returnTo:'/',expiresAt:Date.now()-1})),null);
  assert.equal(verifyWhatsAppWebhook({phoneNumberId:'controlled-phone',accessToken:'controlled-placeholder',verifyToken:'controlled-verify'},'subscribe','controlled-verify','challenge-a'),'challenge-a');assert.equal(verifyWhatsAppWebhook({phoneNumberId:'controlled-phone',accessToken:'controlled-placeholder',verifyToken:'controlled-verify'},'subscribe','wrong','challenge-a'),null);
  const wa={id:'wa-a',tenant_id:'tenant-a',platform:'meta' as const,status:'active' as const,waba_id:'waba-a',phone_number_id:'phone-a',access_token:'controlled-sealed',token_expires_at:'2099-01-01T00:00:00Z'};
  const openSecret=(value?:string)=>value==='controlled-sealed'?'controlled-placeholder':'';
  assert.equal(resolveTenantWhatsAppConfig('tenant-a',wa,openSecret).phoneNumberId,'phone-a');assert.throws(()=>resolveTenantWhatsAppConfig('tenant-b',wa,openSecret),/tenant_whatsapp_not_configured/);assert.throws(()=>resolveTenantWhatsAppConfig('tenant-a',{...wa,token_expires_at:'2000-01-01'},openSecret),/tenant_whatsapp_not_configured/);
  const selected=selectWhatsAppInboundWebhookPayload({object:'whatsapp_business_account',entry:[{id:'waba-a',changes:[{field:'messages',value:{metadata:{phone_number_id:'phone-a'},messages:[{id:'inbound-a'}]}},{field:'messages',value:{metadata:{phone_number_id:'foreign-phone'},messages:[{id:'foreign'}]}}]},{id:'foreign-waba',changes:[{field:'messages',value:{metadata:{phone_number_id:'phone-a'},messages:[{id:'foreign'}]}}]}]}, {wabaId:'waba-a',phoneNumberId:'phone-a'});assert.equal(selected.entry.length,1);assert.equal((selected.entry[0] as {changes:unknown[]}).changes.length,1);
  assert.equal(webhookAppPlatform('/instagram/tenant-a','page'),null);assert.equal(webhookAppPlatform('/meta/tenant-a','instagram'),'instagram');assert.equal(selectInstagramWebhookEntries({object:'instagram',entry:[{id:'foreign-ig'},{id:'ig-a'}]},[{providerAccountId:'ig-a'}]).length,1);
  assert.deepEqual(metaOAuthScopes('messenger',{}),['pages_show_list','pages_read_engagement','pages_messaging','pages_manage_metadata']);assert.deepEqual(instagramLoginOAuthScopes({}),['instagram_business_basic','instagram_business_manage_messages']);
  const config={id:'config-a',tenant_id:'tenant-a',status:'active',config_version:1,config:{enabledWorkflows:['batch_followup'],allowRealCustomerMessages:true}};
  const messenger={id:'page-a',tenantId:'tenant-a',platform:'facebook',status:'connected',providerAccountId:'native-page',messengerSubscribed:true,accessToken:'controlled-sealed'};
  const instagram={id:'ig-a',tenantId:'tenant-a',platform:'instagram',status:'connected',providerAccountId:'native-ig',oauthProvider:'instagram_login',scope:'instagram_business_manage_messages',instagramWebhookSubscribed:true,accessToken:'controlled-sealed'};
  const rows=new Map<string,Record_[]>([['digital_employee_configs',[config]],['tenant_platform_apps',[wa]],['social_accounts',[messenger,instagram]],['users',[{id:'actor-a',tenantId:'tenant-a',role:'customer_service'}]]]);const dataStore=memoryStore(rows);
  const deps={dataStore,openWhatsAppSecret:openSecret,openMessengerToken:(account:Record<string,unknown>)=>openSecret(String(account.accessToken))};
  for(const channel of ['whatsapp','messenger','instagram'] as const){assert.equal((await readCustomerMessagingAuthorization('tenant-a',channel,deps)).providerReady,true);assert.equal((await readCustomerMessagingAuthorization('tenant-b',channel,deps)).manualFollowupSendAllowed,false);}
  instagram.instagramWebhookSubscribed=false;assert.equal((await readCustomerMessagingAuthorization('tenant-a','instagram',deps)).providerReady,false);instagram.instagramWebhookSubscribed=true;
  config.config.allowRealCustomerMessages=false;assert.equal((await readCustomerMessagingAuthorization('tenant-a','messenger',deps)).manualFollowupSendAllowed,false);config.config.allowRealCustomerMessages=true;
  const service=createCustomerChannelSendRequestService(dataStore);
  const input={tenantId:'tenant-a',actorUserId:'actor-a',requestId:'controlled-request-0001',channel:'instagram' as const,customerId:'customer-a',accountId:'ig-a',recipientId:'scoped-user-a',body:'Controlled local receipt test',async send(){controlledSends++;return {messageId:'provider-controlled-id',recipientId:'scoped-user-a',raw:{controlled:true}};},recordHistory(){}};
  const first=await service.execute(input);const repeated=await service.execute(input);assert.equal(first.messageId,'provider-controlled-id');assert.deepEqual(repeated,first);assert.equal(controlledSends,1);assert.equal(rows.get('customer_channel_send_requests')?.length,1);
  await assert.rejects(service.execute({...input,body:'changed intent'}),/channel_send_request_intent_conflict/);await assert.rejects(service.execute({...input,tenantId:'tenant-b'}),/channel_send_actor_forbidden/);assert.equal(controlledSends,1);
  const signedReceipt={tenantId:'tenant-a',channel:'instagram' as const,nativeAccountId:'native-ig',recipientId:'scoped-user-a',providerMessageId:first.messageId,status:'read' as const,occurredAt:new Date().toISOString(),eventKind:'read' as const,eventHash:'a'.repeat(64),signedBodyHash:'b'.repeat(64),verifiedSignature:true as const};
  assert.equal((await service.recordSignedChannelReceipt(signedReceipt)).matched,true);await assert.rejects(service.recordSignedChannelReceipt({...signedReceipt,nativeAccountId:'foreign-ig'}),/channel_send_signed_source_identity_invalid/);await assert.rejects(service.recordSignedChannelReceipt({...signedReceipt,recipientId:'foreign-recipient'}),/channel_send_signed_source_identity_invalid/);
  assert.equal(outbound,0);assert.equal(controlledSends,1);
 }finally{globalThis.fetch=oldFetch;Socket.prototype.connect=oldConnect;for(const key of envKeys){const old=oldEnv.get(key);if(old===undefined)delete process.env[key];else process.env[key]=old;}}
});
