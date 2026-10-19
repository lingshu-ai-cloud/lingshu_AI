import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import { materialRoutingRequests } from './socialContentMaterialRoutingRequests.js';
import { parseCreateSocialTask, parseUpdateSocialTask, parseSocialSource } from './socialContentValidation.js';
import { defaultBrief } from './socialContentTaskSupport.js';
import { parseSocialTaskBrief } from './socialContentRecords.js';
import { buildLocalMaterialSegmentProfile, inferLocalMaterialSegmentType } from '../../shared/contracts/localMaterialSegmentProfile.js';

const visual = (action = '手握包装盒晃一圈') => normalizeSceneVisualContract({
  subjects: ['person', 'product'], interaction: { kind: 'person_holding_product', description: action },
  action: { path: action }, productRef: 'SKU-1', productPolicy: 'locked',
});
const shot = { shotId: 'S1', function: 'demonstration' as const, requestedDescription: '手握包装盒晃一圈',
  visualContract: visual(), productRef: 'SKU-1' };
const profiled = (value: Record<string, any>) => {
  const tenantId = value.tenantId ?? 'tenant';
  const materialRoles = value.materialRoles ?? [];
  const visualContract = value.visualContract ?? visual();
  const timeRange = value.timeRange;
  const assessment = buildLocalMaterialSegmentProfile({ tenantId,
    sourceTenantId: value.origin === 'shared_library' ? 'shared' : tenantId, origin: value.origin ?? 'my_materials',
    assetId: value.assetId, segmentId: value.segmentId, sourceRevision: `revision:${value.assetId}`,
    currentSourceRevision: `revision:${value.assetId}`, mediaType: value.mediaType ?? 'video', synthetic: value.synthetic === true,
    startSeconds: timeRange?.startSeconds ?? null, endSeconds: timeRange?.endSeconds ?? null,
    materialType: inferLocalMaterialSegmentType({materialRoles, visualContract}), materialRoles,
    productId: value.productId ?? null, productRef: value.productRef ?? null, visualContract,
    observedActionTags: [visualContract.action.path, visualContract.interaction.description],
    rightsEvidenceRefs: [`rights:${value.assetId}`], commercialUseApproved: true, modelInputAllowed: false,
    derivativeUseAllowed: true, confidence: .95, needsReview: false, cleanEntry: true, cleanExit: true });
  return {...value, segmentProfile: assessment.profile, segmentProfileRejectionReasons: assessment.rejectionReasons};
};
const candidate = (overrides: Record<string, unknown> = {}) => profiled({ assetId: 'own-video', sourceRef: 'own-video',
  segmentId: 'seg-1', origin: 'my_materials', mediaType: 'video', productRef: 'SKU-1',
  materialRoles: ['product'], visualContract: visual(), timeRange: { startSeconds: 2, endSeconds: 6 }, ...overrides }) as never;
const requests = (candidates: never[]) => materialRoutingRequests({ policyVersion: 'type-aware.v1',
  tenantId: 'tenant', shots: [shot], candidates, productRef: 'SKU-1' });

