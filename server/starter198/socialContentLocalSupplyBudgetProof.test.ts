import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createSocialContentLocalSupplyBudgetProofReader, LOCAL_SUPPLY_EXECUTOR } from './socialContentLocalSupplyBudgetProof.js';
import { paidProductionHash } from './socialContentPaidOperationPlan.js';

test('canonical tenant video selection produces readonly executor-bound proof; source/segment/strategy drift fail closed', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'local-supply-proof-'));
  try {
    const file = path.join(directory, 'registered-video.mp4');
    // Selection does not decode or render. The registered source byte identity is independently checked.
    const bytes = Buffer.from('registered immutable video bytes'); await writeFile(file, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const analysis = { schemaVersion:'material-script-analysis.v3',status:'ready',sourceRevision:'stored-revision',shots:[{segmentId:'cut',startSeconds:1,endSeconds:5,needsReview:false}] };
    const scope = {tenantId:'tenant',taskId:'task',runId:'run',planHash:'plan'};
    const asset = {id:'material',sourceId:'library_source',type:'video',contentHash:sha,localPath:file,duration:6,segments:[{id:'cut'}],scriptAnalysis:analysis};
    const shot = {shotId:'S01',sourceStrategy:'customer_real_asset',sourceRefs:['library_source'],selectedMaterialSegment:{sourceRef:'library_source',segmentId:'cut',startSeconds:1,endSeconds:4},truthBoundary:{customerEvidenceRefs:['library_source']},materialRouting:{policy:'local_only',localMatch:{state:'matched',sourceRefs:['library_source'],evidenceRef:'stored-semantic-evidence'}}};
    const record = {id:'material',tenantId:'tenant',type:'video',contentSha256:sha,scriptAnalysis:analysis};
    let assertions = 0;
    const input = {scope,supplyPlan:{shots:[shot]},baseline:{scenes:[{sceneId:'S01'}]},assets:[asset],assertCurrent:async()=>{assertions++;},repository:{dataStore:{},materialLibrary:async()=>({items:[record]})}};
    const requirement = {key:'scene:S01:customer_real_asset',stage:'local_supply_selection',shotId:'S01',sourceRef:null,durationSeconds:3,text:null,frameCount:null,inputContractHash:'a'.repeat(64)};
    const read = createSocialContentLocalSupplyBudgetProofReader(input as never);
    const proof = await read(requirement); assert.ok(proof); assert.equal(proof.sourceSha256,sha); assert.equal(proof.scopeHash,paidProductionHash(scope)); assert.match(proof.receiptRef,/^local_selection:/); assert.equal(LOCAL_SUPPLY_EXECUTOR,'existing_customer_asset.v1'); assert.equal(assertions,2);
    assert.ok(await createSocialContentLocalSupplyBudgetProofReader({...input,assets:[{...asset,duration:3.9999967}]} as never)(requirement),'container time-base rounding must not reject the exact selected cut');
    assert.equal(await createSocialContentLocalSupplyBudgetProofReader({...input,assets:[{...asset,duration:3.998}]} as never)(requirement),null,'a materially short source must still fail closed');
    const fractionalAnalysis={...analysis,shots:[{...analysis.shots[0],startSeconds:26,endSeconds:28}]};
    const fractionalInput={...input,assets:[{...asset,duration:30,scriptAnalysis:fractionalAnalysis}],repository:{...input.repository,materialLibrary:async()=>({items:[{...record,scriptAnalysis:fractionalAnalysis}]})},supplyPlan:{shots:[{...shot,selectedMaterialSegment:{...shot.selectedMaterialSegment,startSeconds:26.83,endSeconds:27.229999999999997}}]}};
    const fractionReq={...requirement,durationSeconds:5.3-4.9};
    assert.ok(await createSocialContentLocalSupplyBudgetProofReader(fractionalInput as never)(fractionReq),'decimal subtraction at source and timeline origins must agree within nanosecond precision');
    assert.equal(await createSocialContentLocalSupplyBudgetProofReader(fractionalInput as never)({...fractionReq,durationSeconds:.401}),null,'a truly shorter selected window is not a match');
    record.tenantId='other'; assert.equal(await read(requirement),null); record.tenantId='tenant';
    record.scriptAnalysis={...analysis,status:'missing'}; assert.equal(await read(requirement),null); record.scriptAnalysis=analysis;
    for (const patch of [{sourceStrategy:'customer_product_image_animation'},{selectedMaterialSegment:{...shot.selectedMaterialSegment,endSeconds:7}},{materialRouting:{...shot.materialRouting,localMatch:{...shot.materialRouting.localMatch,evidenceRef:null}}}]) {
      assert.equal(await createSocialContentLocalSupplyBudgetProofReader({...input,supplyPlan:{shots:[{...shot,...patch}]}} as never)(requirement),null);
    }
    await writeFile(file,'changed'); await assert.rejects(read(requirement),/source_bytes_changed/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('owned product image proves the local motion route with real output bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'local-product-motion-proof-'));
  try {
    const file = path.join(directory, 'product.png');
    const bytes = await sharp({create:{width:180,height:320,channels:3,background:'#f5f5f5'}}).png().toBuffer();
    await writeFile(file, bytes); const sha = createHash('sha256').update(bytes).digest('hex');
    const scope = {tenantId:'tenant',taskId:'task',runId:'run',planHash:'plan'};
    const asset = {id:'product-image',sourceId:'library-product',type:'image',url:file,localPath:file,contentHash:sha,duration:0,visualObservations:[],segments:[]};
    const shot = {shotId:'S02',sourceStrategy:'customer_product_image_animation',sourceRefs:['product-image'],fallbackSourceStrategy:null,
      truthBoundary:{syntheticVisualAllowed:true,customerEvidenceRequired:false},materialRouting:{policy:'local_first_product_i2v',localMatch:{state:'missing',sourceRefs:[],evidenceRef:null}}};
    const input = {scope,supplyPlan:{shots:[shot]},baseline:{scenes:[{sceneId:'S02',referenceStructure:{sourceTiming:{startSeconds:0,endSeconds:1.2}}}]},assets:[asset],assertCurrent:async()=>{},
      repository:{dataStore:{},materialLibrary:async()=>({status:'ready',items:[{id:'product-image',tenantId:'tenant',type:'image',scope:'own',contentSha256:sha}]})}};
    const requirement={key:'scene:S02:customer_product_image_animation',stage:'local_supply_selection',shotId:'S02',sourceRef:null,durationSeconds:1.2,text:null,frameCount:null,inputContractHash:'b'.repeat(64)};
    const proof=await createSocialContentLocalSupplyBudgetProofReader(input as never)(requirement);
    assert.ok(proof); assert.equal(proof.kind,'local_render'); assert.equal(proof.sourceSha256,sha); assert.match(proof.receiptRef,/^local_render:/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('system CTA graphics render real local video bytes before claiming a free route', async () => {
  const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'plan'};
  const shot={shotId:'CTA',sourceStrategy:'motion_graphics',sourceRefs:[],truthBoundary:{subject:'none',confirmedFactRefs:[],syntheticVisualAllowed:true,customerEvidenceRequired:false},
    functionalEquivalentReplacement:{description:'联系企业获取方案'},productionInstruction:'本地片尾联系卡',materialRouting:{policy:'local_only',localMatch:{state:'missing',sourceRefs:[],evidenceRef:null}}};
  const scene={sceneId:'CTA',shotFunction:'call_to_action',subject:'联系企业',action:'展示联系提示',referenceStructure:{sourceTiming:{startSeconds:0,endSeconds:1.2}}};
  const reader=createSocialContentLocalSupplyBudgetProofReader({scope,supplyPlan:{shots:[shot]},baseline:{scenes:[scene]},assets:[],assertCurrent:async()=>{},repository:{dataStore:{},materialLibrary:async()=>({status:'ready',items:[]})}} as never);
  const proof=await reader({key:'scene:CTA:motion_graphics',stage:'local_supply_selection',shotId:'CTA',sourceRef:null,durationSeconds:1.2,text:null,frameCount:null,inputContractHash:'c'.repeat(64)});
  assert.ok(proof);assert.equal(proof.kind,'local_render');assert.match(proof.receiptRef,/^local_render:/);assert.match(proof.sourceSha256,/^[a-f0-9]{64}$/);
});
