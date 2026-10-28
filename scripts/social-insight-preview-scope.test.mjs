import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withSocialInsightPreviewInformation,customerPreviewAiRequestAllowed,auditedCustomerPreviewAiFetch,withAssistantPreviewInformation} from './customer-preview-ai-scope.mjs';
const config={actorId:'clockworks~tiktok-scraper',maxUsd:.1,datasetReadMaxUsd:.01,confirmedKeyword:'skin care'};
const endpoint='https://api.apify.com/v2/acts/clockworks~tiktok-scraper/runs?maxTotalChargeUsd=0.1&restartOnError=false';
const init={method:'POST',body:JSON.stringify({resultsPerPage:7,searchQueries:['skin care','skin care OEM','skin care private label','skin care manufacturer']})};
test('only a separately enabled capability allows one capped start, known run/dataset and one analysis',async()=>{
 const keys=['NODE_ENV','LINGSHU_LOCAL_PREVIEW','ASSISTANT_PREVIEW_REAL_QUERIES'];const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{NODE_ENV:'development',LINGSHU_LOCAL_PREVIEW:'1',ASSISTANT_PREVIEW_REAL_QUERIES:'1'});
 try{
  assert.equal(customerPreviewAiRequestAllowed(endpoint,init),false);
  await withAssistantPreviewInformation(async()=>assert.equal(customerPreviewAiRequestAllowed(endpoint,init),false));
  await withSocialInsightPreviewInformation(config,async()=>{
   assert.equal(customerPreviewAiRequestAllowed(endpoint,init),true);assert.equal(customerPreviewAiRequestAllowed(endpoint,init),true);
   for (const bad of [{resultsPerPage:30,searchQueries:['skin care']},{resultsPerPage:7,searchQueries:['different','different OEM','different private label','different manufacturer']},{resultsPerPage:7,searchQueries:['skin care','skin care OEM','skin care private label','skin care manufacturer','extra']}]) assert.equal(customerPreviewAiRequestAllowed(endpoint,{method:'POST',body:JSON.stringify(bad)}),false);
   assert.equal(customerPreviewAiRequestAllowed(endpoint.replace('0.1','5'),init),false);
   assert.equal(customerPreviewAiRequestAllowed('https://api.apify.com/v2/actor-runs/other'),false);
   await auditedCustomerPreviewAiFetch(async()=>new Response(JSON.stringify({data:{id:'run1',defaultDatasetId:'dataset1'}}),{headers:{'content-type':'application/json'}}),endpoint,init);
   assert.equal(customerPreviewAiRequestAllowed(endpoint,init),false);
   assert.equal(customerPreviewAiRequestAllowed('https://api.apify.com/v2/actor-runs/run1'),true);
   assert.equal(customerPreviewAiRequestAllowed('https://api.apify.com/v2/datasets/other/items?clean=true&limit=30'),false);
   const dataset='https://api.apify.com/v2/datasets/dataset1/items?clean=true&limit=30';
   assert.equal(customerPreviewAiRequestAllowed(dataset),true);
   await auditedCustomerPreviewAiFetch(async()=>new Response('[]'),dataset,{method:'GET'});
   assert.equal(customerPreviewAiRequestAllowed(dataset),false);
   const model='https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions';
   assert.equal(customerPreviewAiRequestAllowed(model,{method:'POST'}),true);
   await auditedCustomerPreviewAiFetch(async()=>new Response('{}'),model,{method:'POST'});
   assert.equal(customerPreviewAiRequestAllowed(model,{method:'POST'}),false);
   assert.equal(customerPreviewAiRequestAllowed('https://example.com/exfil',{method:'POST'}),false);
  });
 }finally{for(const k of keys)if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}
});