test('normal API creation persists the policy while historic briefs remain unmarked', () => {
  const brief = defaultBrief(parseCreateSocialTask({ title: '产品视频', objective: '介绍产品' }));
  assert.equal(parseSocialTaskBrief(brief).materialRoutingPolicyVersion, 'type-aware.v2');
  assert.equal(parseSocialTaskBrief({...brief,materialRoutingPolicyVersion:'type-aware.v1'}).materialRoutingPolicyVersion,'type-aware.v1');
  const { materialRoutingPolicyVersion: _, ...legacy } = brief;
  assert.equal(parseSocialTaskBrief(legacy).materialRoutingPolicyVersion, undefined);
  assert.throws(() => parseSocialTaskBrief({ ...brief, materialRoutingPolicyVersion: 'unknown' }), /social_material_routing_policy_invalid/);
  assert.deepEqual(parseUpdateSocialTask({ expectedVersion: 'v65', changes: { title: '更新标题' } }).changes, { title: '更新标题' });
  assert.equal(parseUpdateSocialTask({ expectedVersion: 'v65', changes: { targetDurationSeconds: 18 } }).changes.targetDurationSeconds, 18);
  assert.throws(() => parseUpdateSocialTask({ expectedVersion: 'v65', changes: { targetDurationSeconds: 3 } }), /social_content_target_duration_invalid/);
});
test('local product match retains its action evidence, SKU and exact analyzed segment', () => {
  const result = requests([candidate()])[0]!;
  assert.equal(result.materialType, 'product');
  assert.deepEqual(result.localVideoMatch?.sourceRefs, ['own-video']);
  assert.match(result.localVideoMatch?.evidenceRef ?? '', /^material-visual-match:tenant:/);
  assert.deepEqual(result.selectedMaterialSegment, { sourceRef: 'own-video', segmentId: 'seg-1', startSeconds: 2, endSeconds: 6 });
  assert.equal(result.localVideoMatch?.sourceTier, 'product_high_fidelity_local');
});
test('multi-shot routing never repeats the same analyzed segment within one plan', () => {
  const shots = Array.from({length: 5}, (_, index) => ({...shot, shotId: `S${index + 1}`}));
  const candidates = [
    candidate({assetId:'asset-a',sourceRef:'asset-a',segmentId:'a-1'}),
    candidate({assetId:'asset-a',sourceRef:'asset-a',segmentId:'a-2',timeRange:{startSeconds:6,endSeconds:10}}),
    candidate({assetId:'asset-b',sourceRef:'asset-b',segmentId:'b-1'}),
  ];
  const result=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',productRef:'SKU-1',shots,candidates:candidates as never[]});
  assert.deepEqual(result.map(item=>item.selectedMaterialSegment?.sourceRef),['asset-a','asset-b','asset-a',undefined,undefined]);
  assert.deepEqual(result.filter(item=>item.selectedMaterialSegment?.sourceRef==='asset-a').map(item=>item.selectedMaterialSegment?.segmentId),['a-1','a-2']);
});
test('budget state never permits product shots to borrow factory or general footage', () => {
  const degraded = (candidates: never[]) => materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',
    productRef:'SKU-1',shots:[shot],candidates,productGenerationAllowed:false})[0]!;
  const weak = visual('产品静止展示');
  const other = candidate({assetId:'other',sourceRef:'other',productRef:null,productId:null,materialRoles:['other'],visualContract:weak});
  const factory = candidate({assetId:'factory',sourceRef:'factory',productRef:null,productId:null,materialRoles:['factory'],visualContract:weak});
  const product = candidate({assetId:'product',sourceRef:'product',materialRoles:['product'],visualContract:weak});
  for (const [items, ref] of [
    [[other, factory, product], undefined],
    [[other, factory], undefined],
    [[other], undefined],
  ] as const) {
    const result=degraded([...items] as never[]);
    assert.equal(result.localVideoMatch,undefined);
    assert.equal(result.selectedMaterialSegment?.sourceRef,ref);
  }
  assert.equal(degraded([candidate({mediaType:'image'}),candidate({synthetic:true}),candidate({timeRange:null})]).localVideoMatch,undefined);
});
test('inventory presence, wrong product, still image and missing movement are not verified matches', () => {
  for (const item of [candidate({ productRef: 'other' }), candidate({ mediaType: 'image' }),
    candidate({ origin: 'shared_library' }), candidate({ synthetic: true }), candidate({ visualContract: visual('手握包装盒静止展示') }),
    candidate({ timeRange: { startSeconds: 0, endSeconds: 2 } })]) {
    assert.equal(requests([item])[0]?.localVideoMatch, undefined);
  }
});
test('legacy request identity is preserved and is not silently routed to a new policy', () => {
  const shots = [shot];
  assert.equal(materialRoutingRequests({ tenantId: 'tenant', shots, candidates: [candidate()], productRef: 'SKU-1' }), shots);
});
test('positive motion remains required beside a packaging prohibition and stale proofs are cleared', () => {
  const prior = { ...shot, requestedDescription: '手持旋转产品，禁止改标签',
    localVideoMatch: { sourceRefs: ['gone'], semanticMatch: 'verified' as const, productRef: 'SKU-1', evidenceRef: 'old' },
    selectedMaterialSegment: { sourceRef: 'gone', segmentId: 'old', startSeconds: 0, endSeconds: 4 } };
  const result = materialRoutingRequests({ policyVersion: 'type-aware.v1', tenantId: 'tenant',
    shots: [prior], candidates: [candidate({ visualContract: visual('手握产品静止展示') })], productRef: 'SKU-1' })[0]!;
  assert.equal(result.localVideoMatch, undefined);
  assert.equal(result.selectedMaterialSegment, undefined);
});

