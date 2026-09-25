import assert from 'node:assert/strict';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow.js';
import { socialTaskToStudioSeed, socialThemeToStudioTheme } from './useStudioSocialTaskHydration.js';
import { createSocialAssetSupplyPlan } from '../../../shared/socialContentAssetSupply.js';

const task = {
  taskId: 'socialtask_test', version: '1', status: 'attention',
  brief: {
    title: '秋季新品内容', objective: '新品介绍', productRef: '户外便携储能电源', audience: '户外露营家庭',
    markets: ['德国', '法国'], languages: ['德语', 'French'], platforms: ['tiktok'], formats: ['short_video'],
    aspectRatio: '9:16', cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: '容量与认证以企业资料为准',
    restrictions: ['不得承诺绝对续航'], callToAction: '查看产品详情',
  },
  packageSelection: [], readiness: { complete: true, missing: [] }, runId: null,
  sourceCount: 1, knowledgeSourceCount: 0, materialSourceCount: 1, artifactCount: 0, approvedArtifactCount: 0,
  deliveryPackageCount: 0, publicationCount: 0, metricSubmissionCount: 0, createdAt: '', updatedAt: '',
  sources: [{ sourceId: 'source_1', taskId: 'socialtask_test', kind: 'material', sourceRef: `socialmaterial:${btoa('material-123')}`, sourceVersion: '1', label: '产品视频', purpose: null, status: 'active', createdAt: '' }],
  artifacts: [], deliveryPackages: [], publications: [], metricSubmissions: [],
} satisfies SocialContentTaskDetail;

const seed = socialTaskToStudioSeed(task);
assert.equal(seed.projectTitle, '秋季新品内容');
assert.equal(seed.productReference, '户外便携储能电源');
assert.equal(seed.contentMode, 'video');
assert.equal(seed.creationMode, 'material');
assert.deepEqual(seed.languageCodes, ['de', 'fr']);
assert.deepEqual(seed.selectedMaterialIds, ['material-123']);
assert.equal(seed.productInfo, '', 'free-text productRef must not hydrate Studio as confirmed product data');
assert.equal(seed.sellingPoints, '', 'free-text brandNotes must not hydrate Studio as confirmed selling points');
assert.match(seed.factVerificationNotice, /未作为已确认企业事实导入/);
assert.doesNotMatch(seed.productInfo, /户外便携储能电源|容量与认证|不得承诺/);
assert.equal(seed.audience, '户外露营家庭；目标市场：德国、法国');

const poster = socialTaskToStudioSeed({ ...task, brief: { ...task.brief, formats: ['image_post'], languages: ['未支持语言'], platforms: ['instagram'], aspectRatio: null }, sources: [] });
assert.equal(poster.contentMode, 'poster');
assert.equal(poster.creationMode, 'product');
assert.equal(poster.aspectRatio, '1:1');
assert.deepEqual(poster.languageCodes, ['zh']);
assert.deepEqual(poster.unsupportedLanguages, ['未支持语言']);

const themeCases = {
  product_value: 'product_proof',
  scenario_solution: 'use_case',
  supplier_capability: 'supplier_capability',
  customization_process: 'customization',
  customer_case: 'customer_case',
} as const;
for (const [themeId, expected] of Object.entries(themeCases)) {
  assert.equal(socialThemeToStudioTheme({
    theme: { themeId: themeId as keyof typeof themeCases, inputKind: 'preset', topic: '', classificationStatus: 'confirmed' },
  }), expected);
}
assert.equal(socialThemeToStudioTheme({ theme: null }), null);

const customTopic = socialTaskToStudioSeed({
  ...task,
  theme: {
    themeId: 'customization_process',
    inputKind: 'custom',
    topic: '展示我们给连锁美容院做小批量面膜定制的过程',
    classificationStatus: 'confirmed',
  },
});
assert.equal(customTopic.contentTheme, 'customization');
assert.equal(customTopic.themeTopic, '展示我们给连锁美容院做小批量面膜定制的过程');

const presetTopic = socialTaskToStudioSeed({
  ...task,
  theme: { themeId: 'product_value', inputKind: 'preset', topic: '一个镜头看懂卖点', classificationStatus: 'confirmed' },
});
assert.equal(presetTopic.contentTheme, 'product_proof');
assert.equal(presetTopic.themeTopic, '', 'preset topic remains represented by the mapped Studio theme');

const digitalHumanSeed = socialTaskToStudioSeed({
  ...task,
  assetSupplyPlan: createSocialAssetSupplyPlan({
    creationMode: 'viral_replication', planVersion: 'plan-3', confirmedFactRefs: ['fact-product'],
    inventory: { presenterAssetIds: ['presenter-enterprise-1'], referenceVideoIds: ['reference-video-1'] },
    shots: [{ shotId: 'scene-hook', function: 'hook', requestedDescription: '企业人物复刻参考片的开场节奏' }],
  }),
});
assert.deepEqual(digitalHumanSeed.digitalHumanShotPlans, [{
  shotId: 'scene-hook', shotIndex: 0, requestedDescription: '企业人物复刻参考片的开场节奏',
  workflow: 'viral_replication', method: 'replace', presenterAssetIds: ['presenter-enterprise-1'], referenceMaterialIds: ['reference-video-1'],
  referenceRequired: true, candidateTools: ['local_head_pipeline', 'runway_kling_motion'],
  executionState: 'preview_only', sourceTaskId: task.taskId, sourceTaskVersion: task.version,
}]);

console.log('studio social task hydration tests passed');
