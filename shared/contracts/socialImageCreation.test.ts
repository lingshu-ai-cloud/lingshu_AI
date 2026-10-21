import assert from 'node:assert/strict';
import test from 'node:test';
import { SOCIAL_IMAGE_HARD_CHECKS, socialImageTaskCanPublish, socialImageTaskIssues, type SocialImageCreationTask } from './socialImageCreation.js';

function task(): SocialImageCreationTask {
  return {
    schemaVersion: 'social-image-creation.v1', id: 'task-1', version: 3, title: '产品海报', creationPath: 'material_processing', contentMode: 'image', imageType: 'product_poster', step: 'review', status: 'approved',
    contentBrief: { objective: 'lead_generation', topicType: 'technical_solution', coreClaim: '降低配方刺激感', audience: ['品牌研发'], productRefs: ['product-1'], productNames: ['产品一'], evidenceItems: [], factuality: 'verified', prohibitedClaims: [] },
    creativeRecipe: { narrativePattern: 'problem_solution', visualProof: 'product_hero', layoutRecipe: 'hero_product_poster', copyPattern: '问题→证据→CTA', imageTextRelation: 'image_contextualizes_copy', colorStrategy: 'derive_from_product', referenceStrength: 0.4 },
    imageTextContract: { headline: '更温和的配方路径', caption: '基于已确认产品资料。', hashtags: [], requiredFacts: ['降低配方刺激感'], prohibitedInferences: [], visualMustShow: ['产品一'], visualMustNotImply: [] },
    deliverySpec: { format: 'jpg', platform: 'facebook', aspectRatio: '4:5', language: 'en', outputCount: 1 }, materialIds: [], referenceUrls: [], enterpriseAssets: [{ assetId: 'product-1', role: 'product', name: '产品一', source: 'enterprise_knowledge_base', required: true }], generationJobs: [], repairInstructions: [], fieldsToConfirm: [],
    outputs: [{ id: 'output-1', role: 'single', label: '主视觉', state: 'approved', version: 1, mediaUrl: '/media/output.jpg', qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => (
      { key, verdict: 'pass' as const, severity: 'hard' as const, note: '通过' }
    )) }], publishable: false, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z',
  };
}

test('verified approved image task can become publishable', () => {
  assert.deepEqual(socialImageTaskIssues(task()), []);
  assert.equal(socialImageTaskCanPublish(task()), true);
});

test('mock facts and failed hard gates cannot publish', () => {
  const value = task();
  value.contentBrief.factuality = 'mock';
  value.outputs[0]!.qualityChecks[0]!.verdict = 'fail';
  value.publishable = true;
  assert.match(socialImageTaskIssues(value).join('；'), /模拟内容不可直接发布/);
  assert.match(socialImageTaskIssues(value).join('；'), /硬质量门未全部通过/);
  assert.equal(socialImageTaskCanPublish({ ...value, publishable: false }), false);
});

test('gif requires motion delivery spec', () => {
  const value = task();
  value.imageType = 'gif_poster';
  value.deliverySpec.format = 'gif';
  assert.match(socialImageTaskIssues(value).join('；'), /GIF 缺少动效规格/);
});

test('carousel and GIF cannot publish a single image as a completed multi-output task', () => {
  const carousel = task();
  carousel.imageType = 'carousel';
  carousel.deliverySpec = { ...carousel.deliverySpec, format: 'carousel', outputCount: 4 };
  assert.match(socialImageTaskIssues(carousel).join('；'), /多图单元/);
  assert.equal(socialImageTaskCanPublish(carousel), false);

  const gif = task();
  gif.imageType = 'gif_poster';
  gif.deliverySpec = { ...gif.deliverySpec, format: 'gif', outputCount: 4,
    motion: { mechanism: 'background_switch', fixedLayers: ['product', 'headline'], dynamicLayers: ['background'], loopDurationMs: 6000 } };
  assert.match(socialImageTaskIssues(gif).join('；'), /多图单元/);
  assert.equal(socialImageTaskCanPublish(gif), false);
});
