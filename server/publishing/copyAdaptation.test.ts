import assert from 'node:assert/strict';
import {
  groundedCaptionFallback,
  groundedCoverTitleFallbacks,
  normalizePlatformCopies,
  normalizeVerifiedPlatformCopies,
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
assert.ok(firstTikTok.caption!.length <= 120, 'TikTok fallback copy should respect the visible limit');
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

assert.throws(
  () => normalizeVerifiedPlatformCopies({}, ['tiktok']),
  /missing_tiktok_copy/,
  'verified adaptation must not synthesize a local platform fallback',
);
assert.deepEqual(
  normalizeVerifiedPlatformCopies({ tiktok: { caption: 'Model-authored copy.' } }, ['tiktok']),
  { tiktok: { caption: 'Model-authored copy.' } },
);

console.log('publishing copy adaptation tests passed');
