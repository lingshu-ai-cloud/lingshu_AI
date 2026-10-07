import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')) as any;

function gifMetadata(bytes: Buffer) {
  assert.equal(bytes.subarray(0, 6).toString('ascii'), 'GIF89a');
  let offset = 6;
  const width = bytes.readUInt16LE(offset), height = bytes.readUInt16LE(offset + 2), packed = bytes[offset + 4]!;
  offset += 7;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
  let frameCount = 0, durationMs = 0, transparentFrames = 0, loop: number | null = null;
  let delayCs = 0, transparent = false;
  const skipBlocks = () => { while (offset < bytes.length) { const length = bytes[offset++]!; if (!length) break; offset += length; } };
  while (offset < bytes.length) {
    const marker = bytes[offset++]!;
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[offset++]!;
      if (label === 0xf9) {
        const length = bytes[offset++]!;
        transparent = Boolean(bytes[offset]! & 1);
        delayCs = bytes.readUInt16LE(offset + 1);
        offset += length + 1;
      } else if (label === 0xff) {
        const length = bytes[offset++]!;
        const app = bytes.subarray(offset, offset + length).toString('ascii');
        offset += length;
        if (app.startsWith('NETSCAPE')) {
          const blockLength = bytes[offset++]!;
          if (blockLength >= 3 && bytes[offset] === 1) loop = bytes.readUInt16LE(offset + 1);
          offset += blockLength + 1;
        } else skipBlocks();
      } else skipBlocks();
      continue;
    }
    assert.equal(marker, 0x2c, `unexpected GIF marker 0x${marker.toString(16)}`);
    frameCount += 1;
    durationMs += delayCs * 10;
    if (transparent) transparentFrames += 1;
    offset += 8;
    const imagePacked = bytes[offset++]!;
    if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 7) + 1));
    offset += 1;
    skipBlocks();
    delayCs = 0;
    transparent = false;
  }
  return { width, height, frameCount, durationMs, hasTransparency: transparentFrames > 0, loop };
}

function pngMetadata(bytes: Buffer) {
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), frameCount: 1,
    hasTransparency: [4, 6].includes(bytes[25]!),
  };
}

test('reference emphasis assets match their immutable manifest metadata', () => {
  assert.equal(manifest.schemaVersion, 'emphasis-reference-assets.v1');
  assert.equal(manifest.purpose, 'reference_only');
  assert.equal(manifest.runtimeEligible, false);
  assert.equal(manifest.assets.length, 5);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(new URL(asset.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.id);
    const metadata = asset.format === 'gif' ? gifMetadata(bytes) : pngMetadata(bytes);
    assert.equal(metadata.width, asset.width, `${asset.id} width`);
    assert.equal(metadata.height, asset.height, `${asset.id} height`);
    assert.equal(metadata.frameCount, asset.frameCount, `${asset.id} frames`);
    assert.equal(metadata.hasTransparency, asset.hasTransparency, `${asset.id} transparency`);
    if (asset.format === 'gif') {
      assert.equal(metadata.durationMs, asset.animation.loopDurationMs, `${asset.id} duration`);
      assert.equal(metadata.loop, asset.animation.sourceLoopCount, `${asset.id} loop`);
    }
    assert.ok(asset.semanticLabels.length > 0 && asset.colors.length > 0);
    assert.ok(asset.applicable.events.length > 0 && asset.disabledScenes.length > 0);
    assert.deepEqual(asset.rights, { ...asset.rights, license: 'unknown', evidenceRef: null, reviewStatus: 'pending' });
  }
});
