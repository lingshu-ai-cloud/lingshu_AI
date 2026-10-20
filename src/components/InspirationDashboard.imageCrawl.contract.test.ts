import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8');

test('viral library exposes image crawling and returns successful runs to the image masonry', () => {
  assert.match(source, /<Button icon=\{<Images size=\{15\} \/>\} onClick=\{openImageCrawl\}>采集图片<\/Button>/);
  assert.match(source, /title="采集图片内容"/);
  assert.match(source, /crawlInspirationImages\(\{/);
  assert.match(source, /setContentFormat\('image'\)/);
  assert.match(source, /refreshVideos\(1, false, \{\s*contentFormat: 'image'/);
  assert.match(source, /<LsMasonryGallery layout="masonry" items=\{filtered\.map/);
});