test('negative prompt and evidence prohibitions never become positive local-match requirements', () => {
  const expected=normalizeSceneVisualContract({subjects:['person','product'],interaction:{kind:'person_using_product',description:'手部操作产品'},action:{path:'手部持续操作'},evidence:{sourceRange:{startSeconds:0,endSeconds:0.8}}});
  const usage=normalizeSceneVisualContract({subjects:['person','product'],interaction:{kind:'person_using_product',description:'手部操作产品'},action:{path:'手部持续操作'},productRef:'SKU-1',productPolicy:'locked'});
  const result=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',productRef:'SKU-1',shots:[{shotId:'negative',function:'demonstration',materialType:'consumer_demo',requestedDescription:'手部操作产品；不添加抽帧中未出现的旋转或摇晃动作。须避免：旋转、摇晃、错误背景',visualContract:expected}],candidates:[profiled({assetId:'owned-usage',sourceRef:'owned-usage',segmentId:'usage',origin:'my_materials',mediaType:'video',productId:null,productRef:'SKU-1',enterpriseCommon:true,productPolicy:'locked',materialRoles:['product','person_usage'],visualContract:usage,timeRange:{startSeconds:0,endSeconds:1},matchedVoiceoverCueIds:[],matchScore:1})] as never});
  assert.deepEqual(result[0]!.localVideoMatch?.sourceRefs,['owned-usage']);
});

test('new product tasks default to a fifteen-yuan whole-film ceiling and retain narrower explicit grants', () => {
  for (const requested of [undefined, null, 600, 10, 4]) {
    const input = parseCreateSocialTask({ title: '预算检查', objective: '产品正常制作', perItemBudgetCny: requested });
    const expected = requested === 4 ? 4 : requested === 10 ? 10 : 15;
    assert.equal(input.perItemBudgetCny, expected);
    assert.equal(defaultBrief(input).perItemBudgetCny, expected);
  }
  assert.equal(defaultBrief({ title: '内部创建', objective: '制作', perItemBudgetCny: 600 } as never).perItemBudgetCny, 10);
  assert.equal(defaultBrief({ title: '新版本内部创建', objective: '制作', materialRoutingPolicyVersion:'type-aware.v2', perItemBudgetCny: 600 } as never).perItemBudgetCny, 15);
});

