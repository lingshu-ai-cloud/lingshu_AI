import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertVideoProductionSupervisorDefinition,
  VIDEO_PRODUCTION_EXPERTS,
  VIDEO_PRODUCTION_GRAPH_V2_PHASES,
  VIDEO_PRODUCTION_GRAPH_V4_PHASES,
  VIDEO_PRODUCTION_SUPERVISOR_NODES,
} from '../../shared/contracts/videoProductionSupervisor.js';

test('Supervisor is a deterministic runtime graph and every production phase has one accountable owner', () => {
  assert.doesNotThrow(assertVideoProductionSupervisorDefinition);
  assert.deepEqual(VIDEO_PRODUCTION_SUPERVISOR_NODES.map(node => node.phase), VIDEO_PRODUCTION_GRAPH_V4_PHASES);
  assert.deepEqual(VIDEO_PRODUCTION_GRAPH_V2_PHASES, [
    'assets', 'voice', 'trim', 'effects', 'render', 'technical_quality', 'creative_quality', 'delivery',
  ], 'the prior topology remains an immutable compatibility contract');
  assert.equal(VIDEO_PRODUCTION_SUPERVISOR_NODES.some(node => String(node.owner).includes('orchestrator')), false);
  assert.equal(VIDEO_PRODUCTION_SUPERVISOR_NODES.filter(node => node.owner === 'creative_quality_expert').length, 1);
});

test('expert definitions keep judgment and RAG explicit while forbidding self approval and supplier work', () => {
  assert.deepEqual(Object.keys(VIDEO_PRODUCTION_EXPERTS).sort(), [
    'business_strategy_expert', 'creative_quality_expert', 'director_expert', 'production_planner_expert',
  ]);
  for (const expert of Object.values(VIDEO_PRODUCTION_EXPERTS)) {
    assert.ok(expert.instructions.length >= 4);
    assert.ok(expert.inputContract.length >= 4);
    assert.ok(expert.outputContract.length >= 4);
    assert.ok(expert.knowledgeNamespaces.every(namespace => namespace.startsWith('rag.')));
    assert.ok(expert.forbiddenActions.some(action => action.includes('approval') || action === 'publish'));
  }
});
