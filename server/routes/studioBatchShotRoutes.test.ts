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
    { id: 'a', slotId: 'slot-a', detail: '销售对镜口播，提出问题', requirements: '建立信任' },
    { id: 'b', slotId: 'slot-b', detail: '工厂灌装实拍', requirements: '证明生产流程' },
    { id: 'c', slotId: 'slot-c', detail: '产品瓶身和质地展示', requirements: '介绍产品' },
    { id: 'd', slotId: 'slot-d', detail: '销售快速靠近摄像头并敲门', requirements: '动作截流' },
  ],
  shotProductions: {
    'assembly:a': { source: 'avatar', presenterId: 'sales', narration: 'See the product.', contentType: 'enterprise_presenter' } as never,
    'assembly:d': { source: 'avatar', presenterId: 'sales', narration: 'Listen.', contentType: 'enterprise_presenter' } as never,
  },
  storyboardAssignments: { 'slot-b': 'factory-asset', 'slot-c': 'reference-only' },
  clipEdits: { 'slot-b:factory-asset': { segmentId: 'factory-segment-2', trimStart: 4, trimEnd: 6.5 } },
  materialSnapshots: [{ id: 'factory-asset', usage: 'enterprise' }, { id: 'reference-only', usage: 'reference_only' }],
}, { talkingExecutorReady: true, actionExecutorReady: false, authorizedPresenterIds: ['sales'] });

assert.deepEqual(routes.map(item => [item.visualTopic, item.route, item.status]), [
  ['presenter', 'digital_human', 'needs_plan'],
  ['factory', 'local_material', 'matched'],
  ['product', 'local_material', 'matched'],
  ['presenter', 'seedance_action', 'blocked'],
]);
assert.ok(routes.every(item => item.generated === false));
assert.deepEqual([routes[1]?.matchedMaterialId, routes[1]?.matchedSegmentId, routes[1]?.trimStart, routes[1]?.trimEnd],
  ['factory-asset', 'factory-segment-2', 4, 6.5], '交接须包含所选片段及裁切区间');
assert.match(routes[3]!.reason, /执行器尚未接通/);

const disabled = planStudioBatchShotRoutes({
  activeAssemblyId: 'assembly', shootingSlots: [{ id: 'a', slotId: 'slot-a', detail: '销售口播' }],
  shotProductions: { 'assembly:a': { source: 'avatar', presenterId: 'sales', narration: 'Hello.' } as never },
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: ['sales'] });
assert.equal(disabled[0]?.status, 'blocked');
assert.match(disabled[0]!.reason, /执行器不可用/);

const importedPlaceholder = planStudioBatchShotRoutes({
  activeAssemblyId: 'video-1',
  shootingSlots: [
    { id: 'first', slotId: 'slot-1', detail: '画面：女性快速靠近镜头，敲门手势 镜头功能：hook 口播：Hello' },
    { id: 'factory', slotId: 'slot-2', detail: '画面：工人操作流水线，产品灌装 镜头功能：trust 口播：无' },
  ],
  shotProductions: {
    'video-1:first': { source: 'avatar', presenterId: '', narration: 'Hello', digitalHuman: { method: 'reenact' } } as never,
    'video-1:factory': { source: 'avatar', presenterId: '', narration: '无', digitalHuman: { method: 'reenact' } } as never,
  },
}, { talkingExecutorReady: false, actionExecutorReady: false, authorizedPresenterIds: [] });
assert.equal(importedPlaceholder[0]?.route, 'seedance_action');
assert.equal(importedPlaceholder[1]?.route, 'local_material',
  'stale avatar placeholders cannot classify factory footage as a presenter');
assert.equal(importedPlaceholder[1]?.status, 'needs_material');

const salesDefault = planStudioBatchShotRoutes({
  activeAssemblyId: 'video-1', shootingSlots: [{ id: 'talk', slotId: 'slot-talk', detail: '画面：销售对镜口播 镜头功能：value 口播：Hello' }],
  shotProductions: { 'video-1:talk': { source: 'avatar', presenterId: '', narration: 'Hello', digitalHuman: { method: 'reenact' } } as never },
}, { talkingExecutorReady: true, actionExecutorReady: false, authorizedPresenterIds: ['sales'], defaultSalesPresenterId: 'sales' });
assert.equal(salesDefault[0]?.status, 'needs_plan');

const voicedBroll = planStudioBatchShotRoutes({
  activeAssemblyId: 'video-1',
  shootingSlots: [
    { id: 'factory-voice', slotId: 'factory-voice', detail: '画面：女性在工厂背景观察工人灌装流水线 镜头功能：trust 口播：We make it here.' },
    { id: 'product-voice', slotId: 'product-voice', detail: '画面：双手展示产品瓶身和质地 镜头功能：value 口播：This is our product.' },
    { id: 'speaker', slotId: 'speaker', detail: '画面：销售正面直视镜头，嘴唇张合 镜头功能：call_to_action 口播：Contact us.' },
    { id: 'background', slotId: 'background', detail: '画面：工厂工人背影在流水线旁操作 镜头功能：trust 口播：We inspect every bottle.' },
    { id: 'meeting', slotId: 'meeting', detail: '画面：会议主讲者发言，其他人坐在桌旁 镜头功能：trust 口播：We have partners.' },
  ],
  shotProductions: Object.fromEntries(['factory-voice', 'product-voice', 'speaker', 'background', 'meeting'].map(id => [`video-1:${id}`, {
    source: 'avatar', presenterId: '', narration: 'Voiceover.', digitalHuman: { method: 'reenact' },
  }])) as never,
}, { talkingExecutorReady: true, actionExecutorReady: false, authorizedPresenterIds: ['sales'], defaultSalesPresenterId: 'sales' });
assert.deepEqual(voicedBroll.map(item => item.route), ['local_material', 'local_material', 'digital_human', 'local_material', 'local_material']);
