import test from 'node:test';
import assert from 'node:assert/strict';
import {Socket} from 'node:net';
import {connectMessengerPageCapability,probeMessengerPageCapability,sendMessengerText} from './messenger.js';
const input={pageId:'page-native',pageAccessToken:'controlled-page-token',appId:'app-native',appSecret:'controlled-app-secret'};
test('actual grants/native Page and subscription readback are required; zero real network or sends',async()=>{
 const previousFetch=globalThis.fetch,previousConnect=Socket.prototype.connect;let network=0;let mode='valid';let subscriptions=0;let sends=0;
 Socket.prototype.connect=function(){network++;throw Error('network_denied');};
 globalThis.fetch=async(request,init)=>{const url=new URL(String(request));assert.equal(url.hostname,'graph.facebook.com');assert.equal(init?.redirect,'error');assert.ok(init?.signal);let data:unknown;
 if(url.pathname.endsWith('/debug_token'))data={data:{is_valid:mode!=='invalid',app_id:mode==='foreign-app'?'other':input.appId,type:mode==='user-token'?'USER':'PAGE',profile_id:input.pageId,scopes:mode==='missing-grant'?['pages_manage_metadata']:['pages_messaging','pages_manage_metadata'],granular_scopes:[{scope:'pages_messaging',target_ids:[mode==='foreign-granular'?'other-page':input.pageId]}],expires_at:mode==='expired'?1:0}};
 else if(url.pathname.endsWith('/me'))data={id:mode==='wrong-native'?'other-page':input.pageId};
 else if(url.pathname.endsWith('/subscribed_apps')&&init?.method==='POST'){subscriptions++;data=mode==='provider-error'?{error:{message:'controlled denied'}}:{success:mode!=='success-false'};}
 else if(url.pathname.endsWith('/subscribed_apps'))data={data:[{id:mode==='wrong-subscription-app'?'other-app':input.appId,subscribed_fields:mode==='missing-subscription-fields'?['messages']:['messages','messaging_postbacks','message_deliveries','message_reads']}]};
 else if(url.pathname.endsWith('/messages')){sends++;data={message_id:'mid.controlled',recipient_id:mode==='wrong-recipient'?'foreign-psid':'recipient-native'};}
 else{network++;throw Error('unexpected_provider_path');}
 return new Response(JSON.stringify(data),{status:200});};
 try{
 const result=await connectMessengerPageCapability(input);assert.deepEqual(result.grantedScopes,['pages_manage_metadata','pages_messaging']);assert.equal(subscriptions,1);assert.equal(sends,0);
 for(mode of ['invalid','foreign-app','user-token','missing-grant','foreign-granular','expired','wrong-native']){const before:number=subscriptions;await assert.rejects(connectMessengerPageCapability(input));assert.equal(subscriptions,before);}
 for(mode of ['success-false','provider-error','wrong-subscription-app','missing-subscription-fields'])await assert.rejects(connectMessengerPageCapability(input));
 mode='wrong-recipient';await assert.rejects(sendMessengerText({...input,recipientId:'recipient-native',text:'controlled'}),/receipt_identity_invalid/);
 mode='valid';await assert.rejects(probeMessengerPageCapability({...input,appId:''}),/configuration_missing/);assert.equal(network,0);
 }finally{globalThis.fetch=previousFetch;Socket.prototype.connect=previousConnect;}
});

test('short-lived capability proof binds actual tenant/native/account/token and expires before any provider operation',async t=>{
 const {createMessengerCapabilityScope,assertMessengerCapabilityAuthority}=await import('../messenger/capabilityAuthority.js');
 const now=new Date('2026-10-10T08:00:00Z');t.mock.timers.enable({apis:['Date'],now});
 const account={id:'account',tenantId:'tenant',platform:'facebook',status:'connected',providerAccountId:'page-native',messengerSubscribed:true,scope:createMessengerCapabilityScope({tenantId:'tenant',accountId:'account',pageId:'page-native',appId:'app-native',accessToken:'controlled-token',grantedScopes:['pages_messaging','pages_manage_metadata']})};
 const token=()=> 'controlled-token';assert.ok(assertMessengerCapabilityAuthority(account,token));
 for(const patch of [{id:'other-account'},{tenantId:'other-tenant'},{providerAccountId:'other-page'},{scope:'pages_messaging,pages_manage_metadata'},{messengerSubscribed:false}])assert.throws(()=>assertMessengerCapabilityAuthority({...account,...patch},token));
 assert.throws(()=>assertMessengerCapabilityAuthority(account,()=> 'rotated-token'),/changed/);
 t.mock.timers.tick(10*60*1000);assert.throws(()=>assertMessengerCapabilityAuthority(account,token),/expired/);
});

