import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceVideoProductionGraph,
  assertVideoProductionGraph,
  createVideoProductionGraph,
  productionNodeForRuntimeStage,
} from './videoProductionGraph.js';

test('both runtimes project onto one canonical production graph', () => {
  const created = createVideoProductionGraph({ graphId: 'task-1', runtimeOrigin: 'starter198', now: '2026-09-27T00:00:00.000Z' });
  const quality = advanceVideoProductionGraph({
    graph: created,
    graphId: 'task-1',
    runtimeOrigin: 'starter198',
    activeNode: productionNodeForRuntimeStage('starter198', 'quality_check'),
    evidenceRefs: ['artifact:render-1'],
    now: '2026-09-27T00:01:00.000Z',
  });
  assert.equal(quality.activeNode, 'quality');
  assert.equal(quality.nodes.find(node => node.nodeId === 'render')?.status, 'completed');
  assert.equal(quality.nodes.find(node => node.nodeId === 'quality')?.status, 'running');
  assertVideoProductionGraph(quality);
  assert.equal(productionNodeForRuntimeStage('digital_employee', 'material_match'), 'material_match');
});

test('blocked runtime stage remains attached to its resumable canonical node', () => {
  const graph = createVideoProductionGraph({ graphId: 'legacy-1', runtimeOrigin: 'digital_employee' });
  const blocked = advanceVideoProductionGraph({
    graph,
    graphId: 'legacy-1',
    runtimeOrigin: 'digital_employee',
    activeNode: productionNodeForRuntimeStage('digital_employee', 'blocked', 'voice_subtitles'),
    status: 'blocked',
    blocker: 'voice unavailable',
  });
  assert.equal(blocked.activeNode, 'voice');
  assert.equal(blocked.nodes.find(node => node.nodeId === 'voice')?.blocker, 'voice unavailable');
});

test('retrying an earlier node invalidates stale downstream completion', () => {
  const initial = createVideoProductionGraph({ graphId: 'retry-1', runtimeOrigin: 'digital_employee' });
  const rendered = advanceVideoProductionGraph({ graph: initial, graphId: 'retry-1', runtimeOrigin: 'digital_employee', activeNode: 'render' });
  const rematch = advanceVideoProductionGraph({ graph: rendered, graphId: 'retry-1', runtimeOrigin: 'digital_employee', activeNode: 'material_match' });
  assert.equal(rematch.nodes.find(node => node.nodeId === 'render')?.status, 'pending');
  assert.equal(rematch.nodes.find(node => node.nodeId === 'material_match')?.status, 'running');
});
