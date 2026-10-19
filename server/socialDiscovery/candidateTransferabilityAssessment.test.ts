import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {CANDIDATE_CONTEXT_ASSESSMENTS, type CandidateContextAssessment} from './candidateContextAssessment.js';
import {CANDIDATE_SEMANTIC_ASSESSMENTS,CANDIDATE_SEMANTIC_OPERATIONS,CANDIDATE_SEMANTIC_PROVIDER_RECEIPTS,type CandidateSemanticAssessment} from './candidateSemanticAssessment.js';
import {createCandidateTransferabilityAssessment,createAutomaticCandidateTransferabilityAssessment,readCandidateTransferabilityAssessment,CANDIDATE_TRANSFERABILITY_ASSESSMENTS,type CandidateTargetShotMapping} from './candidateTransferabilityAssessment.js';
import {readTrustedHeyGenRuntimeBinding} from '../starter198/socialContentHeyGenRuntimeBinding.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import {createHash} from 'node:crypto';
import {buildSocialWorkflowMaterialCandidates} from '../starter198/socialContentRecords.js';

async function setup(t:Parameters<typeof prepareWeeklyEnterpriseFactFixture>[0],moving=false,observation?:{materialType:string;observedFacts:string;visual:string}){
 const f=await prepareWeeklyEnterpriseFactFixture(t),fact=f.authority.snapshot.enterprise.publicFacts.find(v=>v.statement==='Serum')!;
 const context:CandidateContextAssessment={schema:'candidate-context-assessment.v1',assessmentId:'context',tenantId:'tenant-a',candidateId:'candidate',programId:'program-a',packageId:'package-a',packageVersion:1,canonical:{analysisRunId:'exact',analysisHash:'a',mediaSha256:'a'.repeat(64),sourceUrl:'https://example.test/video',completionReceiptHash:'a'},productFacts:[fact],factsHash:'a',audienceRole:'brand_buyer',keyword:{scopeId:'scope',scopeVersion:1,queryRef:'skincare',tier:'broad',scopeHash:'a'},observations:[{shotIndex:1,time:'0-2',materialType:observation?.materialType??'product',observedFacts:observation?.observedFacts??'静态护肤品瓶身展示',visual:observation?.visual??(moving?'手部涂抹产品':'静态产品特写')}],dimensions:{relevance:{value:null,state:'unknown',reasons:[]},transferability:{value:null,state:'unknown',reasons:[]}},decision:'review',gaps:[],actorUserId:'owner',createdAt:'2026-10-18T00:00:00Z',recordHash:'',newProviderRequests:0,newCostCny:0};
 context.recordHash=socialRequestHash({...context,recordHash:''});
 await f.store.create(CANDIDATE_CONTEXT_ASSESSMENTS,{id:context.assessmentId,tenant_id:'tenant-a',record_hash:context.recordHash,payload:context});
 const op={operationId:'candidate-semantic:context',contextHash:context.recordHash},receipt={...op,response:{id:'provider-response'}};
 await f.store.create(CANDIDATE_SEMANTIC_OPERATIONS,{id:op.operationId,tenant_id:'tenant-a',record_hash:socialRequestHash(op),payload:op});
 await f.store.create(CANDIDATE_SEMANTIC_PROVIDER_RECEIPTS,{id:op.operationId,tenant_id:'tenant-a',record_hash:socialRequestHash(receipt),payload:receipt});
 const semantic:CandidateSemanticAssessment={schema:'candidate-semantic-assessment.v1',assessmentId:'semantic',contextAssessmentId:'context',contextHash:context.recordHash,tenantId:'tenant-a',candidateId:'candidate',operationId:op.operationId,providerReceiptRef:op.operationId,dimensions:{relevance:{value:.83,state:'assessed',evidence:[{factRef:`${fact.ref.type}:${fact.ref.id}@${fact.ref.version}`,shotIndex:1,quote:'静态护肤品瓶身',reason:'product'}],reasons:[]},transferability:{value:null,state:'unknown',evidence:[],reasons:['target_production_resource_mapping_required']}},decision:'review',gaps:['target_production_resource_mapping_required'],recordHash:'',costCny:null,costState:'retained_unknown'};
 semantic.recordHash=socialRequestHash({...semantic,recordHash:''});
 await f.store.create(CANDIDATE_SEMANTIC_ASSESSMENTS,{id:semantic.assessmentId,tenant_id:'tenant-a',candidate_id:'candidate',context_id:'context',record_hash:semantic.recordHash,payload:semantic});
 // The weekly voice gate requires a retained, tenant-owned source record even
 // in an isolated test. Keep the fixture fictional and never bind golden data.
 await f.store.create('studio_presenter_assets',{id:'fixture-presenter-source',tenant_id:'tenant-a',kind:'import_authorization',payload:{lookId:'avatar',voiceId:'voice',groupId:'fixture-group',authorizationDeclared:true,adultConfirmed:true,reviewed:true,providerConsentAccepted:false}});
 const rights={authorizationRef:'document://studio_presenter_assets/fixture-presenter-source/avatar',consentRef:'consent://user-declaration/fixture-presenter-source',grantedAt:'2026-01-01T00:00:00Z',subjectAdultConfirmed:true,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']};
 await f.store.create('studio_production_defaults',{id:'defaults',tenant_id:'tenant-a',payload:{defaultPresenterId:'person',presenters:[{id:'person',assetVersion:1,authorized:true,avatarId:'avatar',voiceId:'voice',rightsEvidence:rights}]}});
 const productId=String(f.profile.products?.items?.[0]?.id||f.profile.products?.items?.[0]?.productId||f.profile.products?.items?.[0]?.sku||'product-0');
 const material={id:'image',tenantId:'tenant-a',productId,scope:'own',type:'image',sourceType:'enterprise_product_table',rightsStatus:'authorized',commercialUseApproved:true,rightsEvidenceRef:'enterprise_profile:sku',contentSha256:'b'.repeat(64)};
 const binding={tenantId:'tenant-a',presenterAssetId:'person',assetVersion:1,avatarId:'avatar',voiceId:'voice',model:'avatar_iv',accountRef:'account',credentialSha256:'c'.repeat(64),avatarType:'digital_twin',billingCurrency:'USD',billingEvidenceRef:'billing',authorizationRef:'rights://person',consentRef:'consent://person',providerEvidenceRef:'provider'};
 const ports={materials:async()=>({items:[material],status:'ready'}),livePresenter:async()=>binding,privateAssetTenantId:()=> 'tenant-a'} as any;
 const mapping=[{shotIndex:1,route:'enterprise_product_still' as const,productId,imageId:'image',factRef:`${fact.ref.type}:${fact.ref.id}@${fact.ref.version}`}];
 return {...f,context,semantic,ports,mapping,material,binding};
}

test('post-analysis static product shot is admitted only with complete owned image, fact and live bound presenter/voice evidence',async t=>{
 const f=await setup(t);
 const item=await createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping:f.mapping,presenterAssetId:'person',ports:f.ports});
 assert.equal(item.state,'assessed');assert.equal(item.materialHashes[0]?.contentSha256,'b'.repeat(64));
 assert.deepEqual(await readCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,ports:f.ports}),item);
 assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,1);
 await assert.rejects(readCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,ports:{...f.ports,materials:async()=>({items:[{...f.material,contentSha256:'d'.repeat(64)}],status:'ready'})}}),/current_resources_changed/);
});

