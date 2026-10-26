import assert from 'node:assert/strict';
import test from 'node:test';
import { collectedImageReferences } from './imageReplicationReferences';

const collected = { id: 'post-1', title: 'Collected carousel', platform: 'instagram', sourceUrl: 'https://www.instagram.com/p/ABC/',
  crawledAt: '2026-10-26T00:00:00Z', aiAnalysis: JSON.stringify({ contentFormat: 'image', source: 'apify-image', caption: 'Original caption',
    imageUrls: ['/api/overseas/videos/post-1/image/0', '/api/overseas/videos/post-1/image/1'] }) };

test('collected references preserve original post identity and caption without declaring owned product assets', () => {
  assert.deepEqual(collectedImageReferences([collected]), [{ url: '/api/overseas/videos/post-1/image/0', title: collected.title,
    sourceRecordId: collected.id, sourceUrl: collected.sourceUrl, platform: 'instagram', caption: 'Original caption', collectedAt: collected.crawledAt }]);
});

test('generated assets, missing provenance, malformed records and unpersisted images never become benchmark candidates', () => {
  const analysis = JSON.parse(collected.aiAnalysis);
  const invalid = [
    { id: 'frame-1', name: 'Generated first frame', type: 'image', scope: 'own', url: '/media/frame.png' },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, source: 'digital-human-target-first-frame' }) },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, source: undefined }) },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, contentFormat: 'video' }) },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, imageUrls: ['https://cdn.test/photo.jpg'] }) },
    { ...collected, sourceUrl: 'https://instagram.com.evil.test/p/ABC/' },
    { ...collected, sourceUrl: 'file:///tmp/generated.png' },
    { ...collected, aiAnalysis: 'invalid-json' }, null,
  ];
  assert.deepEqual(collectedImageReferences(invalid), []);
});
