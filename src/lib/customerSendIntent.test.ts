import test from 'node:test';import assert from 'node:assert/strict';
import {assertSendScope,recoverSendIntent,readSendIntent,sendIntentStorageKey,type CustomerSendIntent} from './customerSendIntent';
import type {CustomerChannelSendRequest} from '../../shared/contracts/customerChannelSendRequest';
const scope={tenantId:'tenant',actorUserId:'user',customerId:'customer',channel:'messenger',accountId:'page'};
const intent:CustomerSendIntent={scope,requestId:'stable-request',eventId:'event',state:'unknown'};
const receipt=(patch:Partial<CustomerChannelSendRequest>={})=>({...scope,channel:'messenger',requestId:intent.requestId,status:'unknown',providerMessageId:null,...patch} as CustomerChannelSendRequest);
test('unknown recovery retains request and event identity; acceptance requires actual MID',()=>{assert.deepEqual(recoverSendIntent(intent,receipt()),intent);assert.throws(()=>recoverSendIntent(intent,receipt({status:'accepted'})));assert.equal(recoverSendIntent(intent,receipt({status:'accepted',providerMessageId:'real-mid'})).state,'accepted');});
test('tenant user customer channel account switches cannot borrow request',()=>{for(const field of Object.keys(scope)){assert.throws(()=>assertSendScope(scope,{...scope,[field]:'different'}));}assert.throws(()=>recoverSendIntent(intent,receipt({requestId:'another-request'})));});
test('reload reads metadata only at exact actual scope and stable request',()=>{const saved=new Map([[sendIntentStorageKey(scope),JSON.stringify(intent)]]);assert.deepEqual(readSendIntent({getItem:key=>saved.get(key)||null},scope),intent);assert.equal(readSendIntent({getItem:key=>saved.get(key)||null},{...scope,actorUserId:'new-user'}),null);assert.ok(!JSON.stringify(intent).includes('token'));});

test('actual context and request recovery are readonly and preserve original identity',async()=>{
 const originalFetch=globalThis.fetch;const originalStorage=globalThis.localStorage;const calls:Array<{url:string;method:string}>=[];
 globalThis.localStorage={getItem:()=> 'test-session'} as unknown as Storage;
 globalThis.fetch=async(input,options)=>{const url=String(input);calls.push({url,method:options?.method||'GET'});return new Response(JSON.stringify(url.endsWith('/context')?{item:scope}:{item:receipt({status:'accepted',providerMessageId:'actual-mid'})}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{const {readCustomerSendRequest}=await import('./customerSendIntent');const result=await readCustomerSendRequest(intent);assert.equal(result.providerMessageId,'actual-mid');assert.deepEqual(calls.map(c=>c.method),['GET','GET']);assert.ok(calls[1].url.endsWith('/outbox/stable-request'));}finally{globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
test('missing server request and wrong actual account cannot pretend success or automatically resend',async()=>{
 const originalFetch=globalThis.fetch;const originalStorage=globalThis.localStorage;const methods:string[]=[];globalThis.localStorage={getItem:()=> 'test-session'} as unknown as Storage;
 globalThis.fetch=async(input,options)=>{methods.push(options?.method||'GET');return new Response(JSON.stringify(String(input).endsWith('/context')?{item:scope}:{error:'channel_send_request_not_found'}),{status:String(input).endsWith('/context')?200:404,headers:{'Content-Type':'application/json'}});};
 try{const {readCustomerSendRequest}=await import('./customerSendIntent');await assert.rejects(()=>readCustomerSendRequest(intent),/not_found/);assert.ok(methods.every(method=>method==='GET'));globalThis.fetch=async()=>new Response(JSON.stringify({item:{...scope,accountId:'other-page'}}));await assert.rejects(()=>readCustomerSendRequest(intent),/身份已变化/);}finally{globalThis.fetch=originalFetch;globalThis.localStorage=originalStorage;}
});
