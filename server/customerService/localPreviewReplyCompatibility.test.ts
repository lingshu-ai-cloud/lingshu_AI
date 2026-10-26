import { defaultLocalPreviewProfilePorts } from './localPreviewProfileAnalysis.js';
import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import express from 'express';
import { fixture } from './customerManualTakeover.fixture.js';
import { createLocalCustomerSimulation } from './localPreviewSimulation.js';
import { createLocalPreviewReplyCompatibility } from './localPreviewReplyCompatibility.js';
import { withCustomerPreviewAi, customerPreviewAiRequestAllowed, auditedCustomerPreviewAiFetch } from '../../scripts/customer-preview-ai-scope.mjs';

test('ordinary reply contracts reuse isolated ledger and scoped AI, replay reads without regeneration, and reject authority/automatic/channel bypasses', async () => {
  const saved = {...process.env};
  Object.assign(process.env, {NODE_ENV:'development', LINGSHU_LOCAL_PREVIEW:'1', CUSTOMER_SIMULATION_ENABLED:'1', CUSTOMER_SIMULATION_REAL_AI:'1', LINGSHU_LOCAL_PREVIEW_ORIGINS:'http://127.0.0.1:5225'});
  const f = fixture(), endpoint = 'https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions';
  let generations = 0, translations = 0;
  const service = createLocalCustomerSimulation(f.store, {
    run: withCustomerPreviewAi,
    generate: async body => {
      generations++; assert.equal(body.instruction, 'Keep the buyer units and ask about the lid.');
      assert.equal(body.timeline[0].body, 'We need a 75 ml jar.');
      assert.equal(customerPreviewAiRequestAllowed(endpoint, {method:'POST'}), true);
      await assert.rejects(fetch('https://customer-channel.invalid/messages'), /isolated_test_network_blocked/);
      return {status:200, factVersion:'test-facts', body:{draft:'Which lid suits your 75 ml jar?', translatedDraft:'75 ml 罐需要哪种盖型？', handoffRequired:true, verification:{status:'verified',issues:[]}}};
    },
    translate: async (text, source, target) => {
      translations++; assert.equal(customerPreviewAiRequestAllowed(endpoint, {method:'POST'}), true);
      if(text==='result unknown') throw Error('provider_unknown_outcome');
      await auditedCustomerPreviewAiFetch((async () => Response.json({id:'test-provider-completion',model:'test',usage:{total_tokens:7}})) as typeof fetch,endpoint,{method:'POST'});
      return `${source} -> ${target}: ${text}`;
    },
  }, {...defaultLocalPreviewProfilePorts,enabled:()=>false});
  const compatibility = createLocalPreviewReplyCompatibility(async () => service), app = express();
  app.use(express.json(), (req,res,next) => {Object.assign(res.locals,{tenantId:req.headers['x-tenant']||'tenant',userId:req.headers['x-user']||'owner',dataAuthority:req.headers['x-authority']||'local',supportAccess:req.headers['x-support'] ? {} : undefined});next();});
  let fallbacks=0;
  app.post(['/draft','/api/overseas/agents/conversion/draft'],compatibility.execute,(_req,res)=>{fallbacks++;res.json({original:true});});
  app.get('/draft/:requestId',compatibility.read);
  app.post(['/translate','/api/overseas/plugins/translate/run'],compatibility.translate,(_req,res)=>{fallbacks++;res.json({original:true});});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');
  const call=async(path:string,body?:unknown,headers:Record<string,string>={})=>{const r=await fetch(`http://127.0.0.1:${addr.port}${path}`,{method:body?'POST':'GET',headers:{Origin:'http://127.0.0.1:5225','Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  const input={requestId:'ordinary-draft-12345',customerId:'mock-ordinary',manualRequest:true,timeline:[{actor:'buyer',body:'We need a 75 ml jar.'}],instruction:'Keep the buyer units and ask about the lid.',mode:'polish',intent:'polish'};
  const tx={customerId:'mock-ordinary',manualRequest:true,text:'保留 75 ml 和 lid B7。',source:'简体中文',target:'Spanish'};
  try {
    const draft=await call('/draft',input);assert.equal(draft.status,200);assert.equal(draft.data.status,'waiting_human');
    assert.equal((await call('/draft/ordinary-draft-12345')).data.draft,draft.data.draft);
    assert.deepEqual((await call('/draft',input)).data,draft.data);assert.equal(generations,1);
    assert.equal((await call('/draft',{...input,instruction:'changed'})).status,409);
    assert.equal((await call('/draft/ordinary-draft-12345',undefined,{'x-user':'other'})).status,404);
    assert.equal((await call('/draft/ordinary-draft-12345',undefined,{'x-tenant':'other'})).status,404);
    const translated=await call('/translate',tx);assert.equal(translated.status,200);assert.ok(translated.data.translatedText.includes('75 ml'));
    assert.equal((await call('/translate',tx)).data.translatedText,translated.data.translatedText);assert.equal(translations,1);
    assert.notEqual((await call('/translate',{...tx,target:'Arabic'})).data.translatedText,translated.data.translatedText);assert.equal(translations,2);
    assert.equal((await call('/translate',{...tx,text:'result unknown'})).status,409);assert.equal(translations,3);
    assert.equal(customerPreviewAiRequestAllowed(endpoint,{method:'POST'}),false);
    for(const path of ['/draft','/translate']) {
      const body=path==='/draft'?input:tx;
      assert.equal((await call(path,{...body,customerId:'messenger-real'})).status,400);
      assert.equal((await call(path,{...body,manualRequest:false})).status,400);
      assert.equal((await call(path,body,{'x-authority':'pocketbase'})).status,403);
      assert.equal((await call(path,body,{'x-support':'1'})).status,403);
      assert.equal((await call(path,body,{Origin:'https://foreign.invalid'})).status,404);
      assert.equal((await call(path,{...body,url:'https://customer-channel.invalid'})).status,400);
    }
    assert.equal((await call('/translate',{...tx,text:'x'.repeat(12001)})).status,400);
    const automaticId=await call('/draft',{...input,requestId:undefined,customerId:'mock-server-request-id'});
    assert.equal(automaticId.status,200);assert.ok(automaticId.data.requestId);
    assert.equal((await call('/draft/'+automaticId.data.requestId)).data.requestId,automaticId.data.requestId);assert.equal(generations,2);
    process.env.CUSTOMER_SIMULATION_REAL_AI='0';assert.equal((await call('/translate',{...tx,text:'new text'})).status,409);assert.equal(translations,3);
    process.env.NODE_ENV='production';assert.equal((await call('/translate',tx)).status,404);
    delete process.env.LINGSHU_LOCAL_PREVIEW;delete process.env.CUSTOMER_SIMULATION_ENABLED;
    assert.equal((await call('/draft',input)).data.original,true);assert.equal((await call('/translate',tx)).data.original,true);assert.equal(fallbacks,2);
    assert.ok(f.table('customer_preview_customer_reply_requests').length===2);assert.equal(f.table('customer_reply_requests').length,0);
    assert.equal(f.table('customer_preview_sessions')[0].transport_calls,0);
    const audit=f.table('customer_preview_sessions')[0].ai_audit;assert.ok(Array.isArray(audit));assert.equal(audit.length,2);
    // Exercise the actual native client serialization against the real HTTP compatibility middleware.
    Object.assign(process.env,{NODE_ENV:'development',LINGSHU_LOCAL_PREVIEW:'1',CUSTOMER_SIMULATION_ENABLED:'1',CUSTOMER_SIMULATION_REAL_AI:'1'});
    const {loadApi}=createRequire(import.meta.url)('../../apps/shooting-miniapp/test-support/native-api.cjs');
    const native=loadApi({getStorageSync:()=> 'fixture-local-token',request:(options:{url:string;method:string;header:Record<string,string>;data:unknown;success:(result:unknown)=>void;fail:(error:unknown)=>void})=>{
      void fetch(options.url,{method:options.method,headers:options.header,body:JSON.stringify(options.data)})
        .then(async response=>options.success({statusCode:response.status,data:await response.json()})).catch(options.fail);
    }},{apiBase:`http://127.0.0.1:${addr.port}`,localPreviewOrigin:'http://127.0.0.1:5225'});
    const nativeTranslation=await native.translateCustomerReply('保留 75 ml。','Spanish','mock-native');
    assert.ok(nativeTranslation.translatedText.includes('75 ml'));
    const nativeDraft=await native.recommendCustomerReply({id:'mock-native',timeline:input.timeline,language:'English'},input.instruction);
    assert.equal(nativeDraft.draft,'Which lid suits your 75 ml jar?');
    assert.equal(customerPreviewAiRequestAllowed(endpoint,{method:'POST'}),false);

  } finally {await new Promise<void>(r=>server.close(()=>r()));for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
});
