import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { buildNoSharedMaterialDemand, verifiedNoSharedMaterialDemand, type WeeklyMaterialDemandScope } from './socialWeeklyMaterialDemand.js';
const scope:WeeklyMaterialDemandScope={taskId:'content',programId:'program',packageId:'package',packageVersion:2,publicationTaskId:'video',factRefs:[{type:'enterprise_fact',id:'fact',version:1}]};
function fixture(){const plan=createSocialAssetSupplyPlan({creationMode:'material_processing',planVersion:'4',confirmedFactRefs:['enterprise_fact:fact@1'],shots:[{shotId:'fact',function:'proof',requestedDescription:'只展示已确认的产品事实'},{shotId:'transition',function:'transition',requestedDescription:'非实拍图形动画'}]});return {row:{task_id:'content',material_requirements:[],brief:{}},detail:{taskId:'content',version:'4',assetSupplyPlan:plan} as any};}
test('actual requirement list plus safe generated plan freezes a verifiable no-shared-request demand',()=>{const f=fixture();const demand=buildNoSharedMaterialDemand(f.row,f.detail,scope);assert.ok(demand);assert.equal(demand.assetSupplyPlan.shots[0]!.sourceStrategy,'verified_fact_card');const row={...f.row,brief:{_weeklyMaterialDemand:demand}};assert.equal(verifiedNoSharedMaterialDemand(row,scope)?.version,4);assert.equal(verifiedNoSharedMaterialDemand(row,{...scope,publicationTaskId:'other'}),null);demand.assetSupplyPlan.shots[0]!.productionInstruction='changed';assert.equal(verifiedNoSharedMaterialDemand(row,scope),null);});
test('generic readiness, omitted demand list, required human dependency and customer evidence cannot fake automatic material readiness',()=>{const f=fixture();assert.equal(buildNoSharedMaterialDemand({task_id:'content'},f.detail,scope),null);assert.equal(buildNoSharedMaterialDemand({...f.row,material_requirements:[{required:true}]},f.detail,scope),null);f.detail.assetSupplyPlan.shots[0].truthBoundary.customerEvidenceRequired=true;assert.equal(buildNoSharedMaterialDemand(f.row,f.detail,scope),null);});
test('adding a required dependency invalidates a previously frozen automatic demand without rewriting it',()=>{const f=fixture();const demand=buildNoSharedMaterialDemand(f.row,f.detail,scope)!;assert.equal(verifiedNoSharedMaterialDemand({...f.row,material_requirements:[{required:true}],brief:{_weeklyMaterialDemand:demand}},scope),null);});

test('empty facts, invalid fact versions and even optional requirement content drift invalidate frozen demand',()=> {
 const f=fixture();assert.equal(buildNoSharedMaterialDemand(f.row,f.detail,{...scope,factRefs:[]}),null);assert.equal(buildNoSharedMaterialDemand(f.row,f.detail,{...scope,factRefs:[{type:'enterprise_fact',id:'fact',version:0}]}),null);
 const row={...f.row,material_requirements:[{required:false,requirement:'optional original'}]};const demand=buildNoSharedMaterialDemand(row,f.detail,scope)!;
 assert.equal(verifiedNoSharedMaterialDemand({...row,material_requirements:[{required:false,requirement:'optional changed'}],brief:{_weeklyMaterialDemand:demand}},scope),null);
});

test('digital presenter demand requires the same actually locked account profile in every presenter shot',()=> {
 const lock={socialAccountId:'account',presenterProfileId:'profile',presenterProfileVersion:'3',presenterAssetId:'presenter',avatarId:'avatar',voiceProfileId:'voice',consentRef:'consent',commercialRightsStatus:'cleared' as const,status:'published' as const,consistencyKey:'account:profile:3'};
 const plan=createSocialAssetSupplyPlan({creationMode:'material_processing',planVersion:'4',accountPresenterLock:lock,presenterSelectionConfirmed:true,confirmedFactRefs:['enterprise_fact:fact@1'],shots:[{shotId:'presenter',function:'hook',requestedDescription:'授权数字人口播'}]});
 const row={task_id:'content',material_requirements:[]};const detail={taskId:'content',version:'4',assetSupplyPlan:plan} as any;
 assert.ok(buildNoSharedMaterialDemand(row,detail,{...scope,accountId:'account'}));assert.equal(buildNoSharedMaterialDemand(row,detail,{...scope,accountId:'other'}),null);
 plan.shots[0]!.digitalHumanPlan!.accountPresenterLock={...lock,presenterAssetId:'other-presenter'};assert.equal(buildNoSharedMaterialDemand(row,detail,{...scope,accountId:'account'}),null);
});
