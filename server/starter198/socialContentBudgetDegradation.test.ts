import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPresenterFirstBudgetDegradation,typeAwareRequiredMaterialIds} from './socialContentProductionExecution.js';

const asset=(id:string,roles:string[],productRef:string|null,score=0.8)=>({candidateId:id,kind:'asset',label:id,sourceRef:id,
  sourceStrategy:'customer_real_asset',evidenceStrength:'supporting',rightsStatus:'confirmed',enterpriseOwnershipScore:1,
  semanticScore:score,evidenceScore:score,actionAndShotScore:score,qualityScore:score,durationFitScore:score,repetitionPenalty:0,
  estimatedCostCny:0,estimatedSeconds:0,estimatedSuccessRate:1,dataTransfer:'local_only',providerId:null,modelId:null,
  clipId:null,timeRange:null,promptRef:null,productRef,materialRoles:roles,retryPolicy:{maxAttempts:0,fallbackStrategies:[]},
  materialSegments:[{segmentId:`segment-${id}`,startSeconds:0,endSeconds:3,visualContract:{},materialRoles:roles,matchedVoiceoverCueIds:[],voiceoverScore:score,visualCompatibilityScore:score}],
  provenance:{origin:'customer',inputVersion:'1',authorizationRef:null,executionRecordId:null}} as any);
const paid=(id:string,cost:number)=>({...asset(id,[],null),kind:'capability',sourceRef:null,sourceStrategy:'aigc_product_scene_replication',
  dataTransfer:'external_processor',estimatedCostCny:cost,providerId:'wan',modelId:'wan'}) as any;
const productShot=(shotId:string)=>({shotId,sourceStrategy:'aigc_product_scene_replication',fallbackSourceStrategy:null,sourceRefs:['image'],
  feasibility:'ready',feasibilityReason:'ready',productionInstruction:'generate',truthBoundary:{},materialRouting:{materialType:'product',policy:'local_first_product_i2v',
  localMatch:{state:'missing',sourceRefs:[],evidenceRef:null},generation:{productImageRefs:['image']}},productSceneReplication:{productIdentity:{groups:[{productRef:'sku',referenceImageIds:['image']}]}}}) as any;

function fixture(candidatesByShot:Record<string,any[]>,presenterCost=4){
  const ids=['PRES',...Object.keys(candidatesByShot)];
  const shots=[{shotId:'PRES',sourceStrategy:'authorized_digital_presenter',fallbackSourceStrategy:null,sourceRefs:['person'],materialRouting:{materialType:'talking_head'}} as any,
    ...Object.keys(candidatesByShot).map(productShot)];
  const scenes=ids.map(id=>({sceneId:id,selectedSourceStrategy:id==='PRES'?'authorized_digital_presenter':'aigc_product_scene_replication',
    estimatedCostCny:id==='PRES'?presenterCost:2,candidates:id==='PRES'?[]:candidatesByShot[id]}));
  return {plan:{planVersion:'v',creationMode:'viral_replication',productionRoute:'mixed',managementMode:'automatic',shots} as any,
    workflow:{directorBrief:{scenes:ids.map(sceneId=>({sceneId,duration:{startSeconds:0,endSeconds:3}}))},executionPlan:{executionPlanId:'exec',scenes}} as any};
}

test('keeps presenter spend first and degrades product scenes without dropping the 37-shot plan',()=>{
  const candidates:Record<string,any[]>={};
  for(let i=1;i<=36;i++)candidates[`S${i}`]=[paid(`paid-${i}`,.7),asset(`local-${i}`,i%3===0?['factory']:['general'],null)];
  const f=fixture(candidates,6),before=f.plan.shots.map((shot:any)=>shot.shotId);
  const result=applyPresenterFirstBudgetDegradation({...f,maximumCny:10});
  assert.deepEqual(result.shots.map((shot:any)=>shot.shotId),before);
  assert.equal(result.shots.length,37);
  assert.equal(result.shots.filter((shot:any)=>shot.sourceStrategy==='aigc_product_scene_replication').length,0);
  assert.equal(result.shots.filter((shot:any)=>shot.sourceStrategy==='customer_real_asset').length,36);
  assert.equal(result.shots[0]!.sourceStrategy,'authorized_digital_presenter');
});

