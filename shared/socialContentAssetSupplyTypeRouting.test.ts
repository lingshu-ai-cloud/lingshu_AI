import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocialAssetSupplyPlan,classifySocialAssetSupplyMaterialType} from './socialContentAssetSupply';

const inventory={customerVideoIds:['product-local','consumer-local'],factoryEvidenceAssetIds:['factory-local'],productIdentityGroups:[{productRef:'own-product',imageIds:['own-image']}]};
function plan(shot:any,extra:any={}){return createSocialAssetSupplyPlan({creationMode:'viral_replication',materialRoutingPolicyVersion:'type-aware.v1',productionApproach:'ai_enhanced',inventory,shots:[shot],...extra}).shots[0];}
test('factory and consumer scenes remain real local media even with people, product images and generation routes',()=>{
 const factory=plan({shotId:'factory',function:'trust',materialType:'factory',requestedDescription:'员工在工厂灌装产品',localVideoMatch:{sourceRefs:['factory-local'],semanticMatch:'verified',evidenceRef:'semantic:filling-action'}});
 assert.equal(factory.sourceStrategy,'customer_real_asset');assert.deepEqual(factory.sourceRefs,['factory-local']);assert.equal(factory.materialRouting?.policy,'local_only');assert.equal(factory.fallbackSourceStrategy,null);assert.equal(factory.truthBoundary.syntheticVisualAllowed,false);
 const consumer=plan({shotId:'use',function:'demonstration',materialType:'consumer_demo',requestedDescription:'消费者上脸使用产品'});
 assert.equal(consumer.sourceStrategy,'customer_real_asset');assert.equal(consumer.feasibility,'goal_degraded');assert.deepEqual(consumer.sourceRefs,[]);assert.equal(consumer.fallbackSourceStrategy,null);assert.equal(consumer.digitalHumanPlan,undefined);
 const matched=plan({shotId:'use',function:'demonstration',materialType:'consumer_demo',localVideoMatch:{sourceRefs:['consumer-local'],semanticMatch:'verified',evidenceRef:'semantic:use-action'}});
 assert.equal(matched.materialRouting?.localMatch.state,'matched');assert.deepEqual(matched.sourceRefs,['consumer-local']);assert.equal(matched.feasibility,'full_fidelity');
 const missingFactory=plan({shotId:'f',function:'trust',materialType:'factory'},{inventory:{productImageIds:['own-image']}});
 assert.equal(missingFactory.feasibility,'goal_degraded');assert.equal(missingFactory.productSceneReplication,undefined);
 assert.equal(plan({shotId:'f',function:'trust',materialType:'factory'}).feasibility,'goal_degraded','Flat factory inventory is only a candidate pool, never evidence of this shot matching');
});
test('products require per-shot semantic, archetype and product evidence; missing local video blocks before generation',()=>{
 const request={shotId:'p',function:'demonstration',materialType:'product',productRef:'own-product',productPolicy:'locked'};
 const matched=plan({...request,localVideoMatch:{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'semantic:product-action',productRef:'own-product'}});
 assert.equal(matched.sourceStrategy,'customer_real_asset');assert.equal(matched.productSceneReplication,undefined);assert.equal(matched.fallbackSourceStrategy,null);
 const segment={sourceRef:'product-local',segmentId:'actual-action',startSeconds:4,endSeconds:7};
 const withSegment={...request,localVideoMatch:{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'semantic:segment',productRef:'own-product'},selectedMaterialSegment:segment};
 assert.deepEqual(plan(withSegment).selectedMaterialSegment,segment);
 for(const invalid of [{...segment,sourceRef:'outside'},{...segment,startSeconds:NaN},{...segment,endSeconds:4},{...segment,startSeconds:-1}])assert.throws(()=>plan({...withSegment,selectedMaterialSegment:invalid}),/material_local_match_segment_invalid/);
 for(const match of [undefined,{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'',productRef:'own-product'},{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'semantic',productRef:'wrong-product'},{sourceRefs:['outside-tenant'],semanticMatch:'verified',evidenceRef:'semantic',productRef:'own-product'}]){
  const blocked=plan({...request,localVideoMatch:match});
  assert.equal(blocked.sourceStrategy,'customer_real_asset');assert.equal(blocked.materialRouting?.policy,'local_only');assert.equal(blocked.materialRouting?.localMatch.state,'missing');assert.equal(blocked.materialRouting?.generation,undefined);assert.equal(blocked.feasibility,'goal_degraded');assert.equal(blocked.fallbackSourceStrategy,null);
 }
 const missingOwnProduct=plan({...request,productRef:'not-in-kb'});assert.equal(missingOwnProduct.feasibility,'goal_degraded');assert.deepEqual(missingOwnProduct.sourceRefs,[]);
 assert.equal(plan({...request,plannedDurationSeconds:8}).productSceneReplication,undefined);
 for(const duration of [NaN,Infinity,0,-1])assert.throws(()=>plan({...request,plannedDurationSeconds:duration}),/material_planned_duration_invalid/);
});
test('only actual talking-head classification requests a presenter and unknown scenes cannot silently become products',()=>{
 const actualHook='Original authorized digital twin; new exact English hook, original voice, no product claim';
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'S01',function:'hook',requestedDescription:actualHook}),'talking_head');
 assert.equal(plan({shotId:'S01',function:'hook',requestedDescription:actualHook}).sourceStrategy,'authorized_digital_presenter');
 for(const description of ['数字分身对镜口播','avatar talking to camera','真人对镜speaking'])assert.equal(classifySocialAssetSupplyMaterialType({shotId:'speaker',function:'hook',requestedDescription:description}),'talking_head');
 for(const description of ['Product packaging close-up with voiceover; no avatar talking','产品运镜展示，加旁白，不出现数字分身口播'])assert.equal(classifySocialAssetSupplyMaterialType({shotId:'product',function:'demonstration',requestedDescription:description}),'product');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'none',function:'transition',requestedDescription:'No product claim; no avatar talking'}),'unknown');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'u',function:'demonstration',requestedDescription:'消费者涂抹产品上脸'}),'consumer_demo');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'f',function:'trust',requestedDescription:'工人检查工厂设备'}),'factory');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'p',function:'demonstration',requestedDescription:'手拿产品晃一圈展示包装',interaction:'person_holding_product'}),'product');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'f',function:'trust',requestedDescription:'工厂输送带灌装产品'}),'factory');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'t',function:'hook',requestedDescription:'真人在工厂拿产品对镜口播'}),'talking_head');
 const factoryReference:any={shotId:'ref',visualDescription:'工厂内人物手持包装',spokenText:'Meet our product.',tags:{subjects:['person','product'],subjectRelations:[],sceneTypes:['factory']},referenceProductionRouting:{state:'ready',personPresence:'person',observedPresenterRole:'sales_presenter'}};
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'t',function:'hook',referenceShotId:'ref'},[factoryReference]),'talking_head');
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'f',function:'trust',referenceShotId:'ref'},[{...factoryReference,referenceProductionRouting:{...factoryReference.referenceProductionRouting,observedPresenterRole:'background'}}]),'factory');
 const speaker=plan({shotId:'s',function:'hook',materialType:'talking_head',requestedDescription:'真人口播'});assert.equal(speaker.sourceStrategy,'authorized_digital_presenter');assert.equal(speaker.materialRouting?.policy,'authorized_presenter');assert.ok(speaker.digitalHumanPlan);
 const factorySpeaker=plan({shotId:'t',function:'hook',requestedDescription:'真人在工厂拿产品对镜口播'});assert.equal(factorySpeaker.sourceStrategy,'authorized_digital_presenter');assert.equal(factorySpeaker.feasibility,'goal_degraded');assert.equal(factorySpeaker.truthBoundary.subject,'customer_factory');assert.equal(factorySpeaker.truthBoundary.customerEvidenceRequired,true);assert.ok(factorySpeaker.truthBoundary.prohibitedRepresentations.includes('depict_generated_factory_as_customer_factory'));
 const unknown=plan({shotId:'unknown',function:'transition',materialType:'unknown'});assert.equal(unknown.sourceStrategy,'customer_real_asset');assert.equal(unknown.feasibility,'goal_degraded');assert.equal(unknown.productSceneReplication,undefined);
});
test('adjacent-shot boundary states do not contaminate material type classification',()=>{
 const office:any={shotId:'office-ref',visualDescription:'手在 iPad 上绘制包装设计图',tags:{subjects:['person','product'],subjectRelations:['person uses tablet'],sceneTypes:['office']},visualContract:{schemaVersion:'social-scene-visual-contract.v1',subjects:[{subjectId:'person',kind:'person',description:'设计师的手',identityRef:null,confidence:null},{subjectId:'product',kind:'product',description:'包装设计',identityRef:null,confidence:null}],interaction:{kind:'person_using_product',description:'在 iPad 上绘图',actorSubjectId:null,objectSubjectId:null,contactArea:null},environment:{kind:'office',description:'设计工作室',details:[]},productUsage:{kind:'other',description:'包装设计',productId:null,productRef:'own-product'},product:{policy:'preferred',requestedProductId:null,requestedProductRef:'own-product',source:'agent_inferred'},action:{startState:'工人操作灌装黑色瓶子',path:'手在 iPad 上绘制包装设计图',peakState:'',endState:'设计图完成',startSeconds:1,peakSeconds:null,endSeconds:2},camera:{shotSize:'特写',angle:'俯视',movement:'固定镜头',composition:'中心构图'},precision:'standard',evidence:{sourceRange:{startSeconds:1,endSeconds:2},keyframeIds:[],confidence:1}}};
 assert.equal(classifySocialAssetSupplyMaterialType({shotId:'office',referenceShotId:'office-ref',function:'demonstration',visualContract:office.visualContract},[office]),'general');
 const presenter:any={...office,shotId:'presenter-ref',visualDescription:'女主面向镜头做打电话手势',visualContract:{...office.visualContract,subjects:[{subjectId:'person',kind:'person',description:'女主',identityRef:null,confidence:null}],interaction:{...office.visualContract.interaction,kind:'other',description:'面向镜头做打电话手势'},environment:{kind:'other',description:'美妆展厅',details:[]},productUsage:{kind:'none',description:'',productId:null,productRef:null},action:{...office.visualContract.action,startState:'机器继续灌装膏体',path:'女主面向镜头做打电话手势'}}};
 assert.notEqual(classifySocialAssetSupplyMaterialType({shotId:'presenter',referenceShotId:'presenter-ref',function:'call_to_action',visualContract:presenter.visualContract},[presenter]),'factory');
});
test('visible presenter evidence selects five slots in three runs while narrated people remain B-roll',()=>{
 const ref=(shotId:string,purpose:any,visualDescription:string,spokenText:string,interaction:string='other'):any=>({shotId,purpose,visualDescription,spokenText,tags:{subjects:['person'],subjectRelations:[],sceneTypes:[]},visualContract:{subjects:[{kind:'person'}],interaction:{kind:interaction,description:visualDescription},environment:{kind:'other'},productUsage:{kind:'none'},action:{path:visualDescription}}});
 const references=[
  ref('r1','hook','女主站立，面向镜头，右手食指指向镜头','Beauty brand owners, stop guessing.'),
  ref('r2','d_to_c','女主面向镜头，双手交叉做 X 手势','Stop launching on guesswork.'),
  ref('r11','value','女模特手持精华液展示，看向镜头','Lip kits are trending.','person_holding_product'),
  ref('r13','trust','工人操作自动灌装机','Our factory helps brands.','factory_process'),
  ref('r18','value','一双手捧着两支唇釉','We support private label.','person_holding_product'),
  ref('r30','value','女主面向镜头，双手做打电话手势','Tell us what market you want to sell in.'),
  ref('r31','value','两位女性顾客从背后在货架前挑选产品','We will show opportunities.','person_using_product'),
  ref('r35','call_to_action','女主面向镜头做打电话手势并比赞','DM me for the latest catalog.'),
  ref('r36','call_to_action','女主面向镜头摊开双手并比赞','DM me for the latest catalog.'),
 ];
 const types=references.map(reference=>classifySocialAssetSupplyMaterialType({shotId:`s-${reference.shotId}`,referenceShotId:reference.shotId,function:reference.purpose,requestedDescription:`${reference.visualDescription}。保持画面中的静态姿态。`,visualContract:reference.visualContract},references));
 assert.deepEqual(types.map((type,index)=>type==='talking_head'?references[index]!.shotId:null).filter(Boolean),['r1','r2','r30','r35','r36']);
 assert.equal(types.filter(type=>type==='talking_head').length,5);
});
test('historical plans remain unmarked while new typed plans do not infer a generation route',()=>{
 const shot:any={shotId:'p',function:'demonstration',requestedDescription:'纯产品展示',productRef:'own-product',productPolicy:'locked'};
 const historic=createSocialAssetSupplyPlan({creationMode:'viral_replication',inventory,shots:[shot]});assert.equal(historic.materialRoutingPolicyVersion,undefined);assert.equal(historic.shots[0].materialRouting,undefined);
 const current=plan({...shot,materialType:'product'});
 assert.equal(current.materialRouting?.policy,'local_only');assert.equal(current.materialRouting?.generation,undefined);assert.equal(current.productSceneReplication,undefined);
});

