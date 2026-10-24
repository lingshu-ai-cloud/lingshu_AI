import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { normalizedReferenceText, parseInspirationReferenceTarget, videoMatchesReference } from './inspirationReferenceTarget';

const video = { id: 'crawl-record-1', recordId: 'record-1', platform: 'youtube',
  title: 'Factory Product Review', sourceUrl: 'https://www.youtube.com/watch?v=sample',
  thumbnail: '', duration: 15, tags: [], views: '0', trend: 'stable', contentFormat: 'video' } as TrendVideo;

test('weekly reference target is parsed from navigation detail and matched to the original record', () => {
  const target = parseInspirationReferenceTarget({ businessRef: { referenceId: 'crawl-record-1' },
    inspirationReference: { sourceUrl: 'https://youtube.com/watch?v=sample', title: 'Factory Product Review' } });
  assert.ok(target);
  assert.equal(target.referenceId, 'crawl-record-1');
  assert.equal(videoMatchesReference(video, target), true);
  assert.equal(videoMatchesReference({ ...video, id: 'unrelated', recordId: 'unrelated',
    sourceUrl: 'https://other.example.test/video', title: 'Different subject' }, target), false);
});

test('invalid or exact-review navigation does not become fuzzy inspiration matching', () => {
  assert.equal(parseInspirationReferenceTarget(null), null);
  assert.equal(parseInspirationReferenceTarget({ inspirationReference: {} }), null);
  assert.equal(normalizedReferenceText('  FACTORY, Product!  '), 'factory product');
});

test('home replication intent is explicit and is not inferred from an ordinary reference', () => {
  const reference = { referenceId: 'record-1', sourceUrl: video.sourceUrl, title: video.title };
  assert.equal(parseInspirationReferenceTarget({ inspirationReference: reference })?.startViralReplication, false);
  assert.equal(parseInspirationReferenceTarget({ startViralReplication: true, inspirationReference: reference })?.startViralReplication, true);
  assert.equal(parseInspirationReferenceTarget({ startViralReplication: 'true', inspirationReference: reference })?.startViralReplication, false);
});
