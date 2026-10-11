import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {decryptSecret,type TenantPlatformAppRecord} from '../lib/tenantPlatformApps.js';
import {socialAccessToken} from '../lib/accountCredentials.js';
import {probeMessengerPageCapability,verifyMessengerPageSubscription} from '../integrations/messenger.js';
import {createMessengerCapabilityScope} from './capabilityAuthority.js';
const version=(row:Record<string,unknown>)=>createHash('sha256').update(JSON.stringify([row.id,row.tenantId,row.platform,row.providerAccountId,row.status,row.accessToken])).digest('hex');
/** Provider GETs only: expired evidence is independently re-probed, never trusted or subscribed. */
export async function refreshMessengerCapability(store:DataStore,tenantId:string,accountId:string){
 const actual=await store.getById<Record_>('social_accounts',accountId);
 if(!actual||actual.tenantId!==tenantId||actual.platform!=='facebook'||actual.status!=='connected'||typeof actual.providerAccountId!=='string')throw Error('messenger_refresh_account_forbidden');
 const account=structuredClone(actual),initialVersion=version(account);
 let ownerCount=0;for(let page=1;page<=1000;page++){const owners=await store.list<Record_>('social_accounts',{where:{platform:'facebook',providerAccountId:String(account.providerAccountId)},page,perPage:250});if(owners.items.some(owner=>owner.tenantId!==tenantId))throw Error('messenger_native_page_owned_by_foreign_tenant');ownerCount+=owners.items.length;if(ownerCount===owners.totalItems)break;if(!owners.items.length||ownerCount>owners.totalItems||page===1000)throw Error('messenger_native_page_ownership_incomplete');}

 const apps=await store.list<TenantPlatformAppRecord>('tenant_platform_apps',{where:{tenant_id:tenantId,platform:'meta'},perPage:2});
 if(apps.totalItems!==1||apps.items.length!==1)throw Error('messenger_tenant_app_missing');
 const app=structuredClone(apps.items[0]!);if(app.tenant_id!==tenantId||!app.app_id||!decryptSecret(app.app_secret))throw Error('messenger_tenant_app_missing');
 const appVersion=JSON.stringify([app.id,app.tenant_id,app.app_id,app.app_secret]);
 const assertCurrent=async()=>{const current=await store.getById<Record_>('social_accounts',accountId);const currentApp=await store.getById<TenantPlatformAppRecord>('tenant_platform_apps',app.id);if(!current||version(current)!==initialVersion||!currentApp||JSON.stringify([currentApp.id,currentApp.tenant_id,currentApp.app_id,currentApp.app_secret])!==appVersion)throw Error('messenger_refresh_authority_changed');};
 try{
 const input={pageId:String(account.providerAccountId),pageAccessToken:socialAccessToken(account),appId:app.app_id,appSecret:decryptSecret(app.app_secret)};
 const proof=await probeMessengerPageCapability(input);await verifyMessengerPageSubscription(input);await assertCurrent();
 const scope=createMessengerCapabilityScope({tenantId,accountId,pageId:input.pageId,appId:input.appId,accessToken:input.pageAccessToken,grantedScopes:proof.grantedScopes,validUntil:proof.validUntil});
 if(!await store.update('social_accounts',accountId,{scope,messengerSubscribed:true,messengerSubscriptionError:''}))throw Error('messenger_capability_persist_failed');
 return {accountId,pageId:input.pageId,verified:true,validUntil:new Date(proof.validUntil).toISOString()};
 }catch(error){await assertCurrent();if(!await store.update('social_accounts',accountId,{messengerSubscribed:false,messengerSubscriptionError:'messenger_capability_refresh_failed'}))throw Error('messenger_capability_persist_failed');throw error;}
}
