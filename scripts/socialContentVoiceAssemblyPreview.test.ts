import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVoicePreviewPcm,readVoiceAssemblyPreview} from '../server/starter198/socialContentVoiceAssemblyPreview.js';

test('voice preview validates the complete natural source PCM and rejects truncation or substituted audio',()=>{
 const expected=Buffer.alloc(24*48000*2);expected.writeInt16LE(1000,48000);
 assert.equal(assertVoicePreviewPcm(Buffer.from(expected),expected),0);
 const rounding=Buffer.from(expected);rounding.writeInt16LE(1001,48000);
 assert.equal(assertVoicePreviewPcm(rounding,expected),1);
 assert.throws(()=>assertVoicePreviewPcm(expected.subarray(2),expected),/duration_changed/);
 const substituted=Buffer.from(expected);substituted.writeInt16LE(3000,48000);
 assert.throws(()=>assertVoicePreviewPcm(substituted,expected),/not_canonical_source_audio/);
});

test('read-only preview returns no media without current-scope registration and rejects ambiguous receipts before opening files',async()=>{
 let reads=0;
 const input:any={scope:{tenantId:'tenant',taskId:'task',runId:'run',jobId:'job'},authorityRoot:'/must-not-read',hookRef:'hook',bodyRef:'body',dataStore:{list:async(_collection:string,query:any)=>{assert.deepEqual(query.where,{tenant_id:'tenant',task_id:'task',run_id:'run',job_id:'job'});return {items:[],totalItems:0};},getById:async()=>{reads++;throw Error('unexpected file or job read');},create:async()=>{throw Error('GET must not write');}}};
 assert.equal(await readVoiceAssemblyPreview(input),null);assert.equal(reads,0);
 input.dataStore.list=async()=>({items:[{},{}],totalItems:2});
 await assert.rejects(()=>readVoiceAssemblyPreview(input),/receipt_ambiguous/);assert.equal(reads,0);
});