test('named preferred products cannot borrow another SKU or use packaging images as executable video',()=>{
 const extra={inventory:{...inventory,referenceVideoIds:['benchmark'],productIdentityGroups:[...inventory.productIdentityGroups,{productRef:'other-product',imageIds:['other-packaging']}]}};
 const request={shotId:'p',function:'demonstration',materialType:'product',productRef:'own-product',productPolicy:'preferred',referenceShotId:'reference-p'};
 const blocked=plan(request,extra);
 assert.equal(blocked.materialRouting?.policy,'local_only');
 assert.equal(blocked.materialRouting?.generation,undefined);
 assert.deepEqual(blocked.sourceRefs,[]);
 const missing=plan({...request,productRef:'missing-product'},extra);
 assert.equal(missing.feasibility,'goal_degraded');
 assert.deepEqual(missing.sourceRefs,[]);
});
test('explicit free edits retain a verified exact video window without enabling paid generation',()=>{
 const segment={sourceRef:'product-local',segmentId:'real-segment',startSeconds:2,endSeconds:5},shot={shotId:'p',function:'demonstration',materialType:'product',productRef:'own-product',localVideoMatch:{sourceRefs:['product-local'],semanticMatch:'verified',evidenceRef:'semantic:free',productRef:'own-product'},selectedMaterialSegment:segment};
 const free=plan(shot,{productionApproach:'material_cut'});assert.equal(free.sourceStrategy,'customer_real_asset');assert.equal(free.materialRouting,undefined);assert.deepEqual(free.selectedMaterialSegment,segment);assert.equal(free.productSceneReplication,undefined);assert.equal(free.fallbackSourceStrategy,null);
 assert.throws(()=>plan({...shot,selectedMaterialSegment:{...segment,endSeconds:NaN}},{productionApproach:'material_cut'}),/material_local_match_segment_invalid/);
 assert.equal(plan({...shot,localVideoMatch:{...shot.localVideoMatch,evidenceRef:''}},{productionApproach:'material_cut'}).selectedMaterialSegment,undefined);
});

test('new typed product plans never register an image or paid generation adapter',()=>{
 const request={shotId:'p',function:'demonstration',materialType:'product',productRef:'own-product'};
 const fresh=plan(request);
 assert.equal(fresh.sourceStrategy,'customer_real_asset');
 assert.equal(fresh.materialRouting?.policy,'local_only');
 assert.equal(fresh.materialRouting?.generation,undefined);
 assert.equal(fresh.productSceneReplication,undefined);
});
