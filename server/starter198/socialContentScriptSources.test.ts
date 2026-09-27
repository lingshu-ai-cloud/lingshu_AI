import assert from 'node:assert/strict';
import { freezeSocialScriptBaseline, parseStoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { buildSocialTaskReferencePackage } from './socialContentScriptSources.js';

const source = {
  sourceId: 'source-reference-1',
  sourceRef: 'https://example.com/reference-1',
  sourceVersion: 'analysis-v1',
  createdAt: '2026-09-27T00:00:00.000Z',
};

const record = {
  id: 'reference-record-1',
  title: 'OldBrand OldProduct 参考视频',
  sourceUrl: source.sourceRef,
  duration: 8,
  aiAnalysis: JSON.stringify({
    analysisMode: 'exact',
    analysisQuality: 'video',
    gemini: {
      theme: '产品使用',
      identityEntities: [
        { type: 'company', text: 'OldCo' },
        { type: 'brand', text: 'OldBrand' },
        { type: 'product', text: 'OldProduct' },
      ],
      scriptDetails15s: [
        {
          time: '0-3',
          purpose: '前三秒产品使用钩子',
          visual: '模特在浴室把 OldProduct 涂在脸上',
          environment: '浴室',
          interaction: '人物把产品涂在脸上',
          productUsage: '涂在脸上',
          shot: '近景特写',
          camera: '固定镜头',
          composition: '中心构图',
          dialogue: 'OldCo 的 OldBrand OldProduct，先看质地……  再看上脸。',
          onScreenText: 'OldBrand OldProduct｜真实上脸',
          confidence: 0.97,
        },
        {
          time: '3-6',
          purpose: '产品信息',
          visual: 'OldProduct 产品瓶特写',
          shot: '极近特写',
          camera: '缓慢推进',
          dialogue: '防水 10 米，结论以正式资料为准。',
          onScreenText: '防水 10 米',
          confidence: 0.94,
        },
        {
          time: '6-8',
          purpose: '产品收束',
          visual: '新产品静置在桌面',
          shot: '近景',
          camera: '固定镜头',
          confidence: 0.92,
        },
      ],
    },
  }),
};

const resolved = buildSocialTaskReferencePackage({
  record,
  source,
  themeId: 'product_value',
  verifiedContext: {
    enterpriseName: '新企业',
    brandName: '新品牌',
    productName: '新产品',
    facts: [{ key: 'material', label: '材质', value: '玻璃' }],
    source: 'enterprise_product',
    confidence: 1,
  },
});

assert.ok(resolved);
const publicHook = resolved.referenceVideoAnalysis.shots[0]!;
assert.equal(publicHook.spokenText, 'OldCo 的 OldBrand OldProduct，先看质地……  再看上脸。');
assert.equal(publicHook.captionText, 'OldBrand OldProduct｜真实上脸');
assert.equal(publicHook.visualContract?.precision, 'hook_high');
assert.equal(publicHook.visualContract?.interaction.kind, 'apply_product_to_face');

const hook = resolved.replicationScript.shots[0]!;
assert.equal(hook.referenceSpokenText, 'OldCo 的 OldBrand OldProduct，先看质地……  再看上脸。');
assert.equal(hook.spokenText, '新企业 的 新品牌 新产品，先看质地……  再看上脸。');
assert.equal(hook.captionText, '新品牌 新产品｜真实上脸');
assert.deepEqual(hook.voiceoverReplacement, {
  mode: 'identity_only',
  replacedEntityTypes: ['company', 'brand', 'product'],
});
assert.equal(hook.startSeconds, 0);
assert.equal(hook.endSeconds, 3);
assert.equal(resolved.replicationScript.shots[1]?.spokenText, '防水 10 米，结论以正式资料为准。', 'facts and punctuation must not be rewritten');
assert.equal(resolved.referenceVideoAnalysis.hookAnalysis?.capabilitySignature?.requiresPersonProductContact, true);
assert.equal(resolved.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.route, 'digital_human');
assert.equal(resolved.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.status, 'admitted');
assert.equal(resolved.replicationScript.hookOptions.every(option => option.spokenLine === '新企业 的 新品牌 新产品，先看质地……  再看上脸。'), true,
  '三个钩子方案只变画面路线，不得改写爆款口播');

const overlappingIdentityRecord = {
  ...record,
  id: 'reference-record-overlap',
  aiAnalysis: JSON.stringify({
    analysisMode: 'exact', analysisQuality: 'video',
    gemini: {
      identityEntities: [
        { type: 'company', text: '华研科技', evidence: '口播', confidence: 1 },
        { type: 'brand', text: '华研', evidence: '字幕', confidence: 1 },
        { type: 'product', text: '华研精华', evidence: '口播', confidence: 1 },
      ],
      scriptDetails15s: [
        { time: '0-3', purpose: '开场', visual: '华研精华瓶特写', dialogue: '华研科技的华研精华，现在就看。', onScreenText: '华研精华', confidence: 1 },
        { time: '3-6', purpose: '收束', visual: '产品静置', dialogue: '记住华研精华。', confidence: 1 },
      ],
    },
  }),
};
const overlapResolved = buildSocialTaskReferencePackage({
  record: overlappingIdentityRecord,
  source: { ...source, sourceId: 'source-overlap' },
  themeId: 'product_value',
  verifiedContext: {
    enterpriseName: '新企业', brandName: '新品牌', productName: '新产品',
    facts: [], source: 'enterprise_product', confidence: 1,
  },
});
assert.equal(overlapResolved?.replicationScript.shots[0]?.spokenText, '新企业的新产品，现在就看。',
  '中文重叠专名必须全局按最长原词优先替换');

const baseline = freezeSocialScriptBaseline({
  brief: {
    languages: ['zh'],
    productRef: '新产品',
    callToAction: null,
  } as never,
  theme: { themeId: 'product_value' } as never,
  replicationScript: resolved.replicationScript,
  inspiration: resolved.match,
  verifiedContext: {
    productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1,
  },
  lockedAt: '2026-09-27T00:01:00.000Z',
});
assert.equal(baseline.scenes[0]?.referenceSpokenText, hook.referenceSpokenText);
assert.deepEqual(baseline.scenes[0]?.voiceoverReplacement, hook.voiceoverReplacement);
assert.equal(baseline.scenes[0]?.voiceover, hook.spokenText);
assert.equal(baseline.scenes[2]?.voiceover, '', 'silent reference shots must stay silent');
const parsed = parseStoredSocialScriptBaseline(JSON.stringify(baseline));
assert.equal(parsed?.scenes[0]?.referenceSpokenText, hook.referenceSpokenText);
assert.deepEqual(parsed?.scenes[0]?.voiceoverReplacement, hook.voiceoverReplacement);
assert.equal(parsed?.scenes[2]?.voiceover, '');

console.log('social content script source tests passed');
