import assert from 'node:assert/strict';
import {
  isSocialArtifactMediaSourceEligible,
  prepareSocialArtifactMedia,
} from './socialContentArtifactMedia.js';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  },
});

const video = new Blob([new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70])], { type: 'video/mp4' });
assert.equal(isSocialArtifactMediaSourceEligible({ source: video, contentMode: 'video' }), true);
assert.equal(isSocialArtifactMediaSourceEligible({ source: video, contentMode: 'poster' }), false);
assert.equal(isSocialArtifactMediaSourceEligible({ source: null, contentMode: 'video' }), false);
assert.equal(isSocialArtifactMediaSourceEligible({
  source: '/api/overseas/publishing/local-videos/final.mp4?assetToken=signed',
  contentMode: 'video',
  origin: 'http://localhost:5177',
}), true);
assert.equal(isSocialArtifactMediaSourceEligible({
  source: '/api/overseas/studio/private-assets/materials/final.png?assetToken=signed',
  contentMode: 'poster',
  origin: 'http://localhost:5177',
}), true);
assert.equal(isSocialArtifactMediaSourceEligible({
  source: 'file:///Users/person/output.mp4',
  contentMode: 'video',
  origin: 'http://localhost:5177',
}), false, 'a desktop output path is not a browser-readable artifact');
assert.equal(isSocialArtifactMediaSourceEligible({
  source: 'https://cdn.example.com/output.mp4',
  contentMode: 'video',
  origin: 'http://localhost:5177',
}), false, 'cross-origin output must not enable confirmation');
const direct = await prepareSocialArtifactMedia({ source: video, contentMode: 'video' });
assert.equal(direct.name, 'social-video.mp4');
assert.equal(direct.mimeType, 'video/mp4');
assert.match(direct.sha256, /^[a-f0-9]{64}$/);

let requested = '';
const fromStudio = await prepareSocialArtifactMedia({
  source: '/api/overseas/publishing/local-videos/final.mp4?assetToken=signed',
  contentMode: 'video',
  origin: 'http://localhost:5177',
  request: async (input, init) => {
    requested = String(input);
    assert.equal(init?.credentials, 'same-origin');
    return new Response(video, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.size) } });
  },
});
assert.match(requested, /^http:\/\/localhost:5177\/api\/overseas\/publishing\/local-videos\/final\.mp4/);
assert.equal(fromStudio.name, 'final.mp4');

const image = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
const fromPosterStudio = await prepareSocialArtifactMedia({
  source: '/api/overseas/studio/private-assets/materials/final.png?assetToken=signed',
  contentMode: 'poster',
  origin: 'http://localhost:5177',
  request: async () => new Response(image, { status: 200, headers: { 'Content-Type': 'image/png' } }),
});
assert.equal(fromPosterStudio.name, 'final.png');

await assert.rejects(
  () => prepareSocialArtifactMedia({ source: 'file:///Users/person/output.mp4', contentMode: 'video', origin: 'http://localhost:5177' }),
  /无法安全读取/,
);
await assert.rejects(
  () => prepareSocialArtifactMedia({ source: 'https://cdn.example.com/output.mp4', contentMode: 'video', origin: 'http://localhost:5177' }),
  /当前工作区/,
);
await assert.rejects(
  () => prepareSocialArtifactMedia({ source: 'blob:https://evil.example/id', contentMode: 'video', origin: 'http://localhost:5177' }),
  /当前工作区/,
);
await assert.rejects(
  () => prepareSocialArtifactMedia({ source: new Blob(['image'], { type: 'image/png' }), contentMode: 'video' }),
  /视频格式/,
);

console.log('social content artifact media tests passed');
