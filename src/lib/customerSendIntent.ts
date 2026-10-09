import {authHeader} from './auth';
import type { CustomerChannelSendRequest } from '../../shared/contracts/customerChannelSendRequest';
export interface CustomerSendScope {tenantId:string;actorUserId:string;customerId:string;channel:string;accountId:string;accountAuthorityHash?:string}
export interface CustomerSendIntent {scope:CustomerSendScope;requestId:string;eventId:string;state:'prepared'|'unknown'|'accepted'}
export function sendScopeKey(scope:CustomerSendScope):string {
 if([scope.tenantId,scope.actorUserId,scope.customerId,scope.channel,scope.accountId].some(value=>typeof value!=='string'||!value.trim()))throw new Error('发送身份不完整');
 return JSON.stringify([scope.tenantId,scope.actorUserId,scope.customerId,scope.channel,scope.accountId,scope.accountAuthorityHash||'']);
}
export function assertSendScope(expected:CustomerSendScope,actual:CustomerSendScope):void {if(sendScopeKey(expected)!==sendScopeKey(actual))throw new Error('发送身份已变化，请重新读取原请求');}
export function recoverSendIntent(intent:CustomerSendIntent,item:CustomerChannelSendRequest):CustomerSendIntent {
 assertSendScope(intent.scope,item);
 if(item.requestId!==intent.requestId)throw new Error('发送请求身份不匹配');
 if(item.status==='accepted'&&!item.providerMessageId)throw new Error('发送回执缺少真实平台消息编号');
 return {...intent,state:item.status==='accepted'?'accepted':'unknown'};
}
export const sendIntentStorageKey=(scope:CustomerSendScope)=>`lingshu:customer-send-intent:${sendScopeKey(scope)}`;
export function readSendIntent(storage:Pick<Storage,'getItem'>,scope:CustomerSendScope):CustomerSendIntent|null {
 const value=storage.getItem(sendIntentStorageKey(scope));if(!value)return null;
 try {const item=JSON.parse(value) as CustomerSendIntent;assertSendScope(scope,item.scope);if(!/^[a-zA-Z0-9_-]{8,120}$/.test(item.requestId)||!item.eventId||!['prepared','unknown','accepted'].includes(item.state))return null;return item;}catch{return null;}
}

async function sendJson(path:string,options?:RequestInit):Promise<unknown>{
 const headers=authHeader(); const response=await fetch(path,{...options,headers:{...headers,...(options?.body?{'Content-Type':'application/json'}:{})}});
 const data=await response.json().catch(()=>({}));
 if(authHeader().Authorization!==headers.Authorization)throw new Error('登录身份已变化，不能借用原发送请求');
 if(!response.ok)throw new Error(data.message||data.error||'发送状态读取失败');return data;
}
export async function readCustomerSendScope(customerId:string):Promise<CustomerSendScope>{
 const data=await sendJson(`/api/overseas/customers/${encodeURIComponent(customerId)}/outbox/context`) as {item:CustomerSendScope};
 sendScopeKey(data.item);if(data.item.customerId!==customerId)throw new Error('发送客户身份不匹配');return data.item;
}
export async function readCustomerSendRequest(intent:CustomerSendIntent):Promise<CustomerChannelSendRequest>{
 const current=await readCustomerSendScope(intent.scope.customerId);assertSendScope(intent.scope,current);
 const data=await sendJson(`/api/overseas/customers/${encodeURIComponent(intent.scope.customerId)}/outbox/${encodeURIComponent(intent.requestId)}`) as {item:CustomerChannelSendRequest};
 recoverSendIntent(intent,data.item);return data.item;
}
