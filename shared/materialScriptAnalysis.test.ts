import assert from 'node:assert/strict';
import { buildMaterialScriptAnalysis, reusableMaterialScriptAnalysis } from './materialScriptAnalysis.js';

const analysis = buildMaterialScriptAnalysis({
  materialId: 'material-1',
  name: '工厂灌装实拍',
  sourceRevision: 'rev-1',
  duration: 8,
  analyzedAt: '2026-09-22T00:00:00.000Z',
  segments: [{
    id: 'segment-1', start: 0, end: 2.5, confidence: 0.92,
    subject: ['工厂工人', '透明瓶产品'],
    action: '灌装机连续灌装透明瓶', environment: '工厂产线',
    actionStart: .3, actionPeak: 1.2, actionEnd: 2.1,
    cleanStart: .2, cleanEnd: 2.3, cleanEntry: true, cleanExit: true, boundaryConfidence: .88,
    recommendedFunctions: ['工厂证明'], observedFacts: ['灌装机和透明瓶清晰可见'],
  }],
});

assert.equal(analysis.shots[0]?.role, 'hook');
assert.ok(analysis.hookCapability.score >= 80);
assert.match(analysis.shots[0]?.instruction || '', /前三秒/);
assert.match(analysis.searchableText, /工厂产线/);
assert.equal(analysis.shots[0]?.editorial.trim.actionPeakSeconds, 1.2);
assert.equal(analysis.shots[0]?.editorial.trim.cleanEntry, true);
assert.equal(analysis.schemaVersion, 'material-script-analysis.v3');
assert.match(analysis.directorIndex.actions.join(' '), /灌装/);
assert.equal(analysis.shots[0]?.visualContract.precision, 'hook_high');
assert.equal(analysis.shots[0]?.visualContract.environment.kind, 'factory');
assert.ok(analysis.shots[0]?.materialRoles.includes('factory'));
assert.ok(analysis.directorIndex.materialRoles.includes('product'));
assert.match(analysis.truthBoundary, /不会改写客户原片/);
assert.equal(reusableMaterialScriptAnalysis(analysis, 'rev-1'), analysis);
assert.equal(reusableMaterialScriptAnalysis(analysis, 'rev-2'), null);

const legacyBoundary = buildMaterialScriptAnalysis({
  materialId: 'legacy-material', name: '旧分析素材', sourceRevision: 'legacy-rev', duration: 6,
  segments: [{ id: 'legacy', start: 0, end: 6, confidence: .96, action: '打开盒盖', cleanStart: 1, cleanEnd: 5 }],
});
assert.equal(legacyBoundary.shots[0]?.editorial.trim.boundaryConfidence, 0,
  'factual confidence must never be reused as edit-boundary confidence');
assert.equal(legacyBoundary.shots[0]?.editorial.trim.cleanEntry, false);
assert.equal(legacyBoundary.shots[0]?.editorial.trim.cleanExit, false);

const projectedV2 = reusableMaterialScriptAnalysis({
  ...analysis,
  schemaVersion: 'material-script-analysis.v2',
  shots: analysis.shots.map(({ visualContract: _visualContract, materialRoles: _materialRoles, ...shot }) => shot),
  directorIndex: {
    subjects: analysis.directorIndex.subjects,
    actions: analysis.directorIndex.actions,
    environments: analysis.directorIndex.environments,
    shotLanguage: analysis.directorIndex.shotLanguage,
    functions: analysis.directorIndex.functions,
  },
}, 'rev-1');
assert.equal(projectedV2?.schemaVersion, 'material-script-analysis.v3');
assert.ok(projectedV2?.shots[0]?.visualContract);
assert.ok(projectedV2?.shots[0]?.materialRoles.includes('factory'));

console.log('material script analysis tests passed');
