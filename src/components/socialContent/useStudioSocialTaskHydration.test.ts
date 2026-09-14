import assert from 'node:assert/strict';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow.js';
import { socialTaskToStudioSeed } from './useStudioSocialTaskHydration.js';

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
assert.equal(seed.contentMode, 'video');
assert.equal(seed.creationMode, 'material');
assert.deepEqual(seed.languageCodes, ['de', 'fr']);
assert.deepEqual(seed.selectedMaterialIds, ['material-123']);
assert.match(seed.productInfo, /不得承诺绝对续航/);
assert.equal(seed.audience, '户外露营家庭；目标市场：德国、法国');

const poster = socialTaskToStudioSeed({ ...task, brief: { ...task.brief, formats: ['image_post'], languages: ['未支持语言'], platforms: ['instagram'], aspectRatio: null }, sources: [] });
assert.equal(poster.contentMode, 'poster');
assert.equal(poster.creationMode, 'product');
assert.equal(poster.aspectRatio, '1:1');
assert.deepEqual(poster.languageCodes, ['zh']);
assert.deepEqual(poster.unsupportedLanguages, ['未支持语言']);

console.log('studio social task hydration tests passed');
