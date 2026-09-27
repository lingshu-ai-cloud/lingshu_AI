import assert from 'node:assert/strict';
import { buildMaterialScriptAnalysis } from '../../shared/materialScriptAnalysis.js';
import {
  buildSocialWorkflowMaterialCandidates,
  type SocialWorkflowMaterialClipCandidate,
} from './socialContentRecords.js';

function analyzedRecord(input: {
  id: string;
  type: 'image' | 'video';
  productId?: string;
  productRef?: string;
  enterpriseCommon?: boolean;
  segments?: Array<Record<string, unknown>>;
}) {
  const duration = input.type === 'video' ? 12 : 0;
  const segments = input.segments ?? (input.type === 'image' ? [] : [{
    id: `${input.id}-segment`, start: 1, end: 4, confidence: 0.92,
    subject: ['办公环境'], environment: '办公室', action: '平稳横移',
  }]);
  return {
    id: input.id,
    tenantId: 'tenant-a',
    name: input.id,
    type: input.type,
    duration,
    productId: input.productId,
    productRef: input.productRef,
    enterpriseCommon: input.enterpriseCommon,
    visualObservations: input.type === 'image' ? ['产品瓶身与包装清晰展示'] : [],
    segments,
    scriptAnalysis: buildMaterialScriptAnalysis({
      materialId: input.id,
      name: input.id,
      sourceRevision: `revision:${input.id}`,
      duration,
      segments,
      visualObservations: input.type === 'image' ? ['产品瓶身与包装清晰展示'] : [],
      productId: input.productId,
      productRef: input.productRef,
    }),
  };
}

const productA = analyzedRecord({ id: 'product-a', type: 'image', productId: 'product-id-a', productRef: '精华 A' });
const productB = analyzedRecord({ id: 'product-b', type: 'image', productId: 'product-id-b', productRef: '精华 B' });
const factory = analyzedRecord({
  id: 'factory-b', type: 'video', productId: 'product-id-b', productRef: '精华 B',
  segments: [{
    id: 'factory-filling', start: 2, end: 6, confidence: 0.94,
    subject: ['工厂灌装线'], environment: '工厂车间', action: '灌装设备连续运行', interaction: 'factory_process',
  }],
});
const customerCase = analyzedRecord({
  id: 'customer-case', type: 'video',
  segments: [{
    id: 'case-result', start: 3, end: 7, confidence: 0.9,
    subject: ['客户案例'], environment: '门店', action: '展示合作案例陈列',
  }],
});
const unanalyzedVideo = {
  id: 'whole-video', tenantId: 'tenant-a', name: '未分析整段视频', type: 'video', duration: 20,
  visualObservations: ['工厂与产品'],
};
const segmentOnlyVideo = {
  id: 'segment-only', tenantId: 'tenant-a', name: '仅有片段分析', type: 'video', duration: 9,
  segments: [{
    id: 'segment-only-range', start: 4, end: 8, confidence: 0.88,
    subject: ['办公环境'], environment: '办公室', action: '员工展示办公区域',
  }],
};

const locked = buildSocialWorkflowMaterialCandidates({
  records: [productA, productB, factory, customerCase, unanalyzedVideo, segmentOnlyVideo],
  tenantId: 'tenant-a',
  selectedProductRef: '精华 A',
  voiceoverRows: [{ cueId: 'line-1', text: '看工厂如何完成灌装' }],
});
assert.equal(locked.productPolicy, 'locked');
assert.equal(locked.requestedProductId, 'product-id-a');
assert.ok(locked.candidates.some(candidate => candidate.assetId === 'product-a'));
assert.ok(!locked.candidates.some(candidate => candidate.assetId === 'product-b'), 'locked product images must not cross products');
assert.ok(locked.candidates.some(candidate => candidate.assetId === 'factory-b' && candidate.materialRoles.includes('factory')),
  'real factory clips remain usable regardless of their product association');
assert.ok(locked.candidates.some(candidate => candidate.assetId === 'customer-case' && candidate.materialRoles.includes('customer_case')));
assert.ok(!locked.candidates.some(candidate => candidate.assetId === 'whole-video'), 'unanalyzed whole videos must not become generic candidates');
assert.deepEqual(locked.candidates.find(candidate => candidate.assetId === 'segment-only')?.timeRange,
  { startSeconds: 4, endSeconds: 8 }, 'analyzed segments remain usable even before a persisted scriptAnalysis projection exists');
assert.ok(locked.candidates.every(candidate => candidate.productPolicy === 'locked'
  && candidate.visualContract.product.policy === 'locked'));
const factoryClip = locked.candidates.find(candidate => candidate.assetId === 'factory-b') as SocialWorkflowMaterialClipCandidate;
assert.deepEqual(factoryClip.timeRange, { startSeconds: 2, endSeconds: 6 });
assert.deepEqual(factoryClip.visualContract.evidence.sourceRange, factoryClip.timeRange);
assert.equal(factoryClip.segmentId, 'factory-filling');
assert.equal(factoryClip.productId, 'product-id-b');
assert.deepEqual(factoryClip.matchedVoiceoverCueIds, ['line-1']);

const preferred = buildSocialWorkflowMaterialCandidates({
  records: [productB, productA],
  tenantId: 'tenant-a',
  voiceoverRows: [{ cueId: 'line-product', text: '产品包装展示' }],
});
assert.equal(preferred.productPolicy, 'preferred');
assert.equal(preferred.requestedProductRef, '精华 A', 'inference must be stable under input ordering');
assert.ok(preferred.candidates.every(candidate => candidate.productPolicy === 'preferred'));
assert.ok(preferred.candidates.some(candidate => candidate.assetId === 'product-b'),
  'preferred products influence ranking without turning into a hard exclusion');

const lockedById = buildSocialWorkflowMaterialCandidates({
  records: [productA, productB],
  tenantId: 'tenant-a',
  selectedProductId: 'product-id-b',
  voiceoverRows: [],
});
assert.equal(lockedById.productPolicy, 'locked');
assert.equal(lockedById.requestedProductRef, '精华 B');
assert.deepEqual([...new Set(lockedById.candidates.map(candidate => candidate.assetId))], ['product-b']);

const open = buildSocialWorkflowMaterialCandidates({
  records: [analyzedRecord({ id: 'enterprise-common', type: 'video', enterpriseCommon: true })],
  tenantId: 'tenant-a',
  voiceoverRows: [{ cueId: 'line-general', text: '企业环境' }],
});
assert.equal(open.productPolicy, 'open');
assert.equal(open.requestedProductRef, null);
assert.equal(open.candidates[0]?.enterpriseCommon, true);
assert.equal(open.candidates[0]?.visualContract.product.source, 'inventory_open');

console.log('social content record material candidate tests passed');
