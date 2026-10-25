import {readCurrentConfirmedPresenterFirstFrame} from './socialContentPresenterFirstFrameCurrent.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {DataStore} from '../storage/datastore.js';
import {automaticallyConfirmPresenterFirstFrameApproval,confirmPresenterFirstFrameApproval,createPresenterFirstFrameApproval,readConfirmedPresenterFirstFrameApproval} from './socialContentPresenterFirstFrameApproval.js';
import {createPresenterFirstFrameAssetProvenance} from './socialContentPresenterFirstFrameAssetProvenance.js';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function memory(){const tables:Record<string,any[]>={};const store={getById:async(c:string,id:string)=>tables[c]?.find(row=>row.id===id)||null,create:async<T=Record<string,unknown>>(c:string,row:Record<string,unknown>):Promise<T|null>=>{const saved={id:`${c}-${(tables[c]?.length||0)+1}`,...structuredClone(row)};(tables[c]??=[]).push(saved);return saved as T;},update:async(c:string,id:string,patch:Record<string,unknown>)=>{const row=tables[c]?.find(item=>item.id===id);if(!row)return false;Object.assign(row,structuredClone(patch));return true;},delete:async()=>false,list:async(c:string,q:any={})=>{const items=(tables[c]||[]).filter(row=>Object.entries(q.where||{}).every(([key,value])=>row[key]===value));return{items,totalItems:items.length,totalPages:items.length?1:0,page:1,perPage:q.perPage||500};}} as DataStore;return{store,tables};}
const scope={tenantId:'tenant-a',taskId:'task',runId:'run',planHash:sha('plan')};
const contract=(change:Record<string,unknown>={})=>({tenantId:scope.tenantId,taskId:scope.taskId,runId:scope.runId,planHash:scope.planHash,groupId:'group-a',presenterGroupContractHash:sha('group'),referenceCompositionHashes:[sha('composition-a'),sha('composition-b')],backgroundPlateSha256:sha('background'),personRemovalEvidence:{receiptRef:'person-removal:receipt',sourceSha256:sha('source-person'),outputSha256:sha('removed-person')},presenter:{assetId:'presenter',assetVersion:4,authorizationRef:'rights://presenter',consentRef:'consent://presenter',providerId:'heygen',providerPresenterId:'avatar',providerVoiceId:'voice'},compositeFirstFrameSha256:sha('composite'),compositeFirstFrameUrl:'/media/tenants/tenant-a/previews/group-a.png',qa:{passed:true,receiptRef:'qa:first-frame',reportHash:sha('qa-report')},createdAt:'2026-10-12T00:00:00.000Z',...change});
test('Seedance motion approval explicitly records no provider avatar or voice without weakening HeyGen contracts',async()=>{
 const f=memory(),presenter={...contract().presenter,providerId:'seedance',identityMode:'enterprise_asset_first_frame' as const,providerPresenterId:null,providerVoiceId:null};
 const approval=await createPresenterFirstFrameApproval(f.store,{...contract(),presenter});
 await automaticallyConfirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash});
 assert.equal((await readConfirmedPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter'}))?.approval.presenter.providerVoiceId,null);
 await assert.rejects(createPresenterFirstFrameApproval(memory().store,{...contract(),presenter:{...presenter,providerId:'heygen'}}),/contract_invalid/);
});
test('explicit decision is replay-safe and tenant/scope isolated',async()=>{const f=memory(),approval=await createPresenterFirstFrameApproval(f.store,contract());assert.equal((await readConfirmedPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter'})),null);const decision=await confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,actorId:'owner',idempotencyKey:'confirm-group-a',decidedAt:'2026-10-12T00:01:00.000Z'});assert.equal((await confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,actorId:'owner',idempotencyKey:'confirm-group-a'})).recordHash,decision.recordHash);assert.ok(await readConfirmedPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter'}));assert.equal(await readConfirmedPresenterFirstFrameApproval(f.store,{scope:{...scope,tenantId:'tenant-b'},groupId:'group-a',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter'}),null);});
test('confirmed flag on preview cannot replace an explicit actor decision',async()=>{const f=memory(),approval=await createPresenterFirstFrameApproval(f.store,{...contract(),confirmed:true} as never);assert.ok(approval.recordHash);assert.equal(await readConfirmedPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter'}),null);});
test('trusted system automatically confirms only a persisted QA-passed contract and client cannot forge its identity',async()=>{const f=memory(),approval=await createPresenterFirstFrameApproval(f.store,contract());const decision=await automaticallyConfirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,decidedAt:'2026-10-12T00:01:00.000Z'});assert.equal(decision.actorId,'system:presenter-first-frame-qa');assert.match(decision.idempotencyKey,/^system-auto-confirm:/);assert.equal((await automaticallyConfirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash})).recordHash,decision.recordHash);await assert.rejects(confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,actorId:'system:presenter-first-frame-qa',idempotencyKey:decision.idempotencyKey}),/reserved_system_identity/);const failed=memory(),bad=await createPresenterFirstFrameApproval(failed.store,contract({qa:{...contract().qa,passed:false}}));await assert.rejects(automaticallyConfirmPresenterFirstFrameApproval(failed.store,{scope,groupId:'group-a',expectedRecordHash:bad.recordHash}),/confirmation_target_changed/);});
test('material, composition, person and presenter drift conflict or invalidate confirmation',async()=>{for(const change of [{backgroundPlateSha256:sha('changed-background')},{referenceCompositionHashes:[sha('changed-composition')]},{personRemovalEvidence:{receiptRef:'person-removal:receipt',sourceSha256:sha('changed-person'),outputSha256:sha('removed-person')}},{presenter:{...contract().presenter,assetVersion:5}}]){const f=memory(),approval=await createPresenterFirstFrameApproval(f.store,contract());await assert.rejects(createPresenterFirstFrameApproval(f.store,contract(change)),/contract_conflict/);await confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,actorId:'owner',idempotencyKey:'confirm-group-a'});assert.equal(await readConfirmedPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',presenterGroupContractHash:sha('changed-group'),presenterAssetId:'presenter'}),null);}});
test('tampered contract or decision bytes fail closed',async()=>{const f=memory(),approval=await createPresenterFirstFrameApproval(f.store,contract());await confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,actorId:'owner',idempotencyKey:'confirm-group-a'});f.tables.social_presenter_first_frame_approvals[0].payload.compositeFirstFrameSha256=sha('tampered');assert.equal(await readConfirmedPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter'}),null);});

test('automatic continuation reuses a valid earlier human confirmation without rewriting consent',async()=>{
 const f=memory(),approval=await createPresenterFirstFrameApproval(f.store,contract());
 const manual=await confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,actorId:'owner',idempotencyKey:'human-approved'});
 const continued=await automaticallyConfirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash});
 assert.equal(continued.recordHash,manual.recordHash);assert.equal(continued.actorId,'owner');assert.equal(f.tables.social_presenter_first_frame_decisions.length,1);
});

