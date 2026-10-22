import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudioRenderManifest } from './studioRenderManifestProjection.js';

test('render manifest prefers per-shot URLs and keeps tenant-scoped source lookup explicit', () => {
  const manifest = buildStudioRenderManifest({
    jobId: 'job-a', base: 'https://studio.example.test',
    materialUrlByName: new Map([['library', '/media/library.mp4'], ['direct', '/media/old.mp4']]),
    bgmUrl: '/bgm/track.mp3',
    spec: { bgm: 'track', voiceoverUrl: '/tts/voice.wav', coverUrl: '/covers/cover.svg',
      timeline: [{ name: 'library', targetDuration: 4 }, { name: 'direct', url: '/media/new.mp4' }] },
  });
  assert.equal(manifest.requireVisualAssets, true);
  assert.deepEqual(manifest.timeline.map(item => item.url),
    ['https://studio.example.test/media/library.mp4', 'https://studio.example.test/media/new.mp4']);
  assert.deepEqual(manifest.bgm, { id: 'track', url: 'https://studio.example.test/bgm/track.mp3' });
  assert.equal(manifest.voiceover.url, 'https://studio.example.test/tts/voice.wav');
  assert.equal(manifest.cover.url, 'https://studio.example.test/covers/cover.svg');
  assert.equal(manifest.spec.duration, 20);
});

test('render manifest preserves legacy material fallback and disabled subtitles', () => {
  const manifest = buildStudioRenderManifest({ jobId: 'job-b', base: 'https://studio.example.test',
    materialUrlByName: new Map([['legacy', 'https://cdn.example.test/legacy.mp4']]), bgmUrl: null,
    spec: { materials: ['legacy', 'missing'], duration: 12,
      subtitles: { mode: 'off', cues: [], style: {} } },
  });
  assert.deepEqual(manifest.timeline.map(item => item.url), ['https://cdn.example.test/legacy.mp4', null]);
  assert.equal(manifest.spec.duration, 12);
  assert.equal(manifest.subtitles, undefined);
  assert.deepEqual(manifest.bgm, { id: null, url: null });
});
