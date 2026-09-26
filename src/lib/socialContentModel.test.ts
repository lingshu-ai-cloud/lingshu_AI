import assert from 'node:assert/strict';
import { SOCIAL_CONTENT_TASK_STATUSES } from '../../shared/contracts/socialContentWorkflow.js';
import type { SocialDeliveryPackage } from '../../shared/contracts/socialContentWorkflow.js';
import {
  EMPTY_SOCIAL_CONTENT_DRAFT,
  socialContentAssetReviewAction,
  socialContentCanRegisterPublication,
  socialContentCurrentArtifacts,
  socialContentPrimaryActionForTask,
  socialContentPrimaryAction,
  socialContentMaterialCanStart,
  socialShotFunctionLabel,
  socialShotMaterialCountsLabel,
  socialShotSourceStrategyLabel,
  socialContentProductionProgress,
  socialContentStage,
  socialContentStagesForMode,
  socialContentTaskHeadline,
  validateSocialContentDraft,
} from './socialContentModel.js';

assert.equal(socialContentStage('needs_input'), 'prepare');
assert.equal(socialContentStage('asset_review'), 'review');
assert.equal(socialContentStage('awaiting_metrics'), 'measure');
assert.equal(socialContentStagesForMode('instant')[0]?.label, '准备信息');
assert.equal(socialContentStagesForMode('weekly')[0]?.label, '本周设定');
assert.equal(socialContentPrimaryAction('plan_review'), 'start');
assert.equal(socialContentPrimaryAction('paused'), 'resume');
assert.equal(socialContentPrimaryAction('attention'), 'continue_production');
assert.equal(socialContentPrimaryAction('delivered'), 'download');
assert.equal(socialContentPrimaryAction('awaiting_publish'), 'register_publication');
assert.equal(socialContentPrimaryAction('awaiting_metrics'), 'submit_metrics');
assert.equal(socialContentAssetReviewAction([{ status: 'review_required' }, { status: 'approved' }]), 'review');
assert.equal(socialContentAssetReviewAction([{ status: 'approved' }, { status: 'superseded' }]), 'package');
assert.equal(socialContentAssetReviewAction([{ status: 'changes_requested' }, { status: 'approved' }]), 'progress');
assert.equal(socialContentMaterialCanStart('none', { hasVideo: false, imageCount: 0, referenceLinkCount: 0 }), true,
  'zero-asset one-click creation must not require a customer shoot');
assert.equal(socialContentMaterialCanStart('limited', { hasVideo: false, imageCount: 1, referenceLinkCount: 0 }), true);
assert.equal(socialContentMaterialCanStart('limited', { hasVideo: false, imageCount: 0, referenceLinkCount: 1 }), true);
assert.equal(socialContentMaterialCanStart('ready', { hasVideo: false, imageCount: 1, referenceLinkCount: 0 }), false);
assert.equal(socialShotFunctionLabel('hook'), '前三秒钩子');
assert.equal(socialShotSourceStrategyLabel('authorized_digital_presenter'), '账号一致数字人口播');
assert.equal(socialShotSourceStrategyLabel('aigc_product_scene_replication'), 'AIGC 产品场景复刻');
assert.deepEqual(socialShotMaterialCountsLabel({
  customerAssetIds: ['customer-1'],
  generatedAssetIds: ['generated-1', 'generated-2'],
  licensedAssetIds: [],
}), ['客户素材 1 项', '生成画面 2 项']);

const sevenPendingArtifacts = Array.from({ length: 7 }, (_, index) => ({
  artifactId: `socialartifact_${index}`,
  status: 'review_required' as const,
}));
const allCurrentArtifacts = socialContentCurrentArtifacts([
  ...sevenPendingArtifacts,
  { artifactId: 'socialartifact_old', status: 'superseded' as const },
]);
assert.equal(allCurrentArtifacts.length, 7, 'all pending artifacts remain actionable beyond the sixth item');
assert.equal(allCurrentArtifacts.at(-1)?.artifactId, 'socialartifact_6');

const productionTask = (
  status: (typeof SOCIAL_CONTENT_TASK_STATUSES)[number],
  artifacts: Array<{ status: 'draft' | 'review_required' | 'approved' | 'changes_requested' | 'superseded' }> = [],
  readiness = { complete: true, missing: [] as string[] },
) => ({ status, artifacts, readiness, deliveryPackages: [], publications: [], metricSubmissions: [] });
const waitingForInput = socialContentProductionProgress(productionTask(
  'needs_input',
  [],
  { complete: false, missing: ['product', 'source_material'] },
) as never);
assert.equal(waitingForInput.currentStageId, 'inputs');
assert.equal(waitingForInput.steps[0]?.state, 'current');
assert.match(waitingForInput.detail, /2 项制作信息待补充/);
const needsContinuation = socialContentProductionProgress(productionTask('attention') as never);
assert.equal(needsContinuation.currentStageId, 'production');
assert.equal(needsContinuation.headline, '机器人正在自动重试');
assert.match(needsContinuation.detail, /脚本、素材与生成结果均已保存/);
const producingDraft = socialContentProductionProgress(productionTask('producing', [{ status: 'draft' }]) as never);
assert.equal(producingDraft.currentStageId, 'production');
assert.equal(producingDraft.steps.find(step => step.id === 'quality')?.state, 'pending',
  'a draft artifact must not invent a running quality-check state that the task contract does not expose');
const awaitingReview = socialContentProductionProgress(productionTask('asset_review', [{ status: 'review_required' }]) as never);
assert.equal(awaitingReview.currentStageId, 'review');
assert.equal(awaitingReview.steps.find(step => step.id === 'quality')?.state, 'complete');
assert.equal(awaitingReview.pendingReviewCount, 1);
const packaged = socialContentProductionProgress(productionTask('packaging', [{ status: 'approved' }]) as never);
assert.ok(packaged.steps.every(step => step.state === 'complete'));

