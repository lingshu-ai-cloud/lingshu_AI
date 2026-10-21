import assert from 'node:assert/strict';
import test from 'node:test';
import { materialLocalFile, mimeFromFile, normalizePosterBrief } from './studioPosterHelpers.js';

test('poster normalization keeps only bounded supplied fields', () => {
  const normalized = normalizePosterBrief({ headline: 'A'.repeat(140), subheadline: 'B',
    categories: [{ name: 'Product', description: 'Description' }], trustBadges: ['Verified'], invented: 'discard' });
  assert.equal(normalized.headline.length, 120);
  assert.equal(normalized.subheadline, 'B');
  assert.deepEqual(normalized.categories, [{ name: 'Product', description: 'Description' }]);
  assert.equal('invented' in normalized, false);
});

test('poster reference file helper preserves existing local path and MIME rules', () => {
  assert.equal(materialLocalFile({ type: 'image', file: 'tenants/a/photo.jpg' }, '/media', '/generated'), '/media/tenants/a/photo.jpg');
  assert.equal(materialLocalFile({ type: 'video', poster: '/media/tenants/a/poster.webp?sig=1' }, '/media', '/generated'), '/media/tenants/a/poster.webp');
  assert.equal(materialLocalFile({ type: 'image' }, '/media', '/generated'), null);
  assert.equal(mimeFromFile('poster.webp'), 'image/webp');
  assert.equal(mimeFromFile('poster.gif'), 'image/gif');
});
