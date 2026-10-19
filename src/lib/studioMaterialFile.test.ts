import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STUDIO_MATERIAL_VIDEO_ACCEPT,
  studioMaterialFileKind,
  studioMaterialFileMimeType,
} from './studioMaterialFile.js';

test('空 MIME 的 MP4、MOV 和 WebM 仍按视频上传', () => {
  for (const [name, mimeType] of [
    ['scene.MP4', 'video/mp4'],
    ['scene.mov', 'video/quicktime'],
    ['scene.webm', 'video/webm'],
  ] as const) {
    const file = { name, type: '' } as File;
    assert.equal(studioMaterialFileKind(file), 'video');
    assert.equal(studioMaterialFileMimeType(file, 'video'), mimeType);
  }
});

test('浏览器提供有效媒体 MIME 时优先保留', () => {
  const file = { name: 'camera-export', type: 'video/quicktime; charset=binary' } as File;
  assert.equal(studioMaterialFileKind(file), 'video');
  assert.equal(studioMaterialFileMimeType(file, 'video'), 'video/quicktime');
});

test('未知格式不会静默降级成图片', () => {
  const file = { name: 'scene.bin', type: '' } as File;
  assert.equal(studioMaterialFileKind(file), null);
  assert.equal(studioMaterialFileMimeType(file, 'video'), null);
});

test('预制场景文件选择器显式接受常用视频后缀', () => {
  assert.match(STUDIO_MATERIAL_VIDEO_ACCEPT, /\.mp4/);
  assert.match(STUDIO_MATERIAL_VIDEO_ACCEPT, /\.mov/);
  assert.match(STUDIO_MATERIAL_VIDEO_ACCEPT, /\.webm/);
});
