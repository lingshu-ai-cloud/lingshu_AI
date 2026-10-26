import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { createStarter198Repository } from './repository.js';
import { createSocialContentTask } from './socialContentTasks.js';
import { test } from 'node:test';
import { guidedCreationFixture } from '../../scripts/fixtures/guidedCreation.js';
import { guidedMaterialRoutingRequests, guidedProductIdentityGroups } from './guidedCreationRouting.js';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import { buildLocalMaterialSegmentProfile } from '../../shared/contracts/localMaterialSegmentProfile.js';
import type { SocialWorkflowMaterialClipCandidate } from './socialContentMaterialCandidateSupport.js';
import { defaultBrief } from './socialContentTaskSupport.js';
import { parseCreateSocialTask } from './socialContentValidation.js';
import { parseSocialTaskBrief } from './socialContentRecords.js';

const candidate = (assetId: string, productId: string, productRef: string): SocialWorkflowMaterialClipCandidate => {
  const visualContract = normalizeSceneVisualContract({ subjects: ['product'], interaction: { kind: 'product_only_display', description: '产品正面陈列' }, action: { path: '产品正面陈列' }, productRef, productPolicy: 'locked' });
  const assessment = buildLocalMaterialSegmentProfile({ tenantId: 'fixture', sourceTenantId: 'fixture', origin: 'my_materials', assetId, segmentId: 'segment', sourceRevision: 'revision', currentSourceRevision: 'revision', mediaType: 'video', synthetic: false, startSeconds: 0, endSeconds: 12, materialType: 'product', materialRoles: ['product'], productId, productRef, visualContract, observedActionTags: ['产品正面陈列'], rightsEvidenceRefs: ['rights'], commercialUseApprovalEvidenceRefs: ['rights'], commercialUseApproved: true, modelInputAllowed: false, derivativeUseAllowed: true, confidence: .98, needsReview: false, cleanEntry: true, cleanExit: true });
  return { assetId, segmentId: 'segment', segmentCandidateId: `${assetId}:segment`, sourceRef: assetId, sourceRevision: 'revision', productId, productRef, visualContract, segmentProfile: assessment.profile, materialRoles: ['product'], mediaType: 'video', origin: 'my_materials', timeRange: { startSeconds: 0, endSeconds: 12 }, label: assetId, matchScore: 1 } as SocialWorkflowMaterialClipCandidate;
};
test('guided exact user segment survives ranking and another SKU cannot replace it; rights loss fails closed', async () => {
  const f = guidedCreationFixture();
  const plan = await f.run('guided_products', { ...f.initial, productIds: ['fixture-product', 'fixture-product-2'], guided: { ...f.initial.guided!, languages: ['en'] } });
  const chosen = candidate('chosen', 'fixture-product-2', '样品盖'), alternative = candidate('alternative', 'fixture-product', '样品杯');
  plan.selection.guided!.presenterMode = 'none';
  plan.guided!.nodes = [{ id: 'custom:1', type: 'talking_head', description: '画外音', duration: 4, candidates: ['selected'], selectedCandidateId: 'selected', status: 'matched' }];
  plan.guided!.candidates = [{ id: 'selected', sourceId: 'chosen', segmentId: 'segment', title: 'chosen', description: '实拍', type: 'product', start: 0, end: 12, productionEligible: true }];
  const input = { policyVersion: 'type-aware.v2' as const, tenantId: 'fixture', productRef: '样品杯', shots: [{ shotId: 'guided-custom:1', function: 'hook' as const }], candidates: [alternative, chosen] };
  const result = guidedMaterialRoutingRequests(plan, input)[0]!;
  assert.equal(result.materialType, 'product'); assert.equal(result.productRef, '样品盖');
  assert.equal(result.selectedMaterialSegment?.sourceRef, 'chosen');
  assert.equal(result.visualContract?.subjects.some(row => row.kind === 'person'), false);
  assert.throws(() => guidedMaterialRoutingRequests(plan, { ...input, candidates: [alternative] }), /guided_creation_selected_segment_not_admitted/);
  const revoked = structuredClone(chosen); revoked.segmentProfile!.productionEligible = false; revoked.segmentProfile!.commercialUseApproved = false;
  assert.throws(() => guidedMaterialRoutingRequests(plan, { ...input, candidates: [alternative, revoked] }), /guided_creation_selected_segment_not_admitted/);
  const factory = candidate('factory', 'fixture-product-2', '样品盖');
  // Keep grouped image identity separate for a single multi-product video.
  const images = [alternative, factory].map(row => ({ ...row, mediaType: 'image' as const }));
  const groups = guidedProductIdentityGroups(plan, images, { productRef: '样品杯', imageIds: [] });
  assert.deepEqual(groups.map(row => row.productRef), ['样品杯', '样品盖']);
  assert.deepEqual(groups.map(row => row.imageIds), [['alternative'], ['factory']]);
  const stored = parseSocialTaskBrief(JSON.parse(JSON.stringify(defaultBrief({ ...parseCreateSocialTask({ title: '多产品', objective: 'B2B', languages: ['en'], platforms: ['TikTok'] }), creationDialoguePlan: plan }))));
  assert.deepEqual(stored.creationDialoguePlan?.selection.productIds, plan.selection.productIds);
  assert.throws(() => parseCreateSocialTask({ title: 'forged', objective: 'forged', creationDialoguePlan: plan }), /unsupported|unknown|invalid|field/);
});

