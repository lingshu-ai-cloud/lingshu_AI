import assert from 'node:assert/strict';
import { batchShotRequestId, planStudioBatchShotRoutes, uniqueAuthorizedSalesPresenter } from './studioBatchShotRoutes.js';

const key = { projectId: 'project', batchId: 'click-1', assemblyId: 'assembly', shotId: 'a', fingerprint: 'f1' };
assert.equal(batchShotRequestId(key), batchShotRequestId({ ...key }));
assert.notEqual(batchShotRequestId(key), batchShotRequestId({ ...key, fingerprint: 'f2' }));
assert.notEqual(batchShotRequestId(key), batchShotRequestId({ ...key, shotId: 'b' }));
assert.equal(uniqueAuthorizedSalesPresenter([{ id: 'sales', name: '销售', authorized: true }])?.id, 'sales');
assert.equal(uniqueAuthorizedSalesPresenter([{ id: 'sales-1', name: '销售', authorized: true }, { id: 'sales-2', name: '销售', authorized: true }]), null);
assert.equal(uniqueAuthorizedSalesPresenter([{ id: 'sales', name: '销售', authorized: false }]), null);

const routes = planStudioBatchShotRoutes({
  activeAssemblyId: 'assembly',
  shootingSlots: [
    { id: 'a', slotId: 'slot-a', detail: '销售对镜口播，提出问题', salesPresenterConfirmed: true, requirements: '建立信任' },
    { id: 'b', slotId: 'slot-b', detail: '工厂灌装实拍', requirements: '证明生产流程' },
    { id: 'c', slotId: 'slot-c', detail: '产品瓶身和质地展示', requirements: '介绍产品' },
    { id: 'd', slotId: 'slot-d', detail: '销售快速靠近摄像头并敲门', salesPresenterConfirmed: true, requirements: '动作截流' },
  ],
  shotProductions: {
    'assembly:a': { source: 'avatar', presenterId: 'sales', narration: 'See the product.', contentType: 'enterprise_presenter' } as never,
    'assembly:d': { source: 'avatar', presenterId: 'sales', narration: 'Listen.', contentType: 'enterprise_presenter' } as never,
  },
  storyboardAssignments: { 'slot-b': 'factory-asset', 'slot-c': 'reference-only' },
  clipEdits: { 'slot-b:factory-asset': { segmentId: 'factory-segment-2', trimStart: 4, trimEnd: 6.5 } },
  materialSnapshots: [{ id: 'factory-asset', usage: 'enterprise', url: '/factory.mp4', type: 'video', duration: 10 }, { id: 'reference-only', usage: 'reference_only' }],
}, { talkingExecutorReady: true, actionExecutorReady: false, authorizedPresenterIds: ['sales'] });

assert.deepEqual(routes.map(item => [item.visualTopic, item.route, item.status]), [
  ['presenter', 'digital_human', 'blocked'],
  ['factory', 'local_material', 'matched'],
  ['product', 'aigc_first_frame', 'needs_plan'],
  ['presenter', 'digital_human', 'blocked'],
]);
assert.ok(routes.every(item => item.generated === false));
assert.deepEqual([routes[1]?.matchedMaterialId, routes[1]?.matchedSegmentId, routes[1]?.trimStart, routes[1]?.trimEnd],
  ['factory-asset', 'factory-segment-2', 4, 6.5], '交接须包含所选片段及裁切区间');
assert.match(routes[3]!.reason, /替换范围|生成效果/);

const disabled = planStudioBatchShotRoutes({
  activeAssemblyId: 'assembly', shootingSlots: [{ id: 'a', slotId: 'slot-a', detail: '销售口播', salesPresenterConfirmed: true }],
  shotProductions: { 'assembly:a': { source: 'avatar', presenterId: 'sales', narration: 'Hello.' } as never },
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: ['sales'] });
assert.equal(disabled[0]?.status, 'blocked');
assert.match(disabled[0]!.reason, /替换范围|生成效果/);

