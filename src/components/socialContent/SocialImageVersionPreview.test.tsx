import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import SocialImageVersionPreview from './SocialImageVersionPreview';

test('image review shows version arrows only when more than one saved version exists', () => {
  const task = { imageType: 'product_poster', outputs: [
    { id: 'first', role: 'single', version: 1, state: 'superseded', mediaUrl: '/first.png' },
    { id: 'second', role: 'single', version: 2, state: 'repair_required', mediaUrl: '/second.png' },
  ] } as SocialImageCreationTask;
  const render = () => renderToStaticMarkup(<SocialImageVersionPreview task={task} fallbackUrl="" className="h-80" alt="成片"/>);
  assert.match(render(), /aria-label="上一版本"/);
  assert.match(render(), /aria-label="下一版本"/);
  assert.match(render(), /2 \/ 2/);
  task.outputs = task.outputs.slice(1);
  assert.doesNotMatch(render(), /aria-label="上一版本"/);
});