test('normal creation and stored brief keep exact cached reference evidence without changing historical updates', () => {
  const referenceReuse = {recordId: 'trend_video_38', analysisId: 'verified-analysis-run', contentSha256: 'a'.repeat(64), analysisHash: 'b'.repeat(64)};
  const parsed = parseCreateSocialTask({title: '沿用38秒参考', objective: '由产品制作', referenceReuse});
  assert.deepEqual(parsed.referenceReuse, referenceReuse);
  assert.deepEqual(parseSocialTaskBrief(defaultBrief(parsed)).referenceReuse, referenceReuse);
  assert.deepEqual(parseUpdateSocialTask({expectedVersion: '1', changes: {referenceReuse}}).changes.referenceReuse, referenceReuse);
  for (const bad of [{...referenceReuse, contentSha256: 'missing'}, {...referenceReuse, analysisHash: ''}, {...referenceReuse, recordId: '../other'}, {...referenceReuse, allowApify: true}])
    assert.throws(() => parseCreateSocialTask({title: '拒绝错误缓存绑定', objective: '测试', referenceReuse: bad}));
});
test('normal source selection accepts a cached record ID and rejects client pricing or hash authority', () => {
  const source = {kind: 'reference_link', sourceRef: 'https://example.com/reference38', label: '已分析参考', cachedReferenceRecordId: 'trend_video_38'};
  assert.equal(parseSocialSource(source).cachedReferenceRecordId, 'trend_video_38');
  for (const bad of [{...source, kind: 'material'}, {...source, cachedReferenceRecordId: '../other'},
    {...source, cachedReferenceRecordId: ''}, {...source, analysisHash: 'a'.repeat(64)}, {...source, verifiedAccountPrice: true}]) {
    assert.throws(() => parseSocialSource(bad));
  }
});
test('baseline scene carries its planned visual subjects into Director review without borrowing candidate facts', () => {
  const result = materialRoutingRequests({policyVersion: 'type-aware.v1', tenantId: 'tenant', productRef: 'SKU-1',
    shots: [{shotId: 'baseline-detail', function: 'demonstration', requestedDescription: '产品可见细节 · 观察产品包装'}], candidates: []})[0]!;
  assert.equal(result.materialType, 'product');
  assert.deepEqual(result.visualContract?.subjects.map(subject => subject.kind), ['product']);
  assert.equal(result.visualContract?.action.path, '产品可见细节 · 观察产品包装');
  assert.equal(result.localVideoMatch, undefined);
  const unknown = materialRoutingRequests({policyVersion: 'type-aware.v1', tenantId: 'tenant', productRef: 'SKU-1',
    shots: [{shotId: 'unknown', function: 'transition', requestedDescription: '说明选择思路'}], candidates: []})[0]!;
  assert.equal(unknown.materialType, 'unknown');
  assert.equal(unknown.visualContract, undefined);
});
test('negative prompt text cannot turn product b-roll into presenter and verified factory action survives cosmetic mismatch', () => {
  const product = materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',productRef:'SKU-1',candidates:[],shots:[{shotId:'product',function:'value',requestedDescription:'产品静态展示。须避免：hands, human, presenter, watermark。保持该姿态自然口播。',visualContract:normalizeSceneVisualContract({subjects:['product'],interaction:{kind:'product_only_display',description:'产品静态展示'},productRef:'SKU-1',productPolicy:'locked'})}]});
  assert.equal(product[0]!.materialType,'product');
  const expected=normalizeSceneVisualContract({subjects:['factory','person','product'],interaction:{kind:'factory_process',description:'工厂灌装透明瓶'},action:{path:'自动灌装机将液体灌入透明瓶'}});
  const actual=normalizeSceneVisualContract({subjects:['factory','product'],interaction:{kind:'factory_process',description:'车间自动灌装机灌装'},action:{path:'机器灌装透明瓶'},camera:{shotSize:'特写',angle:'俯视',movement:'固定',composition:'中心'}});
  const factory=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',productRef:'SKU-1',shots:[{shotId:'factory',function:'demonstration',requestedDescription:'化妆品工厂自动灌装机将液体灌入透明瓶',visualContract:expected}],candidates:[profiled({assetId:'owned-factory',sourceRef:'owned-factory',segmentId:'fill-1',origin:'my_materials',mediaType:'video',productId:null,productRef:null,enterpriseCommon:true,productPolicy:'locked',materialRoles:['factory'],visualContract:actual,timeRange:{startSeconds:0,endSeconds:3},matchedVoiceoverCueIds:[],matchScore:1})] as never});
  assert.deepEqual(factory[0]!.localVideoMatch?.sourceRefs,['owned-factory']);
});

