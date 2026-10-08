import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPipeline3MeasuredDuration,
  createPipeline3SemanticTimeline,
  planPipeline3Build,
  type Pipeline3BuildNode,
  type Pipeline3NodeCandidate,
} from './pipeline3SemanticTimeline.js';

test('generated A-roll duration replaces reference duration and reflows later semantic anchors', () => {
  const timeline = createPipeline3SemanticTimeline([
    { id: 'hook', start: 10, end: 15.6, originalText: 'old hook', targetText: 'new hook', shotIds: ['17'] },
    { id: 'proof', start: 15.6, end: 19.1, originalText: 'old proof', targetText: 'new proof', shotIds: ['18'] },
  ]);
  const result = applyPipeline3MeasuredDuration(timeline, 'hook', 'seedance-video-1', 4.2);
  assert.deepEqual(result.map(anchor => [anchor.id, anchor.start, anchor.end]), [
    ['hook', 10, 14.2],
    ['proof', 14.2, 17.7],
  ]);
  assert.equal(result[0]?.sourceEnd, 15.6, 'reference evidence remains unchanged');
  assert.equal(result[0]?.generatedMaterialId, 'seedance-video-1');
  assert.equal(result[0]?.measuredDuration, 4.2);
});

test('multiple measured durations remain stable when a later result arrives', () => {
  let timeline = createPipeline3SemanticTimeline([
    { id: 'a', start: 0, end: 5, originalText: 'a', targetText: 'a', shotIds: ['a'] },
    { id: 'b', start: 5, end: 10, originalText: 'b', targetText: 'b', shotIds: ['b'] },
    { id: 'c', start: 10, end: 12, originalText: 'c', targetText: 'c', shotIds: ['c'], personShot: false },
  ]);
  timeline = applyPipeline3MeasuredDuration(timeline, 'a', 'video-a', 4.2);
  timeline = applyPipeline3MeasuredDuration(timeline, 'b', 'video-b', 6.125);
  assert.deepEqual(timeline.map(anchor => [anchor.start, anchor.end]), [[0, 4.2], [4.2, 10.325], [10.325, 12.325]]);
});

test('build plan reuses unchanged Seedream and Seedance artifacts', () => {
  const nodes: Pipeline3BuildNode[] = [
    { id: 'frame', anchorId: 'hook', kind: 'seedream_first_frame', inputFingerprint: 'portrait+composition-v1' },
    { id: 'aroll', anchorId: 'hook', kind: 'seedance_a_roll', inputFingerprint: 'speech+motion-v1', dependsOn: ['frame'] },
  ];
  const candidates: Pipeline3NodeCandidate[] = [
    { id: 'frame-c1', nodeId: 'frame', materialId: 'image-1', inputFingerprint: 'portrait+composition-v1', state: 'ready', createdAt: '2026-10-08T01:00:00Z' },
    { id: 'video-c1', nodeId: 'aroll', materialId: 'video-1', inputFingerprint: 'speech+motion-v1', dependencyCandidates: { frame: 'frame-c1' }, state: 'ready', measuredDuration: 4.2, createdAt: '2026-10-08T01:01:00Z' },
  ];
  assert.deepEqual(planPipeline3Build(nodes, candidates).map(item => [item.nodeId, item.action, item.candidateId]), [
    ['frame', 'reuse', 'frame-c1'],
    ['aroll', 'reuse', 'video-c1'],
  ]);
});

test('changing a first-frame input invalidates only it and its dependent A-roll', () => {
  const nodes: Pipeline3BuildNode[] = [
    { id: 'frame', anchorId: 'hook', kind: 'seedream_first_frame', inputFingerprint: 'new-presenter' },
    { id: 'aroll', anchorId: 'hook', kind: 'seedance_a_roll', inputFingerprint: 'same-speech', dependsOn: ['frame'] },
    { id: 'caption', anchorId: 'hook', kind: 'caption', inputFingerprint: 'same-caption' },
  ];
  const candidates: Pipeline3NodeCandidate[] = [
    { id: 'old-frame', nodeId: 'frame', materialId: 'image', inputFingerprint: 'old-presenter', state: 'ready', createdAt: '2026-10-08T01:00:00Z' },
    { id: 'old-video', nodeId: 'aroll', materialId: 'video', inputFingerprint: 'same-speech', dependencyCandidates: { frame: 'old-frame' }, state: 'ready', createdAt: '2026-10-08T01:01:00Z' },
    { id: 'caption-c1', nodeId: 'caption', materialId: 'caption-json', inputFingerprint: 'same-caption', state: 'ready', createdAt: '2026-10-08T01:02:00Z' },
  ];
  assert.deepEqual(planPipeline3Build(nodes, candidates).map(item => [item.nodeId, item.action, item.reason]), [
    ['frame', 'generate', 'input_changed'],
    ['aroll', 'generate', 'dependency_changed'],
    ['caption', 'reuse', 'matching_candidate'],
  ]);
});

test('timeline rejects invalid provider duration and build graph rejects cycles', () => {
  const timeline = createPipeline3SemanticTimeline([{ id: 'a', start: 0, end: 4, originalText: '', targetText: '', shotIds: [] }]);
  assert.throws(() => applyPipeline3MeasuredDuration(timeline, 'a', 'video', 0), /必须大于 0/);
  assert.throws(() => planPipeline3Build([
    { id: 'a', anchorId: 'a', kind: 'seedream_first_frame', inputFingerprint: 'a', dependsOn: ['b'] },
    { id: 'b', anchorId: 'a', kind: 'seedance_a_roll', inputFingerprint: 'b', dependsOn: ['a'] },
  ], []), /循环依赖/);
});