test('confirmed first frame is reusable only for the exact three-asset provenance manifest',async()=>{
 const f=memory(),assetProvenance=createPresenterFirstFrameAssetProvenance({presenter:{assetId:'presenter',assetVersion:4,referenceAssetIds:['person-front'],referenceSha256s:[sha('person-v4')]},products:[{productId:'SKU-1',enterpriseFactRef:'enterprise-product:SKU-1',enterpriseFactVersion:'facts-v3',referenceImageIds:['sku-front'],referenceImageSha256s:[sha('sku-front-v3')]}],background:{referenceSourceId:'benchmark-1',referenceShotId:'shot-2',startSeconds:1.2,endSeconds:3.4,referenceFirstFrameRef:'/api/overseas/videos/benchmark-1/shot/2/first-frame',referenceFirstFrameSha256:sha('benchmark-shot-2')}});
 const approval=await createPresenterFirstFrameApproval(f.store,{...contract(),assetProvenance});
 await confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,actorId:'owner',idempotencyKey:'approve-exact-assets'});
 const query={scope,groupId:'group-a',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter'};
 assert.ok(await readConfirmedPresenterFirstFrameApproval(f.store,{...query,expectedAssetProvenanceHash:assetProvenance.manifestHash}));
 assert.equal(await readConfirmedPresenterFirstFrameApproval(f.store,{...query,expectedAssetProvenanceHash:sha('changed-upstream-assets')}),null);
 assert.equal((await readCurrentConfirmedPresenterFirstFrame(f.store,query,{readAssetProvenance:async()=>assetProvenance.manifestHash}))?.approval.recordHash,approval.recordHash);
 assert.equal(await readCurrentConfirmedPresenterFirstFrame(f.store,query,{readAssetProvenance:async()=>sha('changed-upstream-assets')}),null);
 assert.equal(await readCurrentConfirmedPresenterFirstFrame(f.store,query,{readAssetProvenance:async()=>null}),null,'composite approval must not inherit the catalogue-only source exception');
});


test('target ratio is included in frozen approval hash and cannot reuse another ratio decision',async()=>{
 const f=memory(),initial=await createPresenterFirstFrameApproval(f.store,contract({targetAspectRatio:'9:16'}));
 const decision=await confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:initial.recordHash,actorId:'owner',idempotencyKey:'ratio-confirmation'});
 assert.equal(decision.approvalRecordHash,initial.recordHash);
 await assert.rejects(createPresenterFirstFrameApproval(f.store,contract({targetAspectRatio:'1:1'})),/contract_conflict/);
 await assert.rejects(createPresenterFirstFrameApproval(memory().store,contract({targetAspectRatio:'4:3'})),/contract_invalid/);
 f.tables.social_presenter_first_frame_approvals[0].payload.targetAspectRatio='1:1';
 assert.equal(await readConfirmedPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter'}),null);
});


test('technical-only legacy evidence cannot create an automatic visual approval',async()=>{
 const f=memory(),approval=await createPresenterFirstFrameApproval(f.store,contract({qa:{...contract().qa,receiptRef:'local-technical:'+sha('technical-only')}}));
 await assert.rejects(automaticallyConfirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash}),/visual_qa_required/);
 assert.equal(f.tables.social_presenter_first_frame_decisions,undefined);
 const manual=await confirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash,actorId:'owner',idempotencyKey:'legacy-human-reviewed'});
 assert.equal((await automaticallyConfirmPresenterFirstFrameApproval(f.store,{scope,groupId:'group-a',expectedRecordHash:approval.recordHash})).recordHash,manual.recordHash,'explicit historical human decisions stay readable');
});