test('short reference slots accept owned segments that cover the slot instead of imposing a three-second floor', () => {
  const expected=normalizeSceneVisualContract({subjects:['factory','product'],interaction:{kind:'factory_process',description:'机器灌装容器并沿传送带移动'},action:{path:'灌装物料；容器沿传送带移动'},evidence:{sourceRange:{startSeconds:24.9,endSeconds:25.63}}});
  const actual=normalizeSceneVisualContract({subjects:['factory','product'],interaction:{kind:'factory_process',description:'灌装头向罐内注入物料，罐体随传送带移动'},action:{path:'灌装头持续注入物料；罐体随传送带匀速前移'}});
  const actualCandidate=profiled({tenantId:'tenant-a',assetId:'owned-fill',sourceRef:'owned-fill',segmentId:'fill',origin:'my_materials',mediaType:'video',productId:null,productRef:null,enterpriseCommon:true,productPolicy:'locked',materialRoles:['factory'],visualContract:actual,timeRange:{startSeconds:0,endSeconds:2.5},matchedVoiceoverCueIds:[],matchScore:1});
  const result=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant-a',productRef:'SKU-1',shots:[{shotId:'short-factory',function:'demonstration',requestedDescription:'机器灌装容器并沿传送带移动',visualContract:expected}],candidates:[actualCandidate] as never});
  assert.deepEqual(result[0]!.localVideoMatch?.sourceRefs,['owned-fill']);
  assert.deepEqual(result[0]!.selectedMaterialSegment,{sourceRef:'owned-fill',segmentId:'fill',startSeconds:0,endSeconds:2.5});
});

test('consumer demonstration uses a close owned usage clip but never factory or presenter footage', () => {
  const expected=normalizeSceneVisualContract({subjects:['person','product'],interaction:{kind:'person_using_product',description:'手部完成产品设计演示'},environment:{kind:'office',description:'设计工作室'},action:{path:'手部持续操作并完成演示'},evidence:{sourceRange:{startSeconds:23.7,endSeconds:24.27}}});
  const usage=normalizeSceneVisualContract({subjects:['person','product'],interaction:{kind:'person_using_product',description:'双手操作并展示产品使用'},environment:{kind:'other',description:'生活场景'},action:{path:'双手持续揉搓并完成使用演示'}});
  const base={tenantId:'tenant-a',origin:'my_materials',mediaType:'video',productId:null,productRef:'SKU-1',enterpriseCommon:true,productPolicy:'locked',visualContract:usage,timeRange:{startSeconds:0,endSeconds:4},matchedVoiceoverCueIds:[],matchScore:1};
  const make=(assetId:string,materialRoles:string[])=>profiled({assetId,sourceRef:assetId,segmentId:`${assetId}-segment`,materialRoles,...base});
  const accepted=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant-a',productRef:'SKU-1',shots:[{shotId:'consumer',function:'demonstration',materialType:'consumer_demo',requestedDescription:'手部完成产品设计演示',visualContract:expected}],candidates:[make('owned-usage',['product','person_usage'])] as never});
  assert.deepEqual(accepted[0]!.localVideoMatch?.sourceRefs,['owned-usage']);
  for(const roles of [['factory','person_usage'],['presenter','person_usage']]) {
    const rejected=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant-a',productRef:'SKU-1',shots:[{shotId:'consumer',function:'demonstration',materialType:'consumer_demo',requestedDescription:'手部完成产品设计演示',visualContract:expected}],candidates:[make('wrong-role',roles)] as never});
    assert.equal(rejected[0]!.localVideoMatch,undefined);
  }
});

