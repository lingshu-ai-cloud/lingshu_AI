import assert from 'node:assert/strict';
import {
  PUBLISH_COPY_LIMITS,
  composePlatformBody,
  groundedCaptionFallback,
  groundedCoverTitleFallbacks,
  normalizePlatformCopies,
  platformCopyFallback,
  sanitizePublishCopyPlatforms,
} from './copyAdaptation.js';

const title = 'Precision assembly line review';
const description = 'See how the visible assembly sequence keeps each station aligned.';

assert.deepEqual(
  sanitizePublishCopyPlatforms(['youtube', 'invalid', 'tiktok', 'youtube']),
  ['youtube', 'tiktok'],
  'only supported, unique platforms should reach copy generation',
);

const firstTikTok = platformCopyFallback('tiktok', title, description, 0);
assert.ok(firstTikTok.caption);
assert.ok(Array.from(firstTikTok.caption!).length <= PUBLISH_COPY_LIMITS.tiktok.body, 'TikTok fallback copy should respect the provider limit');
assert.doesNotMatch(
  JSON.stringify(firstTikTok),
  /MOQ|catalog|wholesale|factory|export|customization/i,
  'fallback copy must not invent unsupported commercial facts',
);

const groundedScript = `[0-4s]\nVoiceover: Check the alignment at each visible station.\n[4-8s]\nVoiceover: Send us the tolerance you need to verify.`;
const groundedCaption = groundedCaptionFallback(groundedScript, 'Industrial assembly equipment');
assert.match(groundedCaption.caption, /alignment at each visible station/i);
assert.match(groundedCaption.caption, /tolerance you need to verify/i);
assert.doesNotMatch(groundedCaption.caption, /home|shipping|24h/i);
const groundedCovers = groundedCoverTitleFallbacks(groundedScript, 'Industrial assembly equipment', 'en');
assert.equal(groundedCovers.length, 3);
assert.match(groundedCovers[0], /Check the alignment/i);
assert.ok(groundedCovers.every(item => item.split(/\s+/).length <= 6), 'English fallback covers stay within six words');

const regeneratedTikTok = normalizePlatformCopies(
  { tiktok: firstTikTok },
  ['tiktok'],
  title,
  description,
  { currentCopy: { tiktok: firstTikTok }, requireAlternative: true },
);
assert.notEqual(
  regeneratedTikTok.tiktok.caption,
  firstTikTok.caption,
  'regeneration should still change the visible copy when the model repeats the current version',
);

const instagramOnly = normalizePlatformCopies(
  { instagram: { caption: 'A new Instagram version.', hashtags: ['#b2b', '#b2b', '', '#factory'] } },
  ['instagram'],
  title,
  description,
);
assert.deepEqual(Object.keys(instagramOnly), ['instagram']);
assert.deepEqual(instagramOnly.instagram.hashtags, ['#b2b', '#factory']);
assert.match(instagramOnly.instagram.caption || '', /#b2b #factory/, 'generated Instagram hashtags must be merged into the returned publish body');

const overlong = normalizePlatformCopies({
  youtube: {
    title: '🚀'.repeat(140),
    description: '产'.repeat(2_000),
    tags: Array.from({ length: 40 }, (_, index) => `long search tag ${index}`),
    firstComment: 'x'.repeat(12_000),
  },
  tiktok: {
    caption: '✨'.repeat(2_500),
    hashtags: ['#factory', '#automation', '#b2b'],
    firstComment: 'This endpoint is unsupported.',
  },
}, ['youtube', 'tiktok'], title, description);
assert.ok(Array.from(overlong.youtube.title || '').length <= PUBLISH_COPY_LIMITS.youtube.title);
assert.ok(Buffer.byteLength(overlong.youtube.description || '', 'utf8') <= PUBLISH_COPY_LIMITS.youtube.body);
assert.ok(Array.from(overlong.youtube.firstComment || '').length <= PUBLISH_COPY_LIMITS.youtube.firstComment);
assert.ok((overlong.youtube.tags || []).join(',').length <= PUBLISH_COPY_LIMITS.youtube.tagCharacters);
assert.ok(Array.from(overlong.tiktok.caption || '').length <= PUBLISH_COPY_LIMITS.tiktok.body);
assert.equal(overlong.tiktok.firstComment, '', 'TikTok generation must not promise a first-comment API that does not exist');
assert.match(overlong.tiktok.caption || '', /#factory/, 'TikTok hashtags must survive normalization inside the final caption');

const finalTikTokPayload = composePlatformBody(
  'tiktok',
  'A concise buyer-facing caption.',
  ['#factory', '#automation'],
  ['WhatsApp inquiry: https://wa.me/123?text=V1000'],
);
assert.match(finalTikTokPayload.text, /#factory #automation/);
assert.match(finalTikTokPayload.text, /WhatsApp inquiry:/);
assert.ok(Array.from(finalTikTokPayload.text).length <= PUBLISH_COPY_LIMITS.tiktok.body);

const ungroundedModelCopy = normalizePlatformCopies({
  facebook: {
    text: 'Premium quality with no middlemen, no markups, fairly priced, and shipped with care. These are flying off shelves.',
    hashtags: ['#factorydirect'],
    firstComment: 'Get the best price today.',
  },
}, ['facebook'], 'Factory-direct home essentials', 'See the items shown in this video.');
assert.doesNotMatch(
  JSON.stringify(ungroundedModelCopy.facebook),
  /premium quality|no middlemen|no markups|fairly priced|shipped with care|flying off|best price/i,
  'unsupported model claims must be rejected before the generated result reaches the editor',
);
assert.match(ungroundedModelCopy.facebook.text || '', /See the items shown in this video/i);

console.log('publishing copy adaptation tests passed');
