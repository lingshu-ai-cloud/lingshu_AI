import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('dynamic route execution retains exact scope, reads narration cache only, and receipts a 404 response',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'weekly-exact-dynamic-'));
  t.after(async()=>{await fs.rm(root,{recursive:true,force:true});});
  const [{store},{executeExistingCandidateMedia},{withExactQwenScope,exactQwenScope,recordExactQwenProviderResponse},{referenceNarrationForVideoAnalysis}]=await Promise.all([
    import('../storage/index.js'),import('./weeklyCandidateModelRevision.js'),import('../agents/exactQwenScope.js'),import('../routes/videos.js'),
  ]);
  const media=path.join(root,'source.mp4');await fs.writeFile(media,Buffer.from('test-only-media'));
  const record:any={id:'dynamic_exact_candidate',tenantId:'tenant',sourceUrl:'https://www.tiktok.com/@fixture/video/1234567890123456789',title:'fixture',platform:'tiktok',duration:5,aiAnalysis:{}};
  let row=structuredClone(record);const original={getById:store.getById,update:store.update};
  store.getById=(async(_collection:string,id:string)=>id===row.id?structuredClone(row):null) as typeof store.getById;
  store.update=(async(_collection:string,id:string,patch:any)=>{if(id!==row.id)return false;Object.assign(row,patch);return true;}) as typeof store.update;
  t.after(()=>{store.getById=original.getById;store.update=original.update;});
  let prepareCalls=0,receipt:any=null;
  await assert.rejects(withExactQwenScope({model:'qwen3.5-plus',configurationHash:'a'.repeat(64),endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialDigest:'b'.repeat(64),onProviderReceipt:async value=>{receipt=value;}},()=>
    executeExistingCandidateMedia(record,'dynamic-operation',media,undefined,{analyze:async()=>{
      assert.equal(exactQwenScope()?.model,'qwen3.5-plus');
      const narration=await referenceNarrationForVideoAnalysis('/must-not-open.mp4',5,'tenant',{readCached:()=>null,prepare:async()=>{prepareCalls++;throw Error('paid ASR must not run');}});
      assert.equal(narration.alignmentError,'scoped_visual_revision_has_no_asr_authorization');
      await recordExactQwenProviderResponse(new Response(JSON.stringify({error:{message:'Model not exist.'}}),{status:404,headers:{'content-type':'application/json'}}),JSON.stringify({model:'qwen3.5-plus',messages:[]}));
      throw Error('404 Model not exist.');
    }})),/404 Model not exist/);
  assert.equal(prepareCalls,0);
  assert.deepEqual({status:receipt?.httpStatus,requestModel:receipt?.requestModel,model:receipt?.model},{status:404,requestModel:'qwen3.5-plus',model:null});
});
