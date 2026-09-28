import assert from 'node:assert/strict';
import { localReferenceMediaUrl } from './studioReferenceMedia.js';

assert.equal(localReferenceMediaUrl('local://tiktok_7648939405557697806'), '/api/overseas/videos/tiktok_7648939405557697806/media-url');
assert.equal(localReferenceMediaUrl('local://record:2'), '/api/overseas/videos/record%3A2/media-url');
assert.equal(localReferenceMediaUrl('https://example.com/video'), '');
assert.equal(localReferenceMediaUrl('local://../private/file'), '');
assert.equal(localReferenceMediaUrl('local://record?token=x'), '');

console.log('studio reference media tests passed');