test('automatic same-tenant static mapping is durable and restart-idempotent; missing or ambiguous target images cannot write',async t=>{
 const f=await setup(t),input={store:f.store,context:f.context,semantic:f.semantic,ports:f.ports};
 const first=await createAutomaticCandidateTransferabilityAssessment(input);
 assert.equal(first.mapping[0]?.route,'enterprise_product_still');
 assert.deepEqual(await createAutomaticCandidateTransferabilityAssessment(input),first);
 assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,1);
 await assert.rejects(createAutomaticCandidateTransferabilityAssessment({...input,ports:{...f.ports,materials:async()=>({status:'ready',items:[f.material,{...f.material,id:'another-image'}]})}}),/auto_image_missing_or_ambiguous/);
 assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,1);
});

test('talking-head candidate cannot use a text-only presenter route or a static image to claim production readiness',async t=>{
 const f=await setup(t,false,{materialType:'talking_head',observedFacts:'人物稳定口播',visual:'人物正脸讲述'});
 await assert.rejects(createAutomaticCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,ports:f.ports}),/presenter_temporal_proof_required/);
 await assert.rejects(createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,presenterAssetId:'person',mapping:[{shotIndex:1,route:'bound_digital_presenter',pipeline:'heygen',temporalEvidenceRef:'self-asserted'}],ports:f.ports}),/presenter_temporal_proof_required/);
 assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,0);
});

