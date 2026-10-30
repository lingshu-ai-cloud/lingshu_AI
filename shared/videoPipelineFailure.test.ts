import assert from 'node:assert/strict';
import test from 'node:test';
import { videoPipelineFailure } from './videoPipelineFailure.js';

test('failures distinguish collection, media, admission and analysis without exposing provider payloads', () => {
  const cases = [
    ['COS video not found', 'media_missing', false],
    ['403 platform-feature-disabled Monthly usage hard limit exceeded', 'collection_quota', false],
    ['400 DataInspectionFailed input image inappropriate', 'content_rejected', false],
    ['image_post_queue_persistence_failed', 'queue_admission', true],
    ['Qwen request timed out', 'timeout', true],
    ['yt-dlp unable to download webpage', 'source_unavailable', true],
    ['unexpected provider response', 'analysis_failed', true],
  ] as const;
  for (const [raw, code, retryable] of cases) {
    const result = videoPipelineFailure(`${raw} private-token-do-not-expose`);
    assert.equal(result.code, code);
    assert.equal(result.retryable, retryable);
    assert.doesNotMatch(JSON.stringify(result), /private-token/);
    assert.ok(result.message && result.action);
  }
  assert.equal(videoPipelineFailure('').code, 'none');
});
