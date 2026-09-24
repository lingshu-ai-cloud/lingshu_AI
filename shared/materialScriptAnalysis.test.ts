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
    action: '灌装机连续灌装透明瓶', environment: '工厂产线',
    recommendedFunctions: ['工厂证明'], observedFacts: ['灌装机和透明瓶清晰可见'],
  }],
});

assert.equal(analysis.shots[0]?.role, 'hook');
assert.ok(analysis.hookCapability.score >= 80);
assert.match(analysis.shots[0]?.instruction || '', /前三秒/);
assert.match(analysis.searchableText, /工厂产线/);
assert.match(analysis.truthBoundary, /不会改写客户原片/);
assert.equal(reusableMaterialScriptAnalysis(analysis, 'rev-1'), analysis);
assert.equal(reusableMaterialScriptAnalysis(analysis, 'rev-2'), null);

console.log('material script analysis tests passed');
