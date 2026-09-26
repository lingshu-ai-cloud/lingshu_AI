import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePublicVideoSource, validatePublicVideoSourceUrl } from './publicVideoSourceSecurity.js';

test('accepts and canonicalizes supported public video pages', () => {
  assert.deepEqual(validatePublicVideoSourceUrl('https://youtu.be/abcDEF_1234?si=tracking'), {
    sourceUrl: 'https://www.youtube.com/watch?v=abcDEF_1234', platform: 'youtube',
  });
  assert.deepEqual(validatePublicVideoSourceUrl('https://www.tiktok.com/@brand/video/1234567890123456789?lang=en', 'tiktok'), {
    sourceUrl: 'https://www.tiktok.com/@brand/video/1234567890123456789', platform: 'tiktok',
  });
  assert.deepEqual(validatePublicVideoSourceUrl('https://www.instagram.com/reel/ABC_def12/?utm_source=x'), {
    sourceUrl: 'https://www.instagram.com/reel/ABC_def12/', platform: 'instagram',
  });
  assert.deepEqual(validatePublicVideoSourceUrl('https://www.facebook.com/watch/?v=123456789'), {
    sourceUrl: 'https://www.facebook.com/watch/?v=123456789', platform: 'facebook',
  });
});

test('rejects SSRF targets, deceptive hosts and non-video platform pages', () => {
  const rejected = [
    'http://127.0.0.1:8790/api/overseas/ready',
    'https://169.254.169.254/latest/meta-data',
    'https://youtube.com.evil.example/watch?v=abcDEF_1234',
    'https://user:pass@www.youtube.com/watch?v=abcDEF_1234',
    'https://www.youtube.com:8443/watch?v=abcDEF_1234',
    'https://www.youtube.com/@brand',
    'https://www.tiktok.com/@brand',
    'https://www.instagram.com/brand/',
    'https://www.facebook.com/watch',
    'https://example.com/video.mp4',
  ];
  for (const value of rejected) assert.equal(validatePublicVideoSourceUrl(value), null, value);
  assert.equal(validatePublicVideoSourceUrl('https://www.youtube.com/watch?v=abcDEF_1234', 'tiktok'), null);
});

test('record-scoped requests cannot replace the tenant-owned source URL', () => {
  const recordSourceUrl = 'https://www.youtube.com/watch?v=abcDEF_1234';
  assert.deepEqual(resolvePublicVideoSource({ recordSourceUrl, recordPlatform: 'youtube' }), {
    sourceUrl: recordSourceUrl, platform: 'youtube',
  });
  assert.deepEqual(resolvePublicVideoSource({
    recordSourceUrl,
    recordPlatform: 'youtube',
    requestedSourceUrl: 'https://youtu.be/abcDEF_1234?si=tracking',
  }), { sourceUrl: recordSourceUrl, platform: 'youtube' });
  assert.equal(resolvePublicVideoSource({
    recordSourceUrl,
    recordPlatform: 'youtube',
    requestedSourceUrl: 'https://www.youtube.com/watch?v=different99',
  }), null);
});
