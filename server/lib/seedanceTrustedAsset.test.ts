import assert from 'node:assert/strict';
import test from 'node:test';
import { seedanceImageFirstFrameInput, seedanceTrustedAssetForMaterial } from './seedanceTrustedAsset.js';

test('reads only Active Volcengine image/video trusted-asset contracts from an owned material', () => {
  const image = seedanceTrustedAssetForMaterial({ type: 'image', seedanceTrustedAsset: { uri: 'asset://asset-image-123', kind: 'image', status: 'active', provider: 'volcengine_ark' } });
  assert.deepEqual(image, { uri: 'asset://asset-image-123', kind: 'image', status: 'active', provider: 'volcengine_ark' });
  assert.deepEqual(seedanceImageFirstFrameInput(image!), { url: 'asset://asset-image-123', kind: 'image' });
  const video = seedanceTrustedAssetForMaterial({ type: 'video', seedanceTrustedAssetUri: 'asset://asset-video-123', seedanceTrustedAssetKind: 'video', seedanceTrustedAssetStatus: 'active', seedanceTrustedAssetProvider: 'volcengine_ark' });
  assert.equal(video?.kind, 'video');
  assert.throws(() => seedanceImageFirstFrameInput(video!), /视频型可信资产/);
  assert.equal(seedanceTrustedAssetForMaterial({ type: 'image', seedanceTrustedAsset: { uri: 'asset://asset-image-123', kind: 'image', status: 'pending', provider: 'volcengine_ark' } }), undefined);
  assert.equal(seedanceTrustedAssetForMaterial({ type: 'image', seedanceTrustedAsset: { uri: 'asset://asset-image-123', kind: 'image', status: 'active', provider: 'other' } }), undefined);
  assert.equal(seedanceTrustedAssetForMaterial({ type: 'video', seedanceTrustedAsset: { uri: 'asset://asset-image-123', kind: 'image', status: 'active', provider: 'volcengine_ark' } }), undefined);
});