test('missing or cross-tenant resources, unsupported action, and unbound voice never create an assessed receipt',async t=>{
 const f=await setup(t),base={store:f.store,context:f.context,semantic:f.semantic,mapping:f.mapping,presenterAssetId:'person',ports:f.ports};
 await assert.rejects(createCandidateTransferabilityAssessment({...base,mapping:[]}),/complete_mapping_required/);
 await assert.rejects(createCandidateTransferabilityAssessment({...base,ports:{...f.ports,materials:async()=>({items:[{...f.material,tenantId:'other'}],status:'ready'})}}),/product_image_unverified/);
 await assert.rejects(createCandidateTransferabilityAssessment({...base,ports:{...f.ports,materials:async()=>({items:[],status:'ready'})}}),/image_missing/);
 await assert.rejects(createCandidateTransferabilityAssessment({...base,ports:{...f.ports,livePresenter:async()=>({...f.binding,voiceId:'other'})}}),/presenter_voice_unverified/);
 assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,0);
});

test('a real action shot cannot be represented by a static product image',async t=>{
 const f=await setup(t,true);
 await assert.rejects(createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping:f.mapping,presenterAssetId:'person',ports:f.ports}),/shot_route_unproven/);
 assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,0);
});

test('missing HeyGen credential stops before any provider GET or transferability receipt',async t=>{
 const f=await setup(t);let gets=0;
 const livePresenter=((input:any,ports:any)=>readTrustedHeyGenRuntimeBinding(input,{...ports,env:()=>({}),readProvider:async()=>{gets++;throw Error('unexpected provider GET');}})) as typeof readTrustedHeyGenRuntimeBinding;
 await assert.rejects(createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping:f.mapping,presenterAssetId:'person',ports:{...f.ports,livePresenter}}),/heygen_runtime_account_missing/);
 assert.equal(gets,0);assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,0);
});

test('unknown or wrong private-asset tenant binding stops before supplier GET',async t=>{
 const f=await setup(t);let gets=0;
 const livePresenter=(async()=>{gets++;return f.binding}) as any;
 for(const owner of [undefined,'other-tenant'])await assert.rejects(createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping:f.mapping,presenterAssetId:'person',ports:{...f.ports,privateAssetTenantId:()=>owner,livePresenter}}),/provider_tenant_binding_required/);
 assert.equal(gets,0);assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,0);
});

test('owned analyzed factory footage maps to an exact real video segment, not an image',async t=>{
 const f=await setup(t,false,{materialType:'factory',observedFacts:'工厂机器灌装产品',visual:'灌装设备连续运行'});
 const bytes=Buffer.from('tenant-owned-factory-video');
 const segments=[{id:'factory-fill',start:0,end:4,confidence:.95,boundaryConfidence:.95,cleanEntry:true,cleanExit:true,subject:['工厂灌装线'],environment:'工厂车间',action:'机器灌装设备连续运行',interaction:'factory_process'}];
 const video={id:'factory-video',tenantId:'tenant-a',scope:'own',type:'video',name:'工厂灌装',duration:4,sourceRevision:'revision:factory-video',contentSha256:createHash('sha256').update(bytes).digest('hex'),rightsStatus:'owned',commercialUseApproved:true,licenseEvidence:'enterprise-factory-rights',segments,scriptAnalysis:buildMaterialScriptAnalysis({materialId:'factory-video',name:'工厂灌装',sourceRevision:'revision:factory-video',duration:4,segments})};
 const ports={...f.ports,materials:async()=>({items:[f.material,video],status:'ready'}),materialBytes:async()=>({bytes,mimeType:'video/mp4'})} as any;
 const mapping:CandidateTargetShotMapping[]=[{shotIndex:1,route:'owned_local_video_segment',materialType:'factory',assetId:'factory-video',segmentId:'factory-fill',sourceRevision:'revision:factory-video'}];
 const item=await createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping,presenterAssetId:'person',ports});
 assert.equal(item.materialHashes[0]?.assetId,'factory-video');
 assert.equal((await readCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,ports}))?.assessmentId,item.assessmentId);
 await assert.rejects(readCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,ports:{...ports,materialBytes:async()=>({bytes:Buffer.from('changed'),mimeType:'video/mp4'})}}),/video_bytes_changed/);
});

