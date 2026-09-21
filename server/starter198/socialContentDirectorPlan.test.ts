import assert from 'node:assert/strict';
import {
  buildSocialDirectorPlan,
  parseStoredSocialDirectorPlan,
  publicSocialDirectorPlanSummary,
  reviseSocialDirectorPlanForVoiceoverFit,
  socialDirectorContentHandoff,
  socialDirectorCoverTimestamp,
  socialDirectorRenderTimeline,
  socialDirectorSceneTimingCues,
  socialDirectorScriptText,
  type SocialDirectorBgmSelection,
} from './socialContentDirectorPlan.js';
import { freezeSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { buildSocialProductionPlan } from './socialContentProductionPlan.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';

const createdAt = '2026-09-20T12:00:00.000Z';
const formula: InternalSocialContentFormula = {
  recordId: 'private-formula-record',
  formulaId: 'admin.product-director',
  version: '1.0.0',
  name: '管理员产品编导公式',
  themeId: 'product_value',
  status: 'active',
  rollout: { percentage: 100, tenantAllowlist: [] },
  audit: [{ event: 'published_active', actor: 'admin', at: createdAt }],
  direction: {
    pace: 'fast',
    music: { mood: '干净、明快', volume: 16 },
    voiceover: { voice: 'v1', preset: 'professional_b2b', speed: 1.08, pauseStyle: 'natural' },
    subtitles: { fontScale: 1, bottomRatio: 0.18 },
  },
  nodes: [
    ['opening', '产品开场', '产品全貌', '完整展示'],
    ['detail', '细节证明', '产品细节', '近景展示'],
    ['usage', '使用展示', '使用过程', '连续展示'],
  ].map(([nodeId, shotFunction, subject, action]) => ({
    nodeId: nodeId!, shotFunction: shotFunction!, subject: subject!, action: action!, environment: null,
    orientation: 'portrait' as const, durationSeconds: { minimum: 2, maximum: 6 }, required: true,
    narrationTemplate: { zh: `口播-${subject}`, en: `Voice-${subject}` },
    scriptTemplate: { zh: `脚本-${shotFunction}`, en: `Script-${shotFunction}` },
    voiceoverTemplate: { zh: `口播-${subject}`, en: `Voice-${subject}` },
    captionTemplate: { zh: `字幕-${subject}`, en: `Caption-${subject}` },
  })),
};

const baseline = freezeSocialScriptBaseline({
  brief: {
    title: '不得直接朗读的任务名', objective: '只表达意图', productRef: null, audience: '采购商',
    markets: ['中国'], languages: ['中文'], platforms: ['抖音'], formats: ['短视频'], aspectRatio: '9:16',
    cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: [], callToAction: null,
  },
  theme: { themeId: 'product_value', inputKind: 'preset', topic: '产品卖点', classificationStatus: 'confirmed' },
  formula,
  verifiedContext: {
    productName: '已确认护肤品', facts: [{ key: 'category', label: '类别', value: '护肤品' }],
    source: 'enterprise_product', confidence: 1,
  },
  lockedAt: createdAt,
});

assert.equal(baseline.scenes[0]?.script, '脚本-产品开场');
assert.equal(baseline.scenes[0]?.voiceover, '口播-产品全貌');
assert.equal(baseline.scenes[0]?.caption, '字幕-产品全貌');

const asset = {
  id: 'material-one', name: '真实产品视频', type: 'video' as const, sourceId: 'source-one', url: '/tmp/material.mp4',
  contentHash: 'a'.repeat(64), cloudRecordId: 'cloud-material-one',
  duration: 12, visualObservations: ['产品全貌、产品细节和使用过程'],
  segments: [
    { start: 0, end: 4, confidence: 0.92, observedFacts: '产品全貌完整展示' },
    { start: 4, end: 8, confidence: 0.9, observedFacts: '产品细节近景展示' },
    { start: 8, end: 12, confidence: 0.9, observedFacts: '产品使用过程连续展示' },
  ],
};
const productionPlan = buildSocialProductionPlan({ baseline, assets: [asset] });
assert.equal(productionPlan.ok, true, productionPlan.message);

const bgmSelection: SocialDirectorBgmSelection = {
  primary: {
    trackId: 'builtin-mixkit-close-up', name: '灵枢推荐配乐04', mood: '科技产业 · 律动推进',
    authorization: {
      status: 'authorized', basis: 'mixkit_free_license', license: 'Mixkit Free License',
      evidence: 'https://mixkit.co/license/#musicFree',
    },
  },
  fallbacks: [{
    trackId: 'builtin-tech-pulse', name: '灵枢推荐配乐01', mood: '科技感 · 稳定推进',
    authorization: {
      status: 'authorized', basis: 'lingshu_builtin_library', license: '灵枢内置商用曲库授权',
      evidence: 'authenticated_catalog:builtin-tech-pulse',
    },
  }],
  fallbackPolicy: 'ordered_preapproved_tracks_only', volume: 99,
};
const buildPlan = (previous?: ReturnType<typeof buildSocialDirectorPlan>) => buildSocialDirectorPlan({
  taskId: 'social-task-director-lock-test',
  baseline,
  productionPlan,
  productionAssets: [asset],
  sourceVersions: { 'source-one': 'source-version-7' },
  outputSpec: { aspectRatio: '9:16', resolution: '720p', platform: 'douyin' },
  bgmSelection,
  formula,
  createdAt,
  previous,
});
const directorPlan = buildPlan();
assert.equal(directorPlan.status, 'ready');
assert.equal(directorPlan.lockStatus, 'locked');
assert.match(directorPlan.directorPlanId, /^director_plan_[a-f0-9]{24}$/);
assert.equal(directorPlan.createdBy, 'director_agent');
assert.equal(directorPlan.direction.pace, 'fast');
assert.equal(directorPlan.scenes[0]?.voiceover, productionPlan.scenes[0]?.narration);
assert.equal(directorPlan.materialSnapshot[0]?.contentHash, 'a'.repeat(64));
assert.equal(directorPlan.materialSnapshot[0]?.sourceVersion, 'source-version-7');
assert.equal(directorPlan.outputSpec.aspectRatio, '9:16');
assert.equal(directorPlan.bgmSelection.primary.trackId, 'builtin-mixkit-close-up');
assert.equal(directorPlan.bgmSelection.fallbacks[0]?.trackId, 'builtin-tech-pulse');
assert.equal(directorPlan.bgmSelection.volume, 16, 'formula-owned director volume is locked');
assert.equal(directorPlan.coverIntent.assetId, 'material-one');
assert.equal(directorPlan.contentAgentHandoff.scriptLocked, true);
assert.deepEqual(directorPlan.contentAgentHandoff.forbiddenActions, [
  'rewrite_script', 'invent_product_facts', 'replace_real_material_with_text_cards',
  'select_unplanned_bgm', 'change_output_spec',
]);

const parsed = parseStoredSocialDirectorPlan(JSON.stringify(directorPlan));
assert.deepEqual(parsed, directorPlan);
assert.throws(() => parseStoredSocialDirectorPlan({
  ...directorPlan,
  scriptSource: { ...directorPlan.scriptSource, kind: 'knowledge_fallback' },
}), /social_content_director_plan_record_invalid/);
assert.throws(() => parseStoredSocialDirectorPlan({
  ...directorPlan,
  outputSpec: { ...directorPlan.outputSpec, aspectRatio: '16:9' },
}), /social_content_director_plan_lineage_invalid/,
'parse must recompute the complete immutable handoff hash');
const publicSummary = publicSocialDirectorPlanSummary(parsed);
assert.equal(publicSummary?.formulaConfigured, true);
assert.match(publicSummary?.scriptSummary ?? '', /脚本-产品开场/);
assert.match(publicSummary?.voiceoverSummary ?? '', /口播/);
assert.match(publicSummary?.subtitleSummary ?? '', /字幕/);
assert.match(publicSummary?.shotRhythmSummary ?? '', /明快节奏/);
assert.doesNotMatch(JSON.stringify(publicSummary), /admin\.product-director|private-formula-record/);

const handoff = socialDirectorContentHandoff(directorPlan);
assert.equal(handoff.narration, directorPlan.scenes.map(scene => scene.voiceover).join(''));
assert.deepEqual(handoff.scenes.map(item => item.caption), directorPlan.scenes.map(scene => scene.caption));
assert.equal(handoff.outputSpec.aspectRatio, directorPlan.outputSpec.aspectRatio);
assert.equal(handoff.bgmSelection.primary.trackId, directorPlan.bgmSelection.primary.trackId);
assert.equal(handoff.scenes[0]?.source.renderUrl, asset.url);
assert.equal(Object.prototype.hasOwnProperty.call(handoff, 'prompt'), false,
  'Content Agent receives no prompt or rewrite surface');
const executionDuration = handoff.outputSpec.maximumDurationSeconds;
const cues = socialDirectorSceneTimingCues(handoff, executionDuration);
const timeline = socialDirectorRenderTimeline(handoff, executionDuration);
assert.equal(cues.length, directorPlan.scenes.length);
assert.equal(timeline.length, directorPlan.scenes.length);
assert.ok(socialDirectorCoverTimestamp(handoff, executionDuration) > 0);
assert.match(socialDirectorScriptText(handoff, executionDuration), /已锁定片段/);
assert.throws(() => socialDirectorRenderTimeline({
  ...handoff,
  outputSpec: { ...handoff.outputSpec, aspectRatio: '16:9' },
}, executionDuration), /social_content_director_handoff_lineage_invalid/,
'Content Agent execution helpers reject a mutated handoff');

const next = buildPlan(directorPlan);
assert.equal(next.version, '2', 'each Director Agent handoff is versioned');
assert.equal(next.directorPlanId, directorPlan.directorPlanId, 'Director plan identity is stable across versions');

const revised = reviseSocialDirectorPlanForVoiceoverFit({
  previous: directorPlan,
  measuredDurationSeconds: directorPlan.outputSpec.maximumDurationSeconds * 1.8,
  createdAt: '2026-09-20T12:01:00.000Z',
});
assert.equal(revised.version, '2');
assert.equal(revised.directorPlanId, directorPlan.directorPlanId);
assert.equal(revised.revision.kind, 'voiceover_fit');
assert.notEqual(revised.lineageHash, directorPlan.lineageHash);
assert.ok(revised.scenes.every((scene, index) => (
  scene.voiceover.length < directorPlan.scenes[index]!.voiceover.length
)));
assert.deepEqual(parseStoredSocialDirectorPlan(revised), revised);

const naturalChinesePlan = buildSocialDirectorPlan({
  taskId: 'social-task-natural-voiceover-test',
  baseline,
  productionPlan: {
    ...productionPlan,
    scenes: productionPlan.scenes.map((scene, index) => index === 0 ? {
      ...scene,
      narration: '想了解玻尿酸精华液 OEM 样品的已确认信息，可以联系我们。',
    } : scene),
  },
  productionAssets: [asset],
  sourceVersions: { 'source-one': 'source-version-7' },
  outputSpec: { aspectRatio: '9:16', resolution: '720p', platform: 'douyin' },
  bgmSelection,
  formula,
  createdAt,
});
const naturalChineseRevision = reviseSocialDirectorPlanForVoiceoverFit({
  previous: naturalChinesePlan,
  measuredDurationSeconds: directorPlan.outputSpec.maximumDurationSeconds * 1.8,
  createdAt: '2026-09-20T12:02:00.000Z',
});
assert.equal(naturalChineseRevision.scenes[0]?.voiceover, '详情请联系我们。');
assert.doesNotMatch(naturalChineseRevision.scenes[0]?.voiceover ?? '', /的已。/);

console.log('Social Director Agent plan contract tests passed');