test('consumer matching requires the same product identity and rejects product-unbound footage', () => {
  const expected=normalizeSceneVisualContract({subjects:['person','product'],interaction:{kind:'person_using_product',description:'手部操作产品'},environment:{kind:'office',description:'设计工作室'},productRef:'云朵泡沫卸妆蜜',productPolicy:'preferred',action:{path:'手部持续操作'},evidence:{sourceRange:{startSeconds:0,endSeconds:0.6}}});
  const projected=normalizeSceneVisualContract({subjects:['person','product'],interaction:{kind:'person_using_product',description:'手部操作并展示使用过程'},environment:{kind:'other',description:'生活场景'},productRef:'product:GUIANFA-RS-001',productPolicy:'locked',action:{path:'手部持续操作产品'}});
  const candidate=profiled({assetId:'owned-generic',sourceRef:'owned-generic',segmentId:'generic',origin:'my_materials',mediaType:'video',productId:null,productRef:null,enterpriseCommon:true,productPolicy:'locked',materialRoles:['product','person_usage'],visualContract:projected,timeRange:{startSeconds:0,endSeconds:1},matchedVoiceoverCueIds:[],matchScore:1});
  const input={policyVersion:'type-aware.v1' as const,tenantId:'tenant',productRef:'product:GUIANFA-RS-001',shots:[{shotId:'consumer',function:'demonstration' as const,materialType:'consumer_demo' as const,requestedDescription:'手部操作产品',visualContract:expected}]};
  assert.equal(materialRoutingRequests({...input,candidates:[candidate] as never})[0]!.localVideoMatch,undefined);
  const sameProduct=profiled({...candidate,productRef:'product:GUIANFA-RS-001'});
  assert.deepEqual(materialRoutingRequests({...input,candidates:[sameProduct] as never})[0]!.localVideoMatch?.sourceRefs,['owned-generic']);
  const identified=profiled({...candidate,assetId:'wrong-product',sourceRef:'wrong-product',segmentId:'wrong-product-segment',productId:'OTHER-SKU',productRef:'其他品牌'});
  assert.equal(materialRoutingRequests({...input,candidates:[identified] as never})[0]!.localVideoMatch,undefined);
});

test('customer shopping and business scenes stay on the local DTC route instead of product generation', () => {
  for (const [shotId, description] of [
    ['shopping', '从背后拍摄两位女性顾客在美妆店挑选产品，货架上摆满化妆品'],
    ['meeting', '一群人围坐在茶桌旁品茶并进行商务洽谈'],
  ] as const) {
    const result = materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',productRef:'product:SKU-1',candidates:[],
      shots:[{shotId,function:'value',requestedDescription:description,visualContract:normalizeSceneVisualContract({
        subjects:['person','product'],interaction:{kind:'other',description},productRef:'参考商品',productPolicy:'preferred',action:{path:description},
      })}]})[0]!;
    assert.equal(result.materialType,'consumer_demo');
    assert.equal(result.localVideoMatch,undefined);
  }
});

test('stale frozen product classification cannot override visible customer DTC evidence', () => {
  for (const description of ['两位女性顾客在美妆店挑选产品','一位男士与两位女士在货架前交谈']) {
    const result=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',productRef:'product:SKU-1',candidates:[],shots:[{
      shotId:'stale',function:'value',materialType:'product',requestedDescription:description,visualContract:normalizeSceneVisualContract({
        subjects:['person','environment'],interaction:{kind:'other',description},action:{path:description},productRef:'参考商品',productPolicy:'preferred',
      }),
    }]})[0]!;
    assert.equal(result.materialType,'consumer_demo');
  }
  const holding=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',productRef:'product:SKU-1',candidates:[],shots:[{
    shotId:'holding',function:'value',materialType:'product',requestedDescription:'顾客手持产品包装展示',visualContract:normalizeSceneVisualContract({
      subjects:['person','product'],interaction:{kind:'person_holding_product',description:'手持产品包装'},action:{path:'手持产品包装'},productRef:'product:SKU-1',productPolicy:'locked',
    }),
  }]})[0]!;
  assert.equal(holding.materialType,'product');
});

test('contact end card without a visible product is general graphics, never product I2V', () => {
  const description='黑色背景，中间是女主圆形头像，周围有 CONTACT ME 字样、飞机图标和粉色爱心';
  const result=materialRoutingRequests({policyVersion:'type-aware.v1',tenantId:'tenant',productRef:'product:SKU-1',candidates:[],shots:[{
    shotId:'end-card',function:'call_to_action',requestedDescription:description,visualContract:normalizeSceneVisualContract({
      subjects:['environment'],interaction:{kind:'other',description},action:{path:description},
    }),
  }]})[0]!;
  assert.equal(result.materialType,'general');
});