test('product action and D to C require same-product video plus the enterprise image lock',async t=>{
 for(const [kind,observed,segment] of [
  ['product','手持旋转产品包装','手持旋转产品包装'],
  ['consumer_demo','消费者涂抹使用产品','消费者涂抹使用产品'],
 ] as const){
  const f=await setup(t,false,{materialType:kind,observedFacts:observed,visual:observed});
  const bytes=Buffer.from(`real-${kind}`),productId=f.mapping[0]!.productId;
  const segments=[{id:`${kind}-segment`,start:0,end:4,confidence:.95,boundaryConfidence:.95,cleanEntry:true,cleanExit:true,subject:kind==='product'?['手持产品包装']:['person','product'],environment:'室内',action:segment,interaction:kind==='product'?'person_holding_product':'person_using_product',...(kind==='consumer_demo'?{productUsage:{kind:'apply_to_face',description:segment}}:{})}];
  const video={id:`${kind}-video`,tenantId:'tenant-a',scope:'own',type:'video',name:kind,duration:4,productId,productRef:`product:${productId}`,sourceRevision:`revision:${kind}`,contentSha256:createHash('sha256').update(bytes).digest('hex'),rightsStatus:'owned',commercialUseApproved:true,licenseEvidence:`rights:${kind}`,segments,scriptAnalysis:buildMaterialScriptAnalysis({materialId:`${kind}-video`,name:kind,sourceRevision:`revision:${kind}`,duration:4,segments,productId,productRef:`product:${productId}`})};
  const candidates=buildSocialWorkflowMaterialCandidates({records:[video],tenantId:'tenant-a',voiceoverRows:[],selectedProductId:productId,selectedProductRef:`product:${productId}`});
  assert.ok(candidates.candidates.length,JSON.stringify({kind,shots:video.scriptAnalysis.shots,rejected:candidates.rejectedSegments}));
  const ports={...f.ports,materials:async()=>({items:[f.material,video],status:'ready'}),materialBytes:async()=>({bytes,mimeType:'video/mp4'})} as any;
  const mapping=[{shotIndex:1,route:'owned_local_video_segment' as const,materialType:kind,assetId:video.id,segmentId:segments[0]!.id,sourceRevision:video.sourceRevision,productId,imageId:'image',factRef:f.mapping[0]!.factRef}];
  const item=await createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping,presenterAssetId:'person',ports});
  assert.equal(item.materialHashes.length,2);
  await assert.rejects(createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping:[{...mapping[0]!,productId:'wrong'}],presenterAssetId:'person',ports}),/product_fact_unverified/);
  await assert.rejects(createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping,presenterAssetId:'person',ports:{...ports,materials:async()=>({items:[f.material,{...video,commercialUseApproved:false}],status:'ready'})}}),/video_segment_unverified/);
 }
});

test('a moving product shot with only an enterprise still cannot enter the local-video route',async t=>{
 const f=await setup(t,false,{materialType:'product',observedFacts:'手持旋转产品包装',visual:'真实手部动作'});
 const product=f.mapping[0]!;
 const mapping:CandidateTargetShotMapping[]=[{shotIndex:1,route:'owned_local_video_segment',materialType:'product',assetId:'missing-video',segmentId:'missing-segment',sourceRevision:'missing',productId:product.productId,imageId:product.imageId,factRef:product.factRef}];
 await assert.rejects(createCandidateTransferabilityAssessment({store:f.store,context:f.context,semantic:f.semantic,mapping,presenterAssetId:'person',ports:f.ports}),/video_missing_or_ambiguous/);
 assert.equal((await f.store.list(CANDIDATE_TRANSFERABILITY_ASSESSMENTS)).totalItems,0);
});
