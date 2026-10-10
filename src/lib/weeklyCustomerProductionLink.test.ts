import test from 'node:test';
import assert from 'node:assert/strict';
import {customerItemProductionLink,readCustomerItemNavigation} from './weeklyCustomerProductionLink';
const link=customerItemProductionLink({runId:'actual-run',taskId:'actual-task',itemId:'actual-item'});
function storage(){let token='original';return {getItem:()=>token,setItem:(_k:string,v:string)=>{token=v;},removeItem:()=>{token='';}};}
test('item link carries original item rather than a caller-provided customer; server-only binding supplies channel/customer',async t=>{
 const previous=globalThis.localStorage;const previousFetch=globalThis.fetch;Object.defineProperty(globalThis,'localStorage',{value:storage(),configurable:true});t.after(()=>{Object.defineProperty(globalThis,'localStorage',{value:previous,configurable:true});globalThis.fetch=previousFetch;});
 assert.equal(link.businessRef.entityId,undefined);assert.equal(link.businessRef.followupItemId,'actual-item');let calls=0;
 globalThis.fetch=async(input,options)=>{calls++;assert.match(String(input),/actual-run\/customer-task-navigation\?taskId=actual-task&itemId=actual-item$/);assert.equal(options?.method,undefined);return new Response(JSON.stringify({item:{tenantId:'actual-tenant',runId:'actual-run',taskId:'actual-task',itemId:'actual-item',batchId:'actual-batch',customerId:'actual-buyer',channel:'instagram',accountId:'actual-account',conversationId:'actual-conversation'}}));};
 assert.equal((await readCustomerItemNavigation(link)).customerId,'actual-buyer');assert.equal(calls,1);
 globalThis.fetch=async()=>new Response(JSON.stringify({item:{tenantId:'t',runId:'foreign',taskId:'actual-task',itemId:'actual-item',batchId:'batch',customerId:'buyer',channel:'messenger'}}));await assert.rejects(readCustomerItemNavigation(link),/不一致/);
});
test('late response after login change cannot select a customer from the prior session',async t=>{
 const previous=globalThis.localStorage,previousFetch=globalThis.fetch;Object.defineProperty(globalThis,'localStorage',{value:storage(),configurable:true});t.after(()=>{Object.defineProperty(globalThis,'localStorage',{value:previous,configurable:true});globalThis.fetch=previousFetch;});
 let done!:(r:Response)=>void;globalThis.fetch=()=>new Promise(resolve=>{done=resolve;});const pending=readCustomerItemNavigation(link);globalThis.localStorage.setItem('overseas_token','changed');done(new Response(JSON.stringify({item:{tenantId:'t',runId:'actual-run',taskId:'actual-task',itemId:'actual-item',batchId:'b',customerId:'prior-customer',channel:'whatsapp'}})));await assert.rejects(pending,/登录身份已变化/);
});
