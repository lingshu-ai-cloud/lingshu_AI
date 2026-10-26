import {readCurrentConfirmedPresenterFirstFrame} from './socialContentPresenterFirstFrameCurrent.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {prepareNativeHeyGenCatalogueFrames,verifyNativeHeyGenCatalogueApprovalCurrent} from './socialContentNativeHeyGenFirstFrame.js';
import {automaticallyConfirmPresenterFirstFrameApproval,readConfirmedPresenterFirstFrameApproval} from './socialContentPresenterFirstFrameApproval.js';

test('HeyGen licensed catalogue source stays within provider, attests source only, preserves human review and original IDs',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-heygen-source-'));try{
 const store=new LangGraphTestStore(path.join(root,'store.json')),avatarId='a'.repeat(32),voiceId='b'.repeat(32),scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'c'.repeat(64)};
 await store.create('starter_social_content_tasks',{tenant_id:'tenant',task_id:'task',run_id:'run',brief:{presenterSpeechReviewPolicy:'heygen_native_human_review'}});
 const presenter={id:'selected',authorized:true,assetVersion:1,avatarId,voiceId,rightsEvidence:{authorizationRef:'license://heygen/public-catalog/'+avatarId,consentRef:'license://heygen/public-catalog/'+voiceId,grantedAt:'2026-01-01',subjectAdultConfirmed:false,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}};
 await store.create('studio_production_defaults',{tenant_id:'tenant',payload:{presenters:[presenter]}});
 const group={groupId:'mother',presenterAssetId:'selected',presenterGroupContractHash:'d'.repeat(64),compositions:[{referenceShotId:'source'}]};
 const input={scope,groups:[group]} as never;let reads=0;const bytes=Buffer.from('controlled decoded catalogue image'),sha256=createHash('sha256').update(bytes).digest('hex');
 const options={mediaRoot:root,presenters:[presenter],load:async()=>{reads++;return{bytes,sha256,mimeType:'image/jpeg'};}};
 const result=await prepareNativeHeyGenCatalogueFrames(store,input,options);assert.equal(result?.length,1);const frame=result![0]!;
 assert.equal(frame.sourceMode,'heygen_catalog_native');assert.equal(frame.qa.scope,'provider_catalog_source_only');assert.equal(frame.presenter.providerPresenterId,avatarId);assert.equal(frame.presenter.providerVoiceId,voiceId);assert.match(frame.personRemovalEvidence.receiptRef,/^not_applicable:/);
 const report=JSON.parse(await fs.readFile(path.join(root,frame.compositeFirstFrameUrl.slice(7))+'.source-check.json','utf8'));assert.equal(report.independentVisualQaPassed,false);assert.equal(report.referenceCompositionReproduced,false);assert.equal(report.lipSyncStatus,'pending_human_review');
 assert.equal(await verifyNativeHeyGenCatalogueApprovalCurrent(store,scope,frame,root),true);
 assert.equal(await verifyNativeHeyGenCatalogueApprovalCurrent(store,{...scope,runId:'different'},frame,root),false);
 await automaticallyConfirmPresenterFirstFrameApproval(store,{scope,groupId:'mother',expectedRecordHash:frame.recordHash});assert.ok(await readConfirmedPresenterFirstFrameApproval(store,{scope,groupId:'mother',presenterAssetId:'selected',presenterGroupContractHash:group.presenterGroupContractHash}));
 const query={scope,groupId:'mother',presenterAssetId:'selected',presenterGroupContractHash:group.presenterGroupContractHash};
 const before=await fs.readFile(store.filename,'utf8');
 const current=await readCurrentConfirmedPresenterFirstFrame(store,query,{mediaRoot:root,readAssetProvenance:async()=>{throw Error('native_source_must_not_require_ark_provenance');}});
 assert.equal(current?.approval.recordHash,frame.recordHash);assert.equal(current?.approval.assetProvenance,undefined);
 assert.equal(current?.approval.qa.scope,'provider_catalog_source_only');assert.equal(await fs.readFile(store.filename,'utf8'),before,'current source recovery must not rewrite approval, authorization or decision');
 assert.equal(await readCurrentConfirmedPresenterFirstFrame(store,{...query,scope:{...scope,runId:'other'}},{mediaRoot:root}),null);
 assert.equal(await readCurrentConfirmedPresenterFirstFrame(store,{...query,presenterGroupContractHash:'e'.repeat(64)},{mediaRoot:root}),null);
 const defaults=(await store.list<any>('studio_production_defaults',{where:{tenant_id:'tenant'}})).items[0]!;
 await store.update('studio_production_defaults',defaults.id,{payload:{presenters:[{...presenter,voiceEngine:'orca',voiceFingerprint:'new-engine-route-same-physical-voice'}]}});
 assert.equal((await readCurrentConfirmedPresenterFirstFrame(store,query,{mediaRoot:root}))?.approval.recordHash,frame.recordHash,'execution engine metadata cannot invalidate the same physical avatar/voice approval');
 for(const changed of [{...presenter,voiceId:'f'.repeat(32)},{...presenter,assetVersion:2},{...presenter,rightsEvidence:{...presenter.rightsEvidence,consentRef:'license://heygen/public-catalog/changed'}}]){
  await store.update('studio_production_defaults',defaults.id,{payload:{presenters:[changed]}});
  assert.equal(await readCurrentConfirmedPresenterFirstFrame(store,query,{mediaRoot:root}),null);
 }
 await store.update('studio_production_defaults',defaults.id,{payload:{presenters:[presenter]}});
 const sourceFile=path.join(root,frame.compositeFirstFrameUrl.slice(7));await fs.writeFile(sourceFile,Buffer.from('changed source bytes'));
 assert.equal(await readCurrentConfirmedPresenterFirstFrame(store,query,{mediaRoot:root}),null);
 await fs.writeFile(sourceFile,bytes);
 await prepareNativeHeyGenCatalogueFrames(store,input,options);assert.equal(reads,1,'recovery must not regenerate or contact another provider');
 assert.equal(await prepareNativeHeyGenCatalogueFrames(store,{...input as object,groups:[{...group,presenterAssetId:'other'}]} as never,options),null);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