test('native task creation persists a guided draft before its exact source is attached, without replacing it or starting a run', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'guided-native-draft-'));
  try {
    const f = guidedCreationFixture(), store = new LangGraphTestStore(path.join(root, 'store.json'));
    const plan = await f.run('guided_products', { ...f.initial, productIds: ['fixture-product', 'fixture-product-2'], guided: { ...f.initial.guided!, languages: ['en'] } });
    await store.create('tenant_profiles', { tenant_id: 'fixture', profile: f.profile });
    const repository = createStarter198Repository(store, { materialLibrary: async () => ({ items: [], totalItems: 0 }) as never });
    const input = { repository, tenantId: 'fixture', userId: 'fixture-user', idempotencyKey: 'guided-native-draft', now: new Date('2026-10-24T00:00:00Z'),
      value: { ...parseCreateSocialTask({ title: '同片多产品', objective: '海外B2B', productId: 'fixture-product', productRef: '样品杯', languages: ['en'], platforms: ['tiktok'], creationMode: 'viral_replication', themeId: 'supplier_capability' }), creationDialoguePlan: plan } };
    const first = await createSocialContentTask(input), replay = await createSocialContentTask(input);
    assert.equal(first.taskId, replay.taskId); assert.equal(first.runId, null); assert.equal(first.sources.length, 0);
    assert.equal(first.replicationScript ?? null, null);
    assert.deepEqual(first.brief.creationDialoguePlan?.selection.productIds, ['fixture-product', 'fixture-product-2']);
    assert.equal((await store.list('workflow_runs', { perPage: 100 })).totalItems, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('selected owned hook is cropped to the confirmed seconds after the original matcher admits its segment', async () => {
  const f=guidedCreationFixture();
  const plan=await f.run('guided_products',{...f.initial,productIds:['fixture-product'],guided:{...f.initial.guided!,languages:['en']}});
  plan.selection.guided!.presenterMode='none';
  plan.selection.guided!.scene={kind:'hook_first',groupId:'hook-fixture',plannedPublishAt:'2099-01-05T08:00:00+08:00',deliverBy:'2099-01-04T08:00:00+08:00',hook:{materialId:'own-hook',startSeconds:2,endSeconds:5,usage:'editable',direction:'展示产品'},narrationEdits:[],narrationConfirmed:true};
  plan.guided!.nodes=[{id:'first',type:'product',description:'产品正面陈列',duration:3,candidates:['chosen'],selectedCandidateId:'chosen',status:'matched'}];
  plan.guided!.candidates=[{id:'chosen',sourceId:'own-hook',segmentId:'segment',title:'',description:'',type:'product',start:2,end:5,productionEligible:true}];
  const owned=candidate('own-hook','fixture-product','样品杯');
  const input={policyVersion:'type-aware.v2' as const,tenantId:'fixture',productRef:'样品杯',shots:[{shotId:'guided-first',function:'hook' as const}],candidates:[owned]};
  const output=guidedMaterialRoutingRequests(plan,input)[0]!;
  assert.deepEqual([output.selectedMaterialSegment?.startSeconds,output.selectedMaterialSegment?.endSeconds],[2,5]);
  assert.equal(output.selectedMaterialSegment?.sourceRef,'own-hook');
  const withdrawn=structuredClone(owned);withdrawn.segmentProfile!.productionEligible=false;
  assert.throws(()=>guidedMaterialRoutingRequests(plan,{...input,candidates:[withdrawn]}),/not_admitted/);
});

test('an admitted customer talking-head opening stays a real clip instead of becoming product B-roll', async () => {
  const f=guidedCreationFixture();
  const plan=await f.run('guided_products',{...f.initial,productIds:['fixture-product'],guided:{...f.initial.guided!,languages:['en']}});
  plan.selection.guided!.presenterMode='none';
  plan.selection.guided!.scene={kind:'hook_first',groupId:'spoken-hook',plannedPublishAt:'2099-01-05T08:00:00+08:00',deliverBy:'2099-01-04T08:00:00+08:00',hook:{materialId:'speaker',startSeconds:2,endSeconds:5,usage:'editable',direction:'真人介绍产品'},narrationEdits:[],narrationConfirmed:true};
  plan.guided!.nodes=[{id:'first',type:'talking_head',description:'真人开场',duration:3,candidates:['speaker-clip'],selectedCandidateId:'speaker-clip',status:'matched'}];
  plan.guided!.candidates=[{id:'speaker-clip',sourceId:'speaker',segmentId:'segment',title:'真人开场',description:'真人开场',type:'talking_head',start:2,end:5,productionEligible:true}];
  const visualContract=normalizeSceneVisualContract({subjects:['person'],interaction:{kind:'person_talking',description:'真人介绍产品'},action:{path:'真人介绍产品'}});
  const assessment=buildLocalMaterialSegmentProfile({tenantId:'fixture',sourceTenantId:'fixture',origin:'my_materials',assetId:'speaker',segmentId:'segment',sourceRevision:'revision',currentSourceRevision:'revision',mediaType:'video',synthetic:false,startSeconds:0,endSeconds:12,materialType:'talking_head',materialRoles:['presenter'],productId:'fixture-product',productRef:'样品杯',visualContract,observedActionTags:['真人介绍产品'],rightsEvidenceRefs:['rights'],commercialUseApprovalEvidenceRefs:['rights'],commercialUseApproved:true,modelInputAllowed:false,derivativeUseAllowed:true,confidence:.98,needsReview:false,cleanEntry:true,cleanExit:true});
  const owned:SocialWorkflowMaterialClipCandidate={...candidate('speaker','fixture-product','样品杯'),visualContract,segmentProfile:assessment.profile,materialRoles:['presenter']};
  const output=guidedMaterialRoutingRequests(plan,{policyVersion:'type-aware.v2',tenantId:'fixture',productRef:'样品杯',shots:[{shotId:'guided-first',function:'hook'}],candidates:[owned]})[0]!;
  assert.equal(output.materialType,'talking_head');
  assert.equal(output.selectedMaterialSegment?.sourceRef,'speaker');
  assert.deepEqual([output.selectedMaterialSegment?.startSeconds,output.selectedMaterialSegment?.endSeconds],[2,5]);
});
