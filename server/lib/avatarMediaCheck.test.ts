import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { checkAvatarMedia } from './avatarMediaCheck.js';

test('real files: measure dimensions, reject bad ratio/resolution/audio and verify alpha pixels', { timeout: 120000 }, async () => {
  assert.ok(ffmpeg);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-media-test-'));
  const make = (name: string, size: string, audio = true, alpha = false) => {
    const file = path.join(root, name);
    const source = `color=red:s=${size}:r=5:d=1${alpha ? ",format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,W/2),0,255)'" : ''}`;
    execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source,
      ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'] : []),
      ...(name.endsWith('.webm') ? ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', alpha ? 'yuva420p' : 'yuv420p', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac']), '-shortest', file], { timeout: 30000 });
    return file;
  };
  const expected = { ratio: '9:16', duration: 1, transparent: false };
  try {
    const portrait = make('portrait.mp4', '720x1280');
    const result = await checkAvatarMedia(portrait, expected);
    assert.equal(result.width, 720); assert.equal(result.height, 1280); assert.equal(result.hasAudio, true); assert.equal(result.alphaVerified, false);
    const providerPortrait = await checkAvatarMedia(make('provider-portrait.mp4', '496x864'), { ...expected, resolution: '480p' });
    assert.equal(providerPortrait.width, 496); assert.equal(providerPortrait.height, 864);
    await assert.rejects(checkAvatarMedia(portrait, { ...expected, ratio: '16:9' }), /画幅/);
    await assert.rejects(checkAvatarMedia(portrait, { ...expected, duration: 8 }), /时长/);
    await assert.rejects(checkAvatarMedia(make('small.mp4', '360x640'), expected), /分辨率/);
    await assert.rejects(checkAvatarMedia(make('silent.mp4', '720x1280', false), expected), /缺少音轨/);
    const transparentExpected = { ...expected, transparent: true };
    await assert.rejects(checkAvatarMedia(make('opaque.webm', '720x1280'), transparentExpected), /透明/);
    const alpha = await checkAvatarMedia(make('alpha.webm', '720x1280', true, true), transparentExpected);
    assert.equal(alpha.alphaVerified, true);
    fs.writeFileSync(path.join(root, 'invalid.mp4'), 'not a video');
    await assert.rejects(checkAvatarMedia(path.join(root, 'invalid.mp4'), expected), /解码/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