const taskState = (overrides: Record<string, unknown> = {}) => ({
  status: 'awaiting_publish' as const,
  deliveryPackages: [],
  publications: [],
  metricSubmissions: [],
  ...overrides,
});
const preparing = taskState({ deliveryPackages: [{ status: 'preparing' }] });
assert.equal(socialContentCanRegisterPublication(preparing as never), false);
assert.equal(socialContentPrimaryActionForTask(preparing as never), 'view_progress');
assert.equal(socialContentTaskHeadline(preparing as never), '正在整理交付包');
const ready = taskState({ deliveryPackages: [{ status: 'ready' }] });
assert.equal(socialContentCanRegisterPublication(ready as never), true);
assert.equal(socialContentPrimaryActionForTask(ready as never), 'register_publication');
assert.equal(socialContentTaskHeadline(ready as never), '交付包已准备好');
const published = taskState({ deliveryPackages: [{ status: 'ready' }], publications: [{ publicationId: 'socialpub_1' }] });
assert.equal(socialContentPrimaryActionForTask(published as never), 'submit_metrics');
assert.equal(socialContentTaskHeadline(published as never), '发布结果已登记');
const measured = taskState({ deliveryPackages: [{ status: 'ready' }], publications: [{ publicationId: 'socialpub_1' }], metricSubmissions: [{ submissionId: 'socialmetric_1' }] });
assert.equal(socialContentTaskHeadline(measured as never), '发布数据已回传');

const readyDelivery: SocialDeliveryPackage = {
  packageId: 'socialpkg_ready',
  taskId: 'socialtask_one',
  version: '1',
  status: 'ready',
  artifactIds: [],
  packageHash: 'a'.repeat(64),
  downloadHref: '/api/overseas/starter-198/social-content/delivery-packages/socialpkg_ready/download',
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
};
const publicationStatuses = new Set(['delivered', 'awaiting_publish', 'awaiting_metrics']);
for (const status of SOCIAL_CONTENT_TASK_STATUSES) {
  assert.equal(
    socialContentCanRegisterPublication({ status, deliveryPackages: [readyDelivery] }),
    publicationStatuses.has(status),
    `${status} publication eligibility must match the server state table`,
  );
}
assert.equal(socialContentCanRegisterPublication({
  status: 'awaiting_publish',
  deliveryPackages: [readyDelivery, { ...readyDelivery, packageId: 'socialpkg_preparing', status: 'preparing', version: '2' }],
}), false, 'a preparing latest package cannot fall back to an older ready package');
assert.equal(socialContentCanRegisterPublication({
  status: 'reviewed',
  deliveryPackages: [{ ...readyDelivery, status: 'confirmed' }],
}), false, 'reviewed tasks never reopen publication registration');

const emptyIssues = validateSocialContentDraft(EMPTY_SOCIAL_CONTENT_DRAFT);
assert.equal(emptyIssues[0]?.length, 2, 'instant creation only requires an autogenerated title and goal before submission');
assert.equal(emptyIssues[1], undefined, 'enterprise knowledge and source materials are optional enhancements');
assert.ok(emptyIssues[2]?.length >= 2);

const minimalInstantDraft = {
  ...EMPTY_SOCIAL_CONTENT_DRAFT,
  title: '介绍产品卖点',
  primaryGoal: '介绍产品卖点',
  platforms: ['tiktok'],
  formats: ['short_video'],
};
assert.deepEqual(validateSocialContentDraft(minimalInstantDraft), {}, 'a first-time user can start with only a theme and recommended defaults');

const validDraft = {
  ...EMPTY_SOCIAL_CONTENT_DRAFT,
  title: '九月新品内容',
  productName: '户外电源',
  primaryGoal: '新品介绍',
  audience: '德国户外露营家庭',
  market: '德国',
  selectedSources: [
    { optionId: 'knowledge:1', kind: 'knowledge' as const, sourceRef: 'knowledge-1', sourceVersion: 'v1', label: '企业资料', type: 'document', thumbnailHref: null },
    { optionId: 'material:1', kind: 'material' as const, sourceRef: 'asset-1', sourceVersion: 'v1', label: '产品素材', type: 'image', thumbnailHref: null },
  ],
  platforms: ['tiktok'],
  formats: ['short_video'],
};
assert.deepEqual(validateSocialContentDraft(validDraft), {});
assert.match(validateSocialContentDraft({ ...validDraft, referenceLinks: ['not-a-link'] })[1]?.[0] || '', /参考链接/);
assert.deepEqual(validateSocialContentDraft({
  ...validDraft,
  selectedSources: validDraft.selectedSources.filter(source => source.kind === 'knowledge'),
  referenceLinks: ['https://example.com/reference'],
}), {}, 'a reference link or enterprise source is never required to replace missing material');
assert.deepEqual(validateSocialContentDraft({ ...validDraft, audience: '' }), {}, 'audience is optional for instant creation');
assert.match(validateSocialContentDraft({ ...validDraft, mode: 'weekly', audience: '' })[0]?.join('') || '', /目标客户/);
assert.match(validateSocialContentDraft({ ...validDraft, market: Array.from({ length: 11 }, (_, index) => `市场${index}`).join('、') })[0]?.join('') || '', /最多 10 项/);
assert.match(validateSocialContentDraft({ ...validDraft, keyFacts: '信'.repeat(3_001) })[1]?.join('') || '', /3000/);

console.log('social content presentation model tests passed');
