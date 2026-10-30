import assert from 'node:assert/strict';
import test from 'node:test';
import { imagePostAdmission } from './imagePostAdmission.js';
import type { CrawledImagePost } from './imagePostEvidenceAnalysis.js';

const item: CrawledImagePost = { platform: 'instagram', sourceUrl: 'https://example.test/p/1',
  title: 'image', thumbnailUrl: 'https://expired.test/a.jpg', imageUrls: ['https://expired.test/a.jpg'], caption: '', views: '', tags: [] };
const record = { id: 'a', tenantId: 'tenant-a', sourceUrl: item.sourceUrl, contentFormat: 'image',
  aiAnalysis: JSON.stringify({ imageUrls: ['/api/overseas/videos/a/image/0'] }) };

test('admission binds the persisted tenant image and refuses missing sources or uncertain attempts', () => {
  const receipt = imagePostAdmission(record, item, 'test');
  assert.equal(receipt.imageAnalysisQueueState, 'queued');
  assert.deepEqual((receipt.imageAnalysisQueueInput as { item: CrawledImagePost }).item.imageUrls, ['/api/overseas/videos/a/image/0']);
  assert.throws(() => imagePostAdmission({ ...record, tenantId: '' }, item, 'test'), /source_invalid/);
  assert.throws(() => imagePostAdmission({ ...record, sourceUrl: 'other' }, item, 'test'), /source_invalid/);
  assert.throws(() => imagePostAdmission({ ...record, aiAnalysis: '{}' }, item, 'test'), /source_invalid/);
  for (const state of ['processing', 'unknown']) {
    assert.throws(() => imagePostAdmission({ ...record, aiAnalysis: JSON.stringify({ imageAnalysisQueueState: state }) }, item, 'test'), /requires_reconciliation/);
  }
});
