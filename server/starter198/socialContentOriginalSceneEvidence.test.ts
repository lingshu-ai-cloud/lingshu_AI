import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isPresenterOriginalSceneFirstEvidence,isPresenterBackgroundFirstEvidence,type PresenterOriginalSceneFirstEvidence} from '../../shared/contracts/presenterBackgroundFirst.js';
import {createOriginalScenePresenterAssetProvenance,isOriginalScenePresenterAssetProvenance} from './socialContentPresenterFirstFrameAssetProvenance.js';
import {createOriginalScenePresenterFirstFrameApproval,automaticallyConfirmPresenterFirstFrameApproval,readConfirmedPresenterFirstFrameApproval} from './socialContentPresenterFirstFrameApproval.js';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const at='2026-10-26T00:00:00.000Z';
function fixture(){
 const source={kind:'original_scene' as const,sceneContractHash:sha('scene'),promptHash:sha('prompt')};
 const qa=(id:string)=>({operationId:id,passed:true,receiptRef:`receipt:${id}`,reportHash:sha(id)});
 const evidence:PresenterOriginalSceneFirstEvidence={schemaVersion:'presenter-background-first.v3',aspectRatio:'9:16',source,
  background:{artifactRef:'/media/tenants/t/bg.png',sha256:sha('bg'),width:720,height:1280,createdAt:at,operationId:'bg',receiptRef:'receipt:bg',qa:qa('bg-qa')},
  composite:{artifactRef:'/media/tenants/t/fg.png',sha256:sha('fg'),plateSha256:sha('bg'),width:720,height:1280,createdAt:at,operationId:'fg',receiptRef:'receipt:fg',qa:qa('fg-qa'),presenterAssetId:'person',presenterAssetVersion:2}};
 const provenance=createOriginalScenePresenterAssetProvenance({source,presenter:{assetId:'person',assetVersion:2,referenceAssetIds:['portrait'],referenceSha256s:[sha('portrait')]},products:[]});
 const scope={tenantId:'t',taskId:'task',runId:'run',planHash:sha('plan')};
 const approval={...scope,groupId:'group',presenterGroupContractHash:sha('group'),sourceMode:'original_scene' as const,targetAspectRatio:'9:16' as const,referenceCompositionHashes:[],backgroundPlateSha256:evidence.background.sha256,
  originalScene:evidence,originalSceneProvenance:provenance,presenter:{assetId:'person',assetVersion:2,authorizationRef:'rights',consentRef:'consent',providerId:'heygen',providerPresenterId:'avatar',providerVoiceId:'voice'},compositeFirstFrameSha256:evidence.composite.sha256,compositeFirstFrameUrl:evidence.composite.artifactRef,qa:{passed:true,receiptRef:evidence.composite.qa.receiptRef,reportHash:evidence.composite.qa.reportHash},createdAt:at};
 return{evidence,provenance,scope,approval};
}
test('original scene evidence binds real outputs and rejects fictitious benchmark/removal data',()=>{
 const {evidence,provenance}=fixture();assert.ok(isPresenterOriginalSceneFirstEvidence(evidence));assert.ok(isOriginalScenePresenterAssetProvenance(provenance));assert.equal(isPresenterBackgroundFirstEvidence(evidence),false);
 for(const mutate of [(v:any)=>{v.source.promptHash='bad';},(v:any)=>{v.source.referenceFirstFrameSha256=sha('fake');},(v:any)=>{v.sourceFirstFrameSha256=sha('fake');},(v:any)=>{v.background.personRemovalMethod='fake';},(v:any)=>{v.composite.plateSha256=sha('other');},(v:any)=>{v.background.qa.passed=false;},(v:any)=>{v.composite.width=1000;},(v:any)=>{v.composite.qa.operationId='bg';}]){const bad=structuredClone(evidence);mutate(bad);assert.equal(isPresenterOriginalSceneFirstEvidence(bad),false);}
 const changed=structuredClone(provenance);changed.source.promptHash=sha('different');assert.equal(isOriginalScenePresenterAssetProvenance(changed),false);
});
test('v3 approval confirms and replays without a reference URL or person removal claim; drift fails closed',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'original-scene-evidence-')),store=new LangGraphTestStore(path.join(root,'db.json'));
 try{
  const f=fixture(),saved=await createOriginalScenePresenterFirstFrameApproval(store,f.approval);
  assert.equal(saved.schemaVersion,'social-presenter-first-frame-approval.v3');assert.equal(saved.personRemovalEvidence,undefined);
  assert.equal((await createOriginalScenePresenterFirstFrameApproval(store,f.approval)).recordHash,saved.recordHash);
  await automaticallyConfirmPresenterFirstFrameApproval(store,{scope:f.scope,groupId:'group',expectedRecordHash:saved.recordHash});
  const query={scope:f.scope,groupId:'group',presenterGroupContractHash:sha('group'),presenterAssetId:'person',expectedAssetProvenanceHash:f.provenance.manifestHash};
  assert.ok(await readConfirmedPresenterFirstFrameApproval(store,query));assert.equal(await readConfirmedPresenterFirstFrameApproval(store,{...query,expectedAssetProvenanceHash:sha('wrong')}),null);
  for(const mutate of [(v:any)=>{v.personRemovalEvidence={receiptRef:'fake',sourceSha256:sha('fake'),outputSha256:sha('fake')};},(v:any)=>{v.originalScene.source.promptHash=sha('changed');},(v:any)=>{v.originalScene.composite.presenterAssetVersion++;},(v:any)=>{v.originalScene.background.artifactRef='/media/tenants/other/bg.png';},(v:any)=>{v.referenceCompositionHashes=[sha('fake')];}]){
   const bad=structuredClone(f.approval);mutate(bad);await assert.rejects(createOriginalScenePresenterFirstFrameApproval(store,bad),/contract_invalid/);
  }
  const changed=fixture();changed.approval.originalSceneProvenance=createOriginalScenePresenterAssetProvenance({...changed.provenance,source:{...changed.provenance.source,promptHash:sha('new')}});changed.approval.originalScene.source.promptHash=sha('new');
  await assert.rejects(createOriginalScenePresenterFirstFrameApproval(store,changed.approval),/contract_conflict/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('current original approval verifies both output files and current person/product bytes without reference lookup',async()=>{
 const {default:fs}=await import('node:fs/promises'),{default:sharp}=await import('sharp');
 const {readCurrentConfirmedPresenterFirstFrame}=await import('./socialContentPresenterFirstFrameCurrent.js');
 const {currentOriginalScenePresenterProvenanceHash}=await import('./socialContentPresenterFirstFrameRuntime.js');
 const root=mkdtempSync(path.join(tmpdir(),'original-current-')),store=new LangGraphTestStore(path.join(root,'db.json')),mediaRoot=path.join(root,'media'),dir=path.join(mediaRoot,'tenants','t');
 try{
  await fs.mkdir(dir,{recursive:true});
  const image=(color:string)=>sharp({create:{width:720,height:1280,channels:3,background:color}}).png().toBuffer();
  const bg=await image('#ddeeff'),fg=await image('#eeffee'),person=await image('#ffffff'),product=await image('#222222');
  for(const [name,bytes] of [['bg',bg],['fg',fg],['person',person],['product',product]] as const)await fs.writeFile(path.join(dir,`${name}.png`),bytes);
  const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex'),f=fixture();
  f.evidence.background.sha256=digest(bg);f.evidence.composite.sha256=digest(fg);f.evidence.composite.plateSha256=digest(bg);
  f.provenance=createOriginalScenePresenterAssetProvenance({source:f.evidence.source,presenter:{...f.provenance.presenter,referenceSha256s:[digest(person)]},products:[{productId:'p',enterpriseFactRef:'fact:p',enterpriseFactVersion:'v1',referenceImageIds:['product'],referenceImageSha256s:[digest(product)]}]});
  Object.assign(f.approval,{originalScene:f.evidence,originalSceneProvenance:f.provenance,backgroundPlateSha256:digest(bg),compositeFirstFrameSha256:digest(fg)});
  f.approval.presenter.authorizationRef='rights://person';f.approval.presenter.consentRef='consent://person';
  const rights={authorizationRef:'rights://person',consentRef:'consent://person',grantedAt:'2026-01-01T00:00:00.000Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']};
  const presenter={id:'person',assetVersion:2,authorized:true,avatarId:'avatar',voiceId:'voice',rightsEvidence:rights};
  const defaults=await store.create<any>('studio_production_defaults',{tenant_id:'t',payload:{presenters:[presenter]}});
  const saved=await createOriginalScenePresenterFirstFrameApproval(store,f.approval);await automaticallyConfirmPresenterFirstFrameApproval(store,{scope:f.scope,groupId:'group',expectedRecordHash:saved.recordHash});
  const load=async(name:string)=>{const bytes=await fs.readFile(path.join(dir,`${name}.png`));return{bytes,mimeType:'image/png' as const,sha256:digest(bytes)};};
  const options={mediaRoot,readOriginalSceneProvenance:(dataStore:Parameters<typeof currentOriginalScenePresenterProvenanceHash>[0],input:Parameters<typeof currentOriginalScenePresenterProvenanceHash>[1])=>currentOriginalScenePresenterProvenanceHash(dataStore,input,{loadPresenterMaster:()=>load('person'),loadProductReferences:async()=>[{...await load('product'),assetId:'product'}]}),readAssetProvenance:async()=>{throw Error('must_not_read_reference');}};
  const query={scope:f.scope,groupId:'group',presenterGroupContractHash:sha('group'),presenterAssetId:'person'};
  assert.ok(await readCurrentConfirmedPresenterFirstFrame(store,query,options));
  await fs.writeFile(path.join(dir,'person.png'),product);assert.equal(await readCurrentConfirmedPresenterFirstFrame(store,query,options),null);await fs.writeFile(path.join(dir,'person.png'),person);
  await fs.writeFile(path.join(dir,'product.png'),person);assert.equal(await readCurrentConfirmedPresenterFirstFrame(store,query,options),null);await fs.writeFile(path.join(dir,'product.png'),product);
  await fs.writeFile(path.join(dir,'bg.png'),fg);await assert.rejects(readCurrentConfirmedPresenterFirstFrame(store,query,options),/artifact_changed/);await fs.writeFile(path.join(dir,'bg.png'),bg);
  await fs.unlink(path.join(dir,'fg.png'));assert.equal(await readCurrentConfirmedPresenterFirstFrame(store,query,options),null);
  await fs.writeFile(path.join(dir,'fg-copy.png'),fg);await fs.symlink(path.join(dir,'fg-copy.png'),path.join(dir,'fg.png'));await assert.rejects(readCurrentConfirmedPresenterFirstFrame(store,query,options),/artifact_not_owned/);await fs.unlink(path.join(dir,'fg.png'));await fs.writeFile(path.join(dir,'fg.png'),fg);
  await store.update('studio_production_defaults',defaults.id,{payload:{presenters:[{...presenter,voiceId:'changed'}]}});await assert.rejects(readCurrentConfirmedPresenterFirstFrame(store,query,options),/presenter_binding_changed/);
  await store.update('studio_production_defaults',defaults.id,{payload:{presenters:[{...presenter,assetVersion:3}]}});await assert.rejects(readCurrentConfirmedPresenterFirstFrame(store,query,options),/presenter_version_changed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('approved original talking satisfies static staging only; dynamic or unbound requests remain rejected',async()=>{
 const {createSocialDigitalPresenterAdapter,hasApprovedOriginalPresenterScene}=await import('./socialContentDigitalPresenterAdapter.js');
 const {presenterFirstFrameApprovalHash}=await import('./socialContentPresenterFirstFrameApproval.js');
 const f=fixture(),body={schemaVersion:'social-presenter-first-frame-approval.v3' as const,...f.approval},approval={...body,recordHash:presenterFirstFrameApprovalHash(body)};
 const frame={approvalRecordId:'approval',approvalRecordHash:approval.recordHash,presenterGroupContractHash:approval.presenterGroupContractHash,url:approval.compositeFirstFrameUrl,localPath:'/offline/frame.png',sha256:approval.compositeFirstFrameSha256,targetAspectRatio:'9:16' as const,originalSceneApproval:approval};
 assert.ok(hasApprovedOriginalPresenterScene(frame,'t','task'));assert.equal(hasApprovedOriginalPresenterScene(frame,'other','task'),false);
 let submitted=0;const controls:string[][]=[];
 const adapter=createSocialDigitalPresenterAdapter({capabilities:{methods:['talking'],controls:['scripted_speech','timing_control']},resolvePresenter:async()=>({presenterAssetId:'person',assetVersion:2,providerId:'heygen',providerPresenterId:'avatar',providerVoiceId:'voice',authorizationRef:'rights',consentRef:'consent',authorized:true}),authorizeBudget:async()=>({allowed:true,reservationRef:'budget'}),execute:async input=>{submitted++;controls.push(input.visualControl.requiredCapabilities);throw Error('offline_submission_reached');}});
 const context:any={tenantId:'t',taskId:'task',outputDirectory:'/offline',availableAssets:[],baselineScene:{sceneId:'scene',subject:'人物在工厂口播',action:'口播说明',voiceover:'Hello'},shot:{shotId:'scene',sourceRefs:['person'],sourceStrategy:'authorized_digital_presenter',requestedDescription:'人物在工厂口播',approvedFirstFrame:frame,digitalHumanPlan:{workflow:'material_processing',method:'talking',executionState:'ready_for_capability_check',presenterAssetIds:['person']},visualContract:{environment:{kind:'factory',description:'明亮工厂'},interaction:{kind:'none'},action:{path:'口播说明'},camera:{shotSize:'medium',angle:'eye-level',movement:'static',composition:'centered'}}}};
 await assert.rejects(adapter.execute(context),/offline_submission_reached/);assert.deepEqual(controls[0],['scripted_speech','timing_control']);
 for(const change of [
  (c:any)=>{delete c.shot.approvedFirstFrame.originalSceneApproval;},
  (c:any)=>{c.shot.approvedFirstFrame.originalSceneApproval.originalScene.source.promptHash=sha('tampered');},
  (c:any)=>{c.shot.visualContract.action.path='walk across room';},
  (c:any)=>{c.shot.visualContract.camera.movement='pan';},
  (c:any)=>{c.shot.visualContract.interaction.kind='person_using_product';c.shot.requestedDescription='人物使用产品';},
  (c:any)=>{c.baselineScene.referenceStructure={cameraMovement:'pan',sourceTiming:{startSeconds:0,endSeconds:3,durationSeconds:3}};},
 ]){const changed=structuredClone(context);change(changed);await assert.rejects(adapter.execute(changed),/digital_presenter_capability_unsupported:controls:/);}
 assert.equal(submitted,1,'unsupported variants never enter the supplier port');
});