test('provider GET-only refresh renews expired evidence and revoked grants disable original account without subscribing or sending',async t=>{
 const [{refreshMessengerCapability},{createMessengerCapabilityScope,assertMessengerCapabilityAuthority},{sealAccountCredential}]=await Promise.all([import('../messenger/capabilityRefresh.js'),import('../messenger/capabilityAuthority.js'),import('../lib/accountCredentials.js')]);
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-10T08:00:00Z')});
 const account:Record<string,unknown>={id:'account',tenantId:'tenant',platform:'facebook',status:'connected',providerAccountId:'page-native',messengerSubscribed:true,accessToken:sealAccountCredential(input.pageAccessToken),scope:createMessengerCapabilityScope({tenantId:'tenant',accountId:'account',pageId:input.pageId,appId:input.appId,accessToken:input.pageAccessToken,grantedScopes:['pages_messaging','pages_manage_metadata']})};
 const app={id:'app-row',tenant_id:'tenant',platform:'meta',app_id:input.appId,app_secret:sealAccountCredential(input.appSecret)};
 const rows:Record<string,Record<string,unknown>[]>= {social_accounts:[account],tenant_platform_apps:[app]};
 const dataStore={async getById<T>(collection:string,id:string){return(rows[collection]?.find(row=>row.id===id)??null)as T|null;},async list<T>(collection:string,query:import('../storage/datastore.js').ListQuery={}){const items=(rows[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));return{items:items as T[],page:1,perPage:2,totalItems:items.length,totalPages:1};},async update(collection:string,id:string,patch:Record<string,unknown>){const row=rows[collection]?.find(row=>row.id===id);if(!row)return false;Object.assign(row,patch);return true;}} as import('../storage/datastore.js').DataStore;
 t.mock.timers.tick(600001);assert.throws(()=>assertMessengerCapabilityAuthority(account),/expired/);
 let revoked=false,requests=0;const previousFetch=globalThis.fetch,previousConnect=Socket.prototype.connect;Socket.prototype.connect=function(){throw Error('network_denied');};
 globalThis.fetch=async(request,init)=>{requests++;assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');const url=new URL(String(request));assert.equal(url.hostname,'graph.facebook.com');const data=url.pathname.endsWith('/debug_token')?{data:{is_valid:true,type:'PAGE',app_id:input.appId,scopes:revoked?[]:['pages_messaging','pages_manage_metadata']}}:url.pathname.endsWith('/me')?{id:input.pageId}:{data:[{id:input.appId,subscribed_fields:['messages','messaging_postbacks','message_deliveries','message_reads']}]};return new Response(JSON.stringify(data),{status:200});};
 try{const fresh=await refreshMessengerCapability(dataStore,'tenant','account');assert.equal(fresh.verified,true);assert.ok(assertMessengerCapabilityAuthority(account));assert.equal(requests,3);const before:number=requests;await assert.rejects(refreshMessengerCapability(dataStore,'foreign','account'),/forbidden/);assert.equal(requests,before);rows.social_accounts!.push({...account,id:'foreign-local',tenantId:'foreign'});await assert.rejects(refreshMessengerCapability(dataStore,'tenant','account'),/foreign_tenant/);assert.equal(requests,before);rows.social_accounts!.pop();revoked=true;await assert.rejects(refreshMessengerCapability(dataStore,'tenant','account'));assert.equal(account.messengerSubscribed,false);assert.throws(()=>assertMessengerCapabilityAuthority(account));}
 finally{globalThis.fetch=previousFetch;Socket.prototype.connect=previousConnect;}
});
