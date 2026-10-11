import { sealAccountCredential } from '../lib/accountCredentials.js';
import { createMessengerCapabilityScope } from './capabilityAuthority.js';
/** Controlled fixtures use the same credential sealing and proof contract as admitted accounts. */
export function controlledMessengerAccount(input:{accountId:string;tenantId:string;pageId:string}) {
 const accessToken='controlled-messenger-token';
 return {id:input.accountId,tenantId:input.tenantId,platform:'facebook',status:'connected',providerAccountId:input.pageId,messengerSubscribed:true,accessToken:sealAccountCredential(accessToken),scope:createMessengerCapabilityScope({...input,appId:'controlled-meta-app',accessToken,grantedScopes:['pages_messaging','pages_manage_metadata']})};
}
