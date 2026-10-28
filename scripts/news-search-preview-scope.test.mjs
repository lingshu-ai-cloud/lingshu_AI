import test from 'node:test';
import assert from 'node:assert/strict';
import {withAssistantPreviewInformation, customerPreviewAiRequestAllowed, auditedCustomerPreviewAiFetch} from './customer-preview-ai-scope.mjs';
test('assistant search transport permits bounded turbo or max at the existing native endpoint and rejects agent/pro', async () => {
 const keys=['NODE_ENV','LINGSHU_LOCAL_PREVIEW','ASSISTANT_PREVIEW_REAL_QUERIES','DASHSCOPE_BASE_URL','QWEN_SEARCH_ENDPOINT'];
 const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{NODE_ENV:'development',LINGSHU_LOCAL_PREVIEW:'1',ASSISTANT_PREVIEW_REAL_QUERIES:'1',DASHSCOPE_BASE_URL:'https://maas.qianwenaiapi.com/compatible-mode/v1'});delete process.env.QWEN_SEARCH_ENDPOINT;
 const endpoint='https://maas.qianwenaiapi.com/api/v1/services/aigc/text-generation/generation';
 const init=strategy=>({method:'POST',body:JSON.stringify({parameters:{enable_search:true,search_options:{search_strategy:strategy}}})});
 try {
  assert.equal(customerPreviewAiRequestAllowed(endpoint,init('max')),false);
  const {audit}=await withAssistantPreviewInformation(async()=>{
   for(const strategy of ['turbo','max']) assert.equal(customerPreviewAiRequestAllowed(endpoint,init(strategy)),true);
   for(const strategy of ['pro','agent','agent_max','unknown']) assert.equal(customerPreviewAiRequestAllowed(endpoint,init(strategy)),false);
   assert.equal(customerPreviewAiRequestAllowed('https://other.example.com/api/v1/services/aigc/text-generation/generation',init('max')),false);
   let calls=0;
   await auditedCustomerPreviewAiFetch(async (_url,options)=>{calls++;assert.equal(JSON.parse(options.body).parameters.search_options.search_strategy,'max');return Response.json({output:{}});},endpoint,init('max'));
   assert.equal(calls,1);
  });
  assert.equal(audit.length,1);assert.equal(customerPreviewAiRequestAllowed(endpoint,init('max')),false);
 } finally {for(const key of keys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
});
