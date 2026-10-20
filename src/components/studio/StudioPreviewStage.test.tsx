import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StudioPreviewStage, { studioPreviewRatio, studioPreviewWidth } from './StudioPreviewStage';

assert.equal(studioPreviewRatio(), 9 / 16);
assert.equal(studioPreviewRatio('9:16'), 9 / 16);
assert.equal(studioPreviewRatio('4 / 5'), 4 / 5);
assert.equal(studioPreviewRatio('16:9'), 16 / 9);
assert.equal(studioPreviewRatio('invalid'), 9 / 16);
assert.equal(studioPreviewRatio('9:0'), 9 / 16);
assert.equal(studioPreviewWidth('9:16'), 'min(100%, 56.25cqh)');

const html = renderToStaticMarkup(
  <StudioPreviewStage ratio="9:16" className="h-full" stageClassName="rounded-lg">
    <video aria-label="视频" />
  </StudioPreviewStage>,
);

assert.ok(html.includes('studio-workbench-preview-shell'));
assert.ok(html.includes('studio-workbench-preview-stage'));
assert.ok(html.includes('data-preview-aspect-ratio="9:16"'));
assert.ok(html.includes('aspect-ratio:0.5625'));
assert.ok(html.includes('width:min(100%, 56.25cqh)'));

console.log('Studio preview stage keeps project ratio inside the available canvas height');
