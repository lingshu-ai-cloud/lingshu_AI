import test from 'node:test';import assert from 'node:assert/strict';
import {readCustomerReply} from './customerReplyRequest.js';
test('original draft recovery reads once, verifies identity and bounds fetch/body hangs without regenerating',async()=>{
 const old=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return Response.json({requestId:'original-123',status:'degraded',draft:'safe bridge'});};
  assert.equal((await readCustomerReply('original-123')).draft,'safe bridge');assert.equal(calls,1);
  globalThis.fetch=async()=>Response.json({requestId:'foreign-request',status:'succeeded',draft:'wrong'});
  await assert.rejects(readCustomerReply('original-123'),/身份不一致/);
  globalThis.fetch=async()=>new Promise(()=>{});await assert.rejects(readCustomerReply('original-123',5),/超时/);
  globalThis.fetch=async()=>({ok:true,json:()=>new Promise(()=>{})}) as Response;await assert.rejects(readCustomerReply('original-123',5),/超时/);
 }finally{globalThis.fetch=old;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');}
});
