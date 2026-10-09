import test from 'node:test';
import assert from 'node:assert/strict';
import { asianPresenterLook, presenterLook } from './heygenPresenters.js';

test('preserves explicit HeyGen favorite and demographic metadata', () => {
  const look = presenterLook({
    id: 'asian-favorite-1', name: 'Mei Office', status: 'completed', gender: 'female',
    ethnicity: 'East Asian', is_favorite: true, tags: ['business'], image_width: 1080, image_height: 1920,
  });
  assert.equal(look.favorite, true);
  assert.equal(look.gender, 'female');
  assert.equal(asianPresenterLook(look), true);
});

test('does not infer favorite or Asian category from an unlabelled portrait', () => {
  const look = presenterLook({ id: 'plain-1', name: 'Office Presenter', status: 'completed', image_width: 1080, image_height: 1920 });
  assert.equal(look.favorite, false);
  assert.equal(asianPresenterLook(look), false);
});
