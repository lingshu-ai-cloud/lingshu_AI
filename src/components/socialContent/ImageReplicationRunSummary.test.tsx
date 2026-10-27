import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import ImageReplicationRunSummary from './ImageReplicationRunSummary';

test('completed image summary displays the image and caption without duplicate navigation actions', () => {
  const task = { status: 'review_required', imageType: 'product_poster', outputs: [
    { id: 'candidate', role: 'single', version: 1, state: 'repair_required', mediaUrl: '/candidate.png' },
  ] } as SocialImageCreationTask;
  const html = renderToStaticMarkup(<ImageReplicationRunSummary task={task} busy={false} error="" notice=""
    imageUrl="/candidate.png" caption="Product caption"/>);
  assert.match(html, /图文首版待审阅/);
  assert.match(html, /Product caption/);
  assert.doesNotMatch(html, /我的创作|审阅图片与配文/);
});
