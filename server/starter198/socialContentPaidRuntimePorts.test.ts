import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {createSocialContentPaidRuntimePorts,measureQwenRequestInputUpperBound} from './socialContentPaidRuntimePorts.js';
const body={model:'qwen3-vl-plus',max_tokens:4096,messages:[{role:'user',content:[{type:'text',text:'真实产品'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+'A'.repeat(100000)}}]}]};
test('actual request-derived token bound excludes base64 transport bytes and rejects unsupported modalities',async()=>{
 const measured=await measureQwenRequestInputUpperBound(body);assert.ok(measured>16384&&measured<20000);
 assert.equal(await measureQwenRequestInputUpperBound({...body,messages:[{role:'user',content:[{type:'text',text:'真实产品'},{type:'image_url',image_url:{url:'https://real/image'}}]}]}),measured);
 await assert.rejects(measureQwenRequestInputUpperBound({...body,tools:[]}),/extra_input/);await assert.rejects(measureQwenRequestInputUpperBound({...body,messages:[{role:'user',content:[{type:'audio',audio:'not priced'}]}]}),/modality/);
});
test('real provider response is scope-bound, hash-persisted, replay-stable without fabricated usage',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'paid-runtime-'));let checks=0;try{
 const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'b'.repeat(64)};
 const ports=createSocialContentPaidRuntimePorts({scope,receiptRoot:root,assertCurrent:async()=>{checks++;}});
 const receipt={requestSha256:'a'.repeat(64),response:{id:'actual-provider-id',usage:{input_tokens:37,output_tokens:9}}};
 const ref=await ports.material.persistProviderReceipt(receipt);assert.equal(await ports.material.persistProviderReceipt(receipt),ref);
 const digest=ref.split(':')[1]!,bytes=await fs.readFile(path.join(root,digest+'.json'),'utf8');assert.equal(createHash('sha256').update(bytes).digest('hex'),digest);assert.deepEqual(JSON.parse(bytes).response,receipt.response);assert.deepEqual(JSON.parse(bytes).scope,scope);assert.equal(checks,4);
 assert.equal((await fs.stat(path.join(root,digest+'.json'))).mode&0o777,0o600);
 await fs.writeFile(path.join(root,digest+'.json'),'corrupt');await assert.rejects(ports.material.persistProviderReceipt(receipt),/persistence_failed/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('default runtime checks the actual configured SDK account at every submission boundary',async()=>{
 const {createProductionBudgetRouteReaders,productionBillingAccountRef}=await import('./socialContentProductionBudgetRoutes.js');
 let credentialSha256='1'.repeat(64);const baseUrl='https://dashscope.aliyuncs.com/compatible-mode/v1';
 const routes=createProductionBudgetRouteReaders({readQwenBinding:()=>({baseUrl,credentialSha256,materialModel:'qwen3-vl-plus',imageModel:'qwen3-vl-plus'})});
 const runtime=createSocialContentPaidRuntimePorts({scope:{tenantId:'t',taskId:'task',runId:'run',planHash:'b'.repeat(64)},routes,assertCurrent:async()=>{}});
 const expected={provider:'qwen',model:'qwen3-vl-plus',stage:'material_image_analysis' as const,accountRef:productionBillingAccountRef('qwen',baseUrl,credentialSha256)};
 await runtime.material.assertProviderBinding(expected);credentialSha256='2'.repeat(64);await assert.rejects(runtime.material.assertProviderBinding(expected),/binding_changed/);
});