const importedPlaceholder = planStudioBatchShotRoutes({
  activeAssemblyId: 'video-1',
  shootingSlots: [
    { id: 'first', slotId: 'slot-1', detail: '画面：女性快速靠近镜头，敲门手势 镜头功能：hook 口播：Hello', salesPresenterConfirmed: true },
    { id: 'factory', slotId: 'slot-2', detail: '画面：工人操作流水线，产品灌装 镜头功能：trust 口播：无' },
  ],
  shotProductions: {
    'video-1:first': { source: 'avatar', presenterId: '', narration: 'Hello', digitalHuman: { method: 'reenact' } } as never,
    'video-1:factory': { source: 'avatar', presenterId: '', narration: '无', digitalHuman: { method: 'reenact' } } as never,
  },
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(importedPlaceholder[0]?.route, 'digital_human');
assert.equal(importedPlaceholder[0]?.status, 'blocked');
assert.equal(importedPlaceholder[1]?.route, 'aigc_first_frame',
  'stale avatar placeholders cannot classify factory footage as a presenter');
assert.equal(importedPlaceholder[1]?.status, 'needs_plan');

const taggedNonProduct = planStudioBatchShotRoutes({ activeAssemblyId: 'a', shootingSlots: [
  { id: 'worker', slotId: 'worker', detail: '画面：工人操作流水线，产品瓶身经过传送带', observedPresenterRole: 'presenter_action' },
  { id: 'usage', slotId: 'usage', detail: '画面：双手轻触脸颊，卧室自然光' },
], storyboardSourcePlans: {
  worker: { shotTopic: 'factory', sceneType: 'factory', mode: 'ai' },
  usage: { shotTopic: 'general', sceneType: 'general', mode: 'ai' },
} }, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.deepEqual(taggedNonProduct.map(item => [item.visualTopic, item.route]), [['factory', 'aigc_first_frame'], ['other', 'aigc_first_frame']]);

const salesDefault = planStudioBatchShotRoutes({
  activeAssemblyId: 'video-1', shootingSlots: [{ id: 'talk', slotId: 'slot-talk', detail: '画面：销售对镜口播 镜头功能：value 口播：Hello', salesPresenterConfirmed: true }],
  shotProductions: { 'video-1:talk': { source: 'avatar', presenterId: '', narration: 'Hello', digitalHuman: { method: 'reenact' } } as never },
}, { talkingExecutorReady: true, actionExecutorReady: false, authorizedPresenterIds: ['sales'], defaultSalesPresenterId: 'sales' });
assert.equal(salesDefault[0]?.status, 'blocked', '不得静默使用默认人物');

const voicedBroll = planStudioBatchShotRoutes({
  activeAssemblyId: 'video-1',
  shootingSlots: [
    { id: 'factory-voice', slotId: 'factory-voice', detail: '画面：女性在工厂背景观察工人灌装流水线 镜头功能：trust 口播：We make it here.' },
    { id: 'product-voice', slotId: 'product-voice', detail: '画面：双手展示产品瓶身和质地 镜头功能：value 口播：This is our product.' },
    { id: 'speaker', slotId: 'speaker', detail: '画面：销售正面直视镜头，嘴唇张合 镜头功能：call_to_action 口播：Contact us.', salesPresenterConfirmed: true },
    { id: 'background', slotId: 'background', detail: '画面：工厂工人背影在流水线旁操作 镜头功能：trust 口播：We inspect every bottle.' },
    { id: 'meeting', slotId: 'meeting', detail: '画面：会议主讲者发言，其他人坐在桌旁 镜头功能：trust 口播：We have partners.' },
  ],
  shotProductions: Object.fromEntries(['factory-voice', 'product-voice', 'speaker', 'background', 'meeting'].map(id => [`video-1:${id}`, {
    source: 'avatar', presenterId: '', narration: 'Voiceover.', digitalHuman: { method: 'reenact' },
  }])) as never,
}, { talkingExecutorReady: true, actionExecutorReady: false, authorizedPresenterIds: ['sales'], defaultSalesPresenterId: 'sales' });
assert.deepEqual(voicedBroll.map(item => item.route), ['aigc_first_frame', 'aigc_first_frame', 'digital_human', 'aigc_first_frame', 'aigc_first_frame']);

const factoryPresenter = planStudioBatchShotRoutes({
  activeAssemblyId: 'a', shootingSlots: [{ id: 'speaker', detail: '画面：女性正面面对镜头说话，手举产品，背景工人正在工厂灌装。\n口播：欢迎了解我们的产品', salesPresenterConfirmed: true }],
  shotProductions: { 'a:speaker': { presenterId: 'sales', narration: '欢迎了解' } as never },
}, { talkingExecutorReady: true, actionExecutorReady: false, authorizedPresenterIds: ['sales'] });
assert.equal(factoryPresenter[0]?.route, 'digital_human', '背景工人和产品不能排除前景销售口播');

const structuredRole = planStudioBatchShotRoutes({
  activeAssemblyId: 'a', shootingSlots: [{ id: 'speaker', detail: '画面：工厂里手持产品', observedPresenterRole: 'sales_presenter', personContinuityId: 'person_1' }],
  shotProductions: { 'a:speaker': { presenterId: 'sales', narration: '欢迎了解', digitalHuman: { workflow: 'viral_replication', method: 'reenact', contentConfirmed: true, presenterSelected: true, replacementScope: 'person_and_scene', targetEffect: 'flexible_scene' } } as never },
}, { talkingExecutorReady: true, actionExecutorReady: true, authorizedPresenterIds: ['sales'] });
assert.equal(structuredRole[0]?.visualTopic, 'presenter', '视觉模型角色识别优先于旧文字规则');
assert.equal(structuredRole[0]?.route, 'seedance_action', '用户确认的场景重建方案不会被批量生成覆盖');
assert.equal(structuredRole[0]?.status, 'needs_plan');

const unconfirmedPeople = planStudioBatchShotRoutes({ shootingSlots: [
  { id: 'hook', detail: '画面：女性靠近镜头，敲门手势 镜头功能：d_to_c 口播：Hello' },
  { id: 'passerby', detail: '画面：路人正面说话 口播：Hello' },
  { id: 'actor', detail: '画面：女性正面面对镜头说话 口播：Hello' },
]}, { talkingExecutorReady: true, actionExecutorReady: true, authorizedPresenterIds: ['sales'] });
assert.ok(unconfirmedPeople.every(route => route.route !== 'digital_human' && route.route !== 'seedance_action'), '人物或动作候选不得自动提交数字人');

const userMaterials = planStudioBatchShotRoutes({ activeAssemblyId: 'a',
  shootingSlots: [{ id: 's', slotId: 'display', observedPresenterRole: 'sales_presenter', personContinuityId: 'p' }],
  shotProductions: { 'a:s': { source: 'avatar' } as never },
  storyboardSourcePlans: { display: { userSource: 'material', confirmed: true } },
  storyboardAssignments: { display: 'enterprise' }, materialSnapshots: [{ id: 'enterprise', url: '/enterprise.mp4', type: 'video', duration: 10 }],
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(userMaterials[0]?.route, 'local_material');
assert.equal(userMaterials[0]?.status, 'matched', '全企业素材不要求任何数字人配置');

const identityConflict = planStudioBatchShotRoutes({ activeAssemblyId: 'assembly',
  shootingSlots: ['one','two'].map(id => ({ id, slotId: id, observedPresenterRole: 'sales_presenter' as const, personContinuityId: 'main' })),
  shotProductions: { 'assembly:one': { presenterId: 'enterprise-one' }, 'assembly:two': { presenterId: 'enterprise-two' } } as any,
}, { talkingExecutorReady: true, actionExecutorReady: true, authorizedPresenterIds: ['enterprise-one','enterprise-two'] });
assert.ok(identityConflict.every(route => route.status === 'blocked' && route.reason.includes('同一个企业人物资产')));

// A red, confirmed salesperson can use enterprise footage without any presenter asset.
const materialSalesRoute = planStudioBatchShotRoutes({
  activeAssemblyId: 'assembly', ratio: '9:16',
  shootingSlots: [{ id: 'sales', slotId: 'sales-slot', detail: '销售对镜口播', salesPresenterConfirmed: true, duration: 3 }],
  shotProductions: { 'assembly:sales': { source: 'avatar', sound: 'source', presenterId: '', narration: 'New speech' } as never },
  storyboardSourcePlans: { 'sales-slot': { userSource: 'material' } },
  storyboardAssignments: { 'sales-slot': 'owned' },
  materialSnapshots: [{ id: 'owned', usage: 'enterprise', url: '/owned.mp4', type: 'video', duration: 5, width: 1080, height: 1920 }],
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(materialSalesRoute[0].route, 'local_material');
assert.equal(materialSalesRoute[0].status, 'matched');

const aigcReference = planStudioBatchShotRoutes({ activeAssemblyId: 'a',
  shootingSlots: [{ id: 'factory', slotId: 'factory-slot', detail: '画面：工厂流水线，工人工作' }],
  shotProductions: { 'a:factory': { source: 'ai' } as never },
  storyboardSourcePlans: { 'factory-slot': { mode: 'hybrid', confirmed: false } },
  storyboardAssignments: { 'factory-slot': 'reference-image' },
  materialSnapshots: [{ id: 'reference-image', usage: 'reference_only', type: 'image', url: '/reference.png' }],
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(aigcReference[0]?.route, 'aigc_first_frame', '参考图不能被视为已完成的镜头');
assert.equal(aigcReference[0]?.status, 'needs_plan');
assert.match(aigcReference[0]!.reason, /首帧/);
const lockedAigc = planStudioBatchShotRoutes({ activeAssemblyId: 'a',
  shootingSlots: [{ id: 'product', slotId: 'product-slot', detail: '产品手持特写', duration: 4 }],
  shotProductions: { 'a:product': { source: 'ai', locked: true } as never },
  storyboardSourcePlans: { 'product-slot': { mode: 'ai' } },
  storyboardAssignments: { 'product-slot': 'owned-video' },
  materialSnapshots: [{ id: 'owned-video', usage: 'enterprise', type: 'video', url: '/owned.mp4', duration: 4, width: 1080, height: 1920 }],
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(lockedAigc[0]?.route, 'local_material');
assert.equal(lockedAigc[0]?.status, 'matched');
const lockedUnassigned = planStudioBatchShotRoutes({ activeAssemblyId: 'a',
  shootingSlots: [{ id: 'product', slotId: 'product-slot', detail: '产品手持特写' }],
  shotProductions: { 'a:product': { source: 'ai', locked: true } as never },
  storyboardSourcePlans: { 'product-slot': { mode: 'ai' } },
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(lockedUnassigned[0]?.route, 'unresolved');
assert.equal(lockedUnassigned[0]?.status, 'blocked');
const evidenceBlocked = planStudioBatchShotRoutes({ activeAssemblyId: 'a',
  shootingSlots: [{ id: 'unknown', slotId: 'unknown-slot', detail: '待确认镜头', locked: true, blocker: '镜头类型待确认' }],
  storyboardSourcePlans: { 'unknown-slot': { mode: 'blocked', blocker: '镜头类型待确认' } },
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(evidenceBlocked[0]?.route, 'unresolved');
assert.equal(evidenceBlocked[0]?.status, 'blocked');
assert.match(evidenceBlocked[0]!.reason, /镜头类型待确认/);
const installation = planStudioBatchShotRoutes({ activeAssemblyId: 'a',
  shootingSlots: [{ id: 'install', slotId: 'install-slot', detail: '在客厅安装吊灯', duration: 18 }],
  shotProductions: { 'a:install': { source: 'ai' } as never },
  storyboardSourcePlans: { 'install-slot': { mode: 'ai', sceneType: 'usage' } },
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(installation[0]?.visualTopic, 'usage_scene');
assert.equal(installation[0]?.route, 'aigc_first_frame');
const consumerDemo = planStudioBatchShotRoutes({ activeAssemblyId: 'a',
  shootingSlots: [{ id: 'demo', slotId: 'demo-slot', detail: '模特展示面霜效果', duration: 4 }],
  shotProductions: { 'a:demo': { source: 'ai' } as never },
  storyboardSourcePlans: { 'demo-slot': { mode: 'ai', shotTopic: 'consumer_demo' } },
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(consumerDemo[0]?.visualTopic, 'usage_scene');
