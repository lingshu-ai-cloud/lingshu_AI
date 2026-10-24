import net from 'node:net';
import {createRequire} from 'node:module';
import test from 'node:test';import assert from 'node:assert/strict';
import {withCustomerPreviewAi,customerPreviewAiRequestAllowed,auditedCustomerPreviewAiFetch,customerPreviewAiTransportAllowed} from '../../scripts/customer-preview-ai-scope.mjs';
test('real AI egress is action scoped, exact endpoint POST only, never opens customer channels or follows redirects',async()=>{
 assert.equal(Reflect.get(globalThis,Symbol.for('lingshu.customerIsolationGuard')),true,'guard must be installed before a negative network check');
 Object.assign(process.env,{NODE_ENV:'development',LINGSHU_LOCAL_PREVIEW:'1',CUSTOMER_SIMULATION_REAL_AI:'1'});
 const endpoint='https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions';
 assert.equal(customerPreviewAiRequestAllowed(endpoint,{method:'POST'}),false);
 const r=await withCustomerPreviewAi(async()=>{
  assert.equal(customerPreviewAiRequestAllowed(endpoint,{method:'POST'}),true);
  const requiredScope=createRequire(import.meta.url)('../../scripts/customer-preview-ai-scope.mjs') as typeof import('../../scripts/customer-preview-ai-scope.mjs');assert.equal(requiredScope.customerPreviewAiRequestAllowed(endpoint,{method:'POST'}),true,'ESM and synchronous require must share AI capability context');
  assert.throws(()=>net.connect(443,'maas.qianwenaiapi.com'),/isolated_test_network_blocked/,'AI action alone does not permit raw sockets');
  for(const url of ['https://graph.facebook.com/v25.0/messages',endpoint+'/other','https://maas.qianwenaiapi.com/compatible-mode/v1/files'])assert.equal(customerPreviewAiRequestAllowed(url,{method:'POST'}),false);
  assert.equal(customerPreviewAiRequestAllowed(endpoint,{method:'GET'}),false);
  await assert.rejects(fetch('https://customer-channel.invalid/messages',{method:'POST'}),/isolated_test_network_blocked/);
  await auditedCustomerPreviewAiFetch((async(_url,init)=>{assert.equal(init?.redirect,'error');assert.equal(customerPreviewAiTransportAllowed('maas.qianwenaiapi.com',443),true);assert.equal(customerPreviewAiTransportAllowed('graph.facebook.com',443),false);return Response.json({id:'test-completion',model:'test-model',usage:{total_tokens:42}},{headers:{'x-request-id':'test-provider-request'}});}) as typeof fetch,endpoint,{method:'POST'});
  return true;
 });
 assert.equal(r.audit[0]?.completionId,'test-completion');assert.equal(r.audit[0]?.requestId,'test-provider-request');assert.equal(r.audit[0]?.usage?.total_tokens,42);
 assert.equal(customerPreviewAiRequestAllowed(endpoint,{method:'POST'}),false);
 await assert.rejects(withCustomerPreviewAi(async()=>{await auditedCustomerPreviewAiFetch((async()=>{throw Error('provider_unknown_outcome');}) as typeof fetch,endpoint,{method:'POST'});}),error=>{const e=error as Error&{previewAiAudit:Array<{status:number|null}>};assert.equal(e.message,'provider_unknown_outcome');assert.equal(e.previewAiAudit.length,1);assert.equal(e.previewAiAudit[0].status,null);return true;});
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let late!:Promise<boolean>;await withCustomerPreviewAi(async()=>{late=gate.then(()=>customerPreviewAiRequestAllowed(endpoint,{method:'POST'}));});release();assert.equal(await late,false,'descendant tasks cannot retain AI permission after the action ends');
 assert.equal(customerPreviewAiTransportAllowed('maas.qianwenaiapi.com',443),false);
 process.env.CUSTOMER_SIMULATION_REAL_AI='0';await assert.rejects(withCustomerPreviewAi(async()=>true),/not_enabled/);
});
