import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSocialImageFirstDraftPrompt, socialImageUnitPoster } from './socialImageFirstDraft.js';

test('server first-draft contract locks benchmark structure and protects packaging anchors', () => {
  const prompt = buildSocialImageFirstDraftPrompt({
    imagePrompt: 'Use a verified product launch story.',
    poster: { headline: 'Launch update', cta: '' },
    ratio: '4:5', imageType: 'brand_news', hasBenchmark: true, ownedReferenceCount: 2,
  });
  assert.match(prompt, /locked structural blueprint/);
  assert.match(prompt, /normalized bounding boxes, z-order, relative scale/);
  assert.match(prompt, /open sky or another quiet upper-right area/);
  assert.match(prompt, /complete cap or top closure, brand name, core label/);
  assert.match(prompt, /tenant-owned enterprise assets/);
  assert.match(prompt, /"headline": "Launch update"/);
});

test('first draft without owned assets may not invent or borrow identity', () => {
  const prompt = buildSocialImageFirstDraftPrompt({
    imagePrompt: 'Neutral product context.', poster: { headline: 'Overview' }, ratio: '1:1',
    hasBenchmark: false, ownedReferenceCount: 0,
  });
  assert.doesNotMatch(prompt, /locked structural blueprint/);
  assert.match(prompt, /Keep product and logo regions empty/);
  assert.match(prompt, /sole authority for visible wording/);
});

test('carousel units have stable cover, value, proof, and conversion roles', () => {
  const poster = { headline: 'Hero', subheadline: 'Support', sellingPoints: ['Value one', 'Value two'], trustBadges: ['Proof one'], process: ['Step one'], cta: 'Contact us', bottomBar: ['MOQ confirmed'] };
  assert.equal(socialImageUnitPoster(poster, 'carousel', 0, 4).pageRole, 'cover');
  assert.deepEqual(socialImageUnitPoster(poster, 'carousel', 1, 4), { ...poster, pageRole: 'value', headline: 'Value one', subheadline: 'Value two', carouselPage: 2, carouselPageCount: 4 });
  assert.equal(socialImageUnitPoster(poster, 'carousel', 2, 4).pageRole, 'proof');
  assert.equal(socialImageUnitPoster(poster, 'carousel', 3, 4).pageRole, 'conversion');
});

test('GIF with owned products requests a background-only plate for fixed composition', () => {
  const prompt = buildSocialImageFirstDraftPrompt({ imagePrompt: 'test', poster: { headline: 'Title' }, ratio: '4:5', imageType: 'gif_poster', hasBenchmark: true, ownedReferenceCount: 1, fixedIdentityComposition: true });
  assert.match(prompt, /GIF BACKGROUND PLATE ONLY/);
  assert.match(prompt, /composited deterministically/);
});
