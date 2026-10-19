import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialReplicationScriptVersion } from '../../shared/contracts/socialContentDiscovery.js';
import { adaptSocialReplicationScriptToProductOnly, assessSocialReplicationProposal, socialReplicationIdentityGaps } from './socialContentReplicationScriptReview.js';

const binding = {
  productId: 'product-stable-id', productName: 'COOSTO spray', productSku: null,
  enterpriseFactRef: 'enterprise_fact:fact@1', enterpriseFactId: 'fact', enterpriseFactRevision: 1,
  enterpriseFactContentHash: 'a'.repeat(64), confirmedAt: '2026-10-16T00:00:00.000Z',
};

const plan: any = {
  shotId: 'shot-1', function: 'hook', requestedDescription: 'Ohana presenter',
  sourceStrategy: 'authorized_digital_presenter', sourceRefs: [], fallbackSourceStrategy: null,
  productionInstruction: 'show Ohana',
  truthBoundary: {subject: 'none', syntheticVisualAllowed: true, customerEvidenceRequired: false,
    customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: false, prohibitedRepresentations: []},
  functionalEquivalentReplacement: {required: false, preservesFunction: 'hook', replacesSubject: null, description: null, reason: null},
  feasibility: 'full_fidelity', feasibilityReason: 'legacy', customerShootRequired: false,
  visualContract: {schemaVersion: 'social-scene-visual-contract.v1', subjects: [{subjectId: 'person',kind:'person',description:'presenter',identityRef:null,confidence:null}],
    interaction:{kind:'person_talking',description:'talk',actorSubjectId:'person',objectSubjectId:null,contactArea:null},
    environment:{kind:'home',description:'home',details:[]},productUsage:{kind:'none',description:'',productId:null,productRef:null},
    product:{policy:'preferred',requestedProductId:null,requestedProductRef:'Ohana',source:'agent_inferred'},
    action:{startState:'',path:'talk',peakState:'',endState:'',startSeconds:0,peakSeconds:1,endSeconds:2},
    camera:{shotSize:'medium',angle:'front',movement:'none',composition:'center'},precision:'hook_high',
    evidence:{sourceRange:{startSeconds:0,endSeconds:2},keyframeIds:['reference-person'],confidence:.9}},
  digitalHumanPlan: {workflow:'viral_replication',method:'talking',presenterAssetIds:[],referenceMaterialIds:[],referenceRequired:true,
    candidateTools:['heygen'],executionState:'needs_presenter',accountPresenterLock:null},
};

const script: SocialReplicationScriptVersion = {
  version:'1',referenceAnalysisId:'analysis',status:'review_required',primaryHookId:'hook',hookOptions:[],
  shots:[{shotId:'shot-1',referenceShotId:'ref-1',startSeconds:0,endSeconds:2,purpose:'hook',visualInstruction:'Ohana presenter',
    spokenText:null,captionText:'Ohana discount',audioAndTransition:null,fidelityPoints:[],mustDifferPoints:[],materialPlan:plan,
    lockedRegions:[],risks:[]}],narrationSourceStatus:'missing_source_asr',structureFidelitySummary:'legacy',
  originalityDifferenceSummary:'legacy',createdAt:'2026-10-16T00:00:00.000Z',
};

test('product-only adaptation removes presenter and competitor identity while locking the exact supplied product', () => {
  const adapted=adaptSocialReplicationScriptToProductOnly({script,binding,materialId:'material-1',materialSourceRef:'socialmaterial:bWF0ZXJpYWwtMQ'});
  const encoded=JSON.stringify(adapted);
  assert.doesNotMatch(encoded,/Ohana|presenter-person|heygen/i);
  assert.equal(adapted.status,'review_required');
  assert.equal(adapted.shots[0]!.materialPlan.digitalHumanPlan,undefined);
  assert.deepEqual(adapted.shots[0]!.materialPlan.sourceRefs,['material-1']);
  assert.equal(adapted.shots[0]!.materialPlan.visualContract?.product.requestedProductId,binding.productId);
  assert.equal(adapted.shots[0]!.materialPlan.truthBoundary.confirmedFactRefs[0],binding.enterpriseFactRef);
  assert.deepEqual(socialReplicationIdentityGaps(adapted,binding),[]);
});

test('proposal assessment blocks the seven repeated product cards before script confirmation', () => {
  const shots = Array.from({length: 7}, (_, index) => ({
    ...structuredClone(script.shots[0]!),
    shotId: `shot-${index+1}`,
    startSeconds: [0,2.23,12.6,15.6,25.6,27.1,40.4][index]!,
    endSeconds: [2.23,12.6,15.6,25.6,27.1,40.4,52.9][index]!,
  }));
  const adapted = adaptSocialReplicationScriptToProductOnly({script:{...script,shots},binding,
    materialId:'material-1',materialSourceRef:'socialmaterial:bWF0ZXJpYWwtMQ'});
  const assessment = assessSocialReplicationProposal(adapted);
  assert.equal(assessment.status,'blocked');
  assert.deepEqual(assessment.issues.map(issue=>issue.code),[
    'repeated_static_visual_plan','static_card_timing_mismatch','internal_production_copy',
  ]);
  assert.deepEqual(assessment.issues[0]!.shotIds,shots.map(shot=>shot.shotId));
  assert.deepEqual(assessment.issues[1]!.shotIds,['shot-2','shot-4','shot-5','shot-6','shot-7']);
});

test('proposal assessment is scoped to product-only revision and accepts distinct viable visual plans', () => {
  assert.equal(assessSocialReplicationProposal(script).status,'ready');
  const adapted = adaptSocialReplicationScriptToProductOnly({script,binding,
    materialId:'material-1',materialSourceRef:'socialmaterial:bWF0ZXJpYWwtMQ'});
  const candidate={...adapted,shots:Array.from({length:3},(_,index)=>({
    ...structuredClone(adapted.shots[0]!),shotId:`distinct-${index}`,
    startSeconds:index*3,endSeconds:(index+1)*3,captionText:`Product detail ${index+1}`,
    materialPlan:{...structuredClone(adapted.shots[0]!.materialPlan),visualContract:{
      ...structuredClone(adapted.shots[0]!.materialPlan.visualContract!),
      action:{...adapted.shots[0]!.materialPlan.visualContract!.action,path:`Distinct scene action ${index}`},
    }},
  }))};
  assert.equal(assessSocialReplicationProposal(candidate).status,'ready');
});
