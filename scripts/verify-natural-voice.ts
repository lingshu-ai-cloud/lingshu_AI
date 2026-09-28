import '../server/loadEnvironment.js';
import fs from 'node:fs';
import { synthesizeStudioVoiceForAutomation } from '../server/routes/studio.js';
import { callLLM } from '../server/agents/llm.js';
import { runWithDataAuthority } from '../server/storage/dataAuthority.js';
await runWithDataAuthority('local', async()=>{
 const names = ['混合奶油喷雾','雪域清曦防晒乳','360°焕亮淡纹眼部精华液'];
 const translations=await callLLM(`Translate these cosmetics product names into natural English noun phrases. Preserve the names' meanings, no new claims. Return JSON only {"names":[...]}, three entries in order: ${JSON.stringify(names)}`,{backend:'qwen',model:'qwen-plus',timeoutMs:30000});
 fs.writeFileSync('output/narration-quality-20260928/english-product-names.json',translations);console.log('English product names translated');
 const result=await synthesizeStudioVoiceForAutomation({tenantId:'local_tenant_customer_1b2913131e2c46deab66172228c4df0a',text:'Hello, boss! Do you want to customize your own brand of skincare products? We can develop and produce various best-selling products according to your needs.',language:'en',voice:'v3',sentenceLines:['Hello, boss! Do you want to customize your own brand of skincare products?','We can develop and produce various best-selling products according to your needs.'],style:{preset:'authentic_review',speed:1,pauseStyle:'natural'}});
 fs.writeFileSync('output/narration-quality-20260928/natural-voice-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({ok:result.ok,source:result.source,duration:result.duration,error:result.error}));
});