test('presenter-first exhaustion follows exact product, product, factory and other local tiers',()=>{
  const f=fixture({S1:[paid('paid-exact',2),asset('other',[],null,.99),asset('exact',['product'],'SKU',.5)],
    S2:[paid('paid-two',.8),asset('factory',['factory'],null,.9),asset('product',['product'],'other-sku',.2)],
    S3:[paid('paid-three',.8),asset('other-three',[],null,.99),asset('factory-three',['factory'],null,.1)]},5);
  const result=applyPresenterFirstBudgetDegradation({...f,maximumCny:10});
  assert.equal(result.shots[1]!.sourceRefs[0],'exact');
  assert.equal(result.shots[1]!.materialRouting!.localMatch.sourceTier,'product_high_fidelity_local');
  assert.equal(result.shots[2]!.sourceStrategy,'customer_real_asset');
  assert.equal(result.shots[2]!.sourceRefs[0],'product');
  assert.equal(result.shots[3]!.sourceRefs[0],'factory-three');
  assert.equal(result.shots[3]!.materialRouting!.localMatch.sourceTier,'factory_local');
  assert.equal(result.shots[3]!.productSceneReplication,undefined);
});

test('local assets without a verified material segment are not executable budget fallbacks',()=>{
  const unsegmented=asset('unsegmented',['product'],'sku');delete unsegmented.materialSegments;
  const f=fixture({S1:[paid('paid',2),unsegmented],S2:[asset('verified-other',[],null)]},10);
  const result=applyPresenterFirstBudgetDegradation({...f,maximumCny:10});
  assert.equal(result.shots[1]!.sourceRefs[0],'verified-other');
  assert.equal(result.shots[1]!.materialRouting!.localMatch.sourceTier,'other_local');
});

test('local fallback segment must cover the frozen scene duration',()=>{
  const short=asset('short',['product'],'sku');short.materialSegments[0].endSeconds=.5;
  const f=fixture({S1:[paid('paid',2),short],S2:[asset('long-factory',['factory'],null)]},10);
  const result=applyPresenterFirstBudgetDegradation({...f,maximumCny:10});
  assert.equal(result.shots[1]!.sourceRefs[0],'long-factory');
});

test('presenter film gives no paid product spend before the formal whole-film reserve',()=>{
  const candidates:Record<string,any[]>={};
  for(let i=1;i<=6;i++)candidates[`S${i}`]=[paid(`paid-${i}`,0.01),asset(`local-${i}`,[],null)];
  const f=fixture(candidates,0.01);
  const result=applyPresenterFirstBudgetDegradation({...f,maximumCny:10});
  assert.equal(result.shots.filter((shot:any)=>shot.sourceStrategy==='aigc_product_scene_replication').length,0);
});

test('zero remaining visual budget still produces every product scene from local material',()=>{
  const f=fixture({S1:[paid('paid',2),asset('local-product',['product'],'other')],S2:[paid('paid2',2),asset('factory',['factory'],null)]},10);
  const result=applyPresenterFirstBudgetDegradation({...f,maximumCny:10});
  assert.ok(result.shots.slice(1).every((shot:any)=>shot.sourceStrategy==='customer_real_asset'));
  assert.ok(result.shots.slice(1).every((shot:any)=>shot.materialRouting.localMatch.state==='matched'));
});

test('a product scene without a direct match borrows the best local candidate from the complete execution inventory',()=>{
  const f=fixture({S1:[paid('paid',8)],S2:[asset('whole-library-factory',['factory'],null)]},10);
  (f.workflow.executionPlan.scenes[0] as any).estimatedCostCny=10;
  const result=applyPresenterFirstBudgetDegradation({...f,maximumCny:10});
  assert.equal(result.shots[1]!.sourceStrategy,'customer_real_asset');
  assert.equal(result.shots[1]!.sourceRefs[0],'whole-library-factory');
  assert.ok(typeAwareRequiredMaterialIds(result).includes('whole-library-factory'));
});

test('budget degradation exhausts distinct local assets and segments before reuse',()=>{
  const a1=asset('a-1',['product'],'other',.9),a2=asset('a-2',['product'],'other',.8),b1=asset('b-1',['product'],'other',.7);
  a2.sourceRef='asset-a';a2.materialSegments[0].segmentId='segment-a-2';
  a1.sourceRef='asset-a';a1.materialSegments[0].segmentId='segment-a-1';
  b1.sourceRef='asset-b';b1.materialSegments[0].segmentId='segment-b-1';
  const f=fixture({S1:[a1,a2,b1],S2:[a1,a2,b1],S3:[a1,a2,b1]},10);
  const result=applyPresenterFirstBudgetDegradation({...f,maximumCny:10});
  assert.deepEqual(result.shots.slice(1).map((item:any)=>item.sourceRefs[0]),['asset-a','asset-b','asset-a']);
  assert.deepEqual(result.shots.slice(1).map((item:any)=>item.selectedMaterialSegment.segmentId),['segment-a-1','segment-b-1','segment-a-2']);
});
