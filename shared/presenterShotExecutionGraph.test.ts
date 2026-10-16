import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePresenterShotExecutionGraph } from './presenterShotExecutionGraph.js';

const ready = { presenter: true, voice: true, background: true, performanceReference: true, brandContact: true };

test('static shelf presenter compiles independent voice, identity and background branches before render', () => {
  const graph = compilePresenterShotExecutionGraph({ shotId: 'S1', archetypeId: 'P1C_SHELF_STAND_TALK', pipeline: 'pipeline_1_heygen', readiness: ready });
  assert.deepEqual(graph.blockers, []);
  assert.deepEqual(graph.operations.find(item => item.role === 'target_first_frame')?.dependsOn, ['S1:identity', 'S1:background']);
  assert.deepEqual(graph.operations.find(item => item.role === 'talking_video')?.dependsOn, ['S1:voice', 'S1:first-frame']);
});

test('dynamic presenter route requires an authorized performance reference and does not silently switch pipeline', () => {
  const graph = compilePresenterShotExecutionGraph({ shotId: 'S2', archetypeId: 'P1D_SHELF_ACTION_TALK', pipeline: 'pipeline_1_heygen',
    readiness: { ...ready, performanceReference: false } });
  assert.deepEqual(graph.blockers, ['pipeline_not_supported', 'performance_reference_missing']);
  assert.equal(graph.pipeline, 'pipeline_1_heygen');
  assert.equal(graph.operations.some(item => item.role === 'performance_motion'), true);
});

test('CTA overlay is a parallel local branch and cannot be inferred by the video provider', () => {
  const graph = compilePresenterShotExecutionGraph({ shotId: 'S3', archetypeId: 'P1E_PRESENTER_CTA', pipeline: 'pipeline_3_reconstructed_frames',
    readiness: { ...ready, brandContact: false } });
  assert.deepEqual(graph.blockers, ['brand_contact_missing']);
  const overlay = graph.operations.find(item => item.role === 'brand_contact_overlay');
  assert.equal(overlay?.executor, 'local_brand_overlay');
  assert.deepEqual(graph.operations.find(item => item.role === 'layer_composite')?.dependsOn, ['S3:talking-video', 'S3:brand-contact']);
});
