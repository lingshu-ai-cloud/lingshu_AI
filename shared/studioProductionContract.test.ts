import assert from 'node:assert/strict';
import {
  reconcileStudioProductionSpec,
  studioProductionSnapshotIssues,
} from './studioProductionContract.js';

const drifted = {
  script: '当前已确认脚本',
  storyboardAssignments: { S01: 'material-current' },
  storyboardSourcePlans: { S01: { route: 'library' } },
  videoKickoff: { referenceAnalysis: { title: '当前分析' } },
  analysisResults: {
    schemaVersion: 'studio-analysis.v1',
    reference: { title: '旧分析' },
    storyboard: {
      script: '旧脚本',
      assignments: { S01: 'material-old' },
      sourcePlans: { S01: { route: 'generated' } },
    },
    voiceover: {},
    shots: {},
  },
};

assert.deepEqual(studioProductionSnapshotIssues(drifted), [
  '脚本存在两个不一致版本',
  '逐镜素材绑定存在两个不一致版本',
  '逐镜来源方案存在两个不一致版本',
  '参考视频分析存在两个不一致版本',
]);

const reconciled = reconcileStudioProductionSpec(drifted);
assert.deepEqual(studioProductionSnapshotIssues(reconciled), []);
assert.equal(reconciled.analysisResults.storyboard.script, drifted.script);
assert.deepEqual(reconciled.analysisResults.storyboard.assignments, drifted.storyboardAssignments);
assert.deepEqual(reconciled.analysisResults.storyboard.sourcePlans, drifted.storyboardSourcePlans);
assert.deepEqual(reconciled.analysisResults.reference, drifted.videoKickoff.referenceAnalysis);
assert.equal(reconciled.studioProductionContract.authority, 'project_spec');

const legacySnapshot = {
  title: '仅兼容快照的旧项目',
  // A client-supplied marker must not prevent the v1 migration.
  studioProductionContract: {
    schemaVersion: 'studio-production-contract.v1',
    authority: 'project_spec',
    compatibilitySnapshot: 'analysisResults',
  },
  analysisResults: {
    schemaVersion: 'studio-analysis.v1',
    reference: { title: '旧项目参考分析' },
    storyboard: {
      script: '旧项目脚本',
      assignments: { S01: 'legacy-material' },
      clipEdits: { S01: { trimStart: 1 } },
      sourcePlans: { S01: { route: 'library' } },
      assemblies: [{ id: 'assembly-1' }],
    },
    voiceover: {
      text: ['第一句'],
      drafts: { en: ['Line one'] },
      audios: { zh: { url: '/voice.mp3' } },
      alignedCuesByLang: { zh: [{ start: 0, end: 1 }] },
    },
    shots: {
      shootingSlots: [{ id: 'S01' }],
      productions: { S01: { state: 'completed' } },
    },
  },
};
const migrated = reconcileStudioProductionSpec(legacySnapshot);
assert.equal(migrated.script, '旧项目脚本');
assert.deepEqual(migrated.storyboardAssignments, { S01: 'legacy-material' });
assert.deepEqual(migrated.clipEdits, { S01: { trimStart: 1 } });
assert.deepEqual(migrated.storyboardSourcePlans, { S01: { route: 'library' } });
assert.deepEqual(migrated.storyboardAssemblies, [{ id: 'assembly-1' }]);
assert.deepEqual(migrated.voiceoverLines, ['第一句']);
assert.deepEqual(migrated.voiceDrafts, { en: ['Line one'] });
assert.deepEqual(migrated.voiceoverAudios, { zh: { url: '/voice.mp3' } });
assert.deepEqual(migrated.alignedCuesByLang, { zh: [{ start: 0, end: 1 }] });
assert.deepEqual(migrated.shootingSlots, [{ id: 'S01' }]);
assert.deepEqual(migrated.shotProductions, { S01: { state: 'completed' } });
assert.deepEqual(migrated.videoKickoff, { referenceAnalysis: { title: '旧项目参考分析' } });
assert.deepEqual(migrated.analysisResults.storyboard.script, migrated.script);
assert.deepEqual(migrated.analysisResults.reference, migrated.videoKickoff.referenceAnalysis);
assert.equal(migrated.studioProductionContract.authority, 'project_spec');
assert.equal('script' in legacySnapshot, false, 'migration must not mutate the caller value');

const partialRoot = reconcileStudioProductionSpec({
  script: '根脚本优先',
  videoKickoff: { video: { id: 'reference-video' } },
  analysisResults: {
    schemaVersion: 'studio-analysis.v1',
    reference: { title: '迁移的参考分析' },
    storyboard: { script: '兼容快照脚本', assignments: { S01: 'migrated-material' } },
  },
});
assert.equal(partialRoot.script, '根脚本优先');
assert.equal(partialRoot.analysisResults.storyboard.script, '根脚本优先');
assert.deepEqual(partialRoot.storyboardAssignments, { S01: 'migrated-material' });
assert.deepEqual(partialRoot.videoKickoff, {
  video: { id: 'reference-video' },
  referenceAnalysis: { title: '迁移的参考分析' },
});

for (const analysisResults of [
  undefined,
  { storyboard: { script: '无版本兼容脚本' } },
  { schemaVersion: 'studio-analysis.v2', storyboard: { script: '未知版本脚本' } },
]) {
  const untrusted = {
    title: '伪造 authority marker',
    studioProductionContract: {
      schemaVersion: 'studio-production-contract.v1',
      authority: 'project_spec',
      compatibilitySnapshot: 'analysisResults',
    },
    ...(analysisResults === undefined ? {} : { analysisResults }),
  };
  const sanitized = reconcileStudioProductionSpec(untrusted);
  assert.equal('studioProductionContract' in sanitized, false, 'unknown analysis schema cannot retain an authority marker');
  assert.equal('script' in sanitized, false, 'unknown analysis schema cannot promote compatibility data');
  assert.equal(sanitized.title, untrusted.title);
  assert.equal('studioProductionContract' in untrusted, true, 'sanitizing must not mutate the caller value');
}

const frozen = {
  ...drifted,
  resolvedStudioContract: { schemaVersion: 'social-frozen-studio.v1' },
};
assert.equal(reconcileStudioProductionSpec(frozen), frozen, 'server-owned frozen plans must not be rewritten by compatibility reconciliation');
assert.deepEqual(studioProductionSnapshotIssues(frozen), []);

console.log('studio production contract tests passed');
