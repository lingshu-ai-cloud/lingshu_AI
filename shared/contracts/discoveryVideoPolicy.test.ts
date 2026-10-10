import assert from 'node:assert/strict';
import {
  DISCOVERY_VIDEO_MAX_DURATION_SECONDS,
  isDiscoveryVideoEligible,
  isKnownDiscoveryVideoDuration,
  isYouTubeShortUrl,
  youtubeShortUrl,
} from './discoveryVideoPolicy.js';

assert.equal(DISCOVERY_VIDEO_MAX_DURATION_SECONDS, 60);
assert.equal(isKnownDiscoveryVideoDuration(60), true);
assert.equal(isKnownDiscoveryVideoDuration(60.01), false);
assert.equal(isKnownDiscoveryVideoDuration(0), false);
assert.equal(isDiscoveryVideoEligible({ platform: 'tiktok', duration: 59 }), true);
assert.equal(isDiscoveryVideoEligible({ platform: 'tiktok', duration: 61 }), false);
assert.equal(isDiscoveryVideoEligible({ platform: 'youtube', duration: 30, sourceUrl: 'https://www.youtube.com/watch?v=abc' }), false);
assert.equal(isDiscoveryVideoEligible({ platform: 'youtube', duration: 30, sourceUrl: 'https://www.youtube.com/shorts/abc' }), true);
assert.equal(isDiscoveryVideoEligible({ platform: 'youtube', duration: 30, sourceUrl: 'https://www.youtube.com/watch?v=abc', youtubeShort: true }), true);
assert.equal(isYouTubeShortUrl('https://youtube.com/shorts/abc?feature=share'), true);
assert.equal(youtubeShortUrl('https://www.youtube.com/watch?v=abcdefghijk'), 'https://www.youtube.com/shorts/abcdefghijk');

console.log('Discovery video duration and YouTube Shorts policy tests passed');
