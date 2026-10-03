import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';
import { extractSentenceFirstFrames } from './sentenceFirstFramePipeline.js';

test('extracts durable sentence first frames without sending the source video to a provider', async () => {
  assert.ok(ffmpegStatic); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentence-frames-'));
  const tenant = path.join(root, 'tenant-a'); fs.mkdirSync(tenant, { recursive: true }); const source = path.join(tenant, 'source.mp4');
  execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x480:r=10:d=3', '-pix_fmt', 'yuv420p', '-y', source]);
  let saved: any[] = []; const materials = [{ id: 'viral-1', tenantId: 'tenant-a', scope: 'own', type: 'video', file: 'tenant-a/source.mp4', contentSha256: 'a'.repeat(64) }];
  const cues = await extractSentenceFirstFrames({ tenantId: 'tenant-a', referenceMaterialId: 'viral-1', mediaRoot: root, ffmpegPath: String(ffmpegStatic),
    cues: [{ id: 'c1', start: 0.2, end: 1.2, originalText: '第一句', targetText: '目标第一句', shotIds: ['s1'], personShot: true }, { id: 'c2', start: 1.2, end: 2.6, originalText: '第二句', targetText: '目标第二句', shotIds: ['s1'], personShot: true }, { id: 'b1', start: 2.6, end: 3, originalText: '产品空镜', targetText: '', shotIds: ['s1'], personShot: false, nonPersonMaterialId: 'factory-video' }],
    materials: () => materials, saveMaterials: items => { saved = items; } });
  assert.equal(cues.length, 3); assert.equal(cues[0]!.sourceFirstFrame?.time, 0.2); assert.equal(cues[0]!.targetFirstFrame?.state, 'pending');
  assert.ok(cues.filter(cue=>cue.personShot!==false).every(cue => cue.sourceFirstFrame?.materialId && fs.existsSync(path.join(root, saved.find(item => item.id === cue.sourceFirstFrame!.materialId)!.file))));
  assert.equal(cues[2]!.sourceFirstFrame,undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bridged trend video verifies its bytes before extracting a reference frame', async () => {
  assert.ok(ffmpegStatic); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trend-sentence-frames-'));
  try {
    const tenantRoot = path.join(root, 'tenants', 'tenant-a', 'reference-videos');
    fs.mkdirSync(tenantRoot, { recursive: true });
    const file = path.join(tenantRoot, 'trend_videos_12345678.mp4');
    execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x240:r=10:d=1', '-pix_fmt', 'yuv420p', '-y', file]);
    const sourceMaterial = { id: 'trend_videos_12345678', type: 'video', scope: 'own', tenantId: 'tenant-a',
      file: 'tenants/tenant-a/reference-videos/trend_videos_12345678.mp4',
      contentSha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), verifyContentSha256: true };
    const call = () => extractSentenceFirstFrames({ tenantId: 'tenant-a', referenceMaterialId: sourceMaterial.id,
      sourceMaterial, mediaRoot: root, ffmpegPath: String(ffmpegStatic), materials: () => [], saveMaterials: () => {},
      cues: [{ id: 'c1', start: 0.1, end: 0.8, originalText: 'Hello', targetText: 'Hello', shotIds: ['s1'], personShot: true }] });
    assert.ok((await call())[0]?.sourceFirstFrame?.materialId);
    fs.appendFileSync(file, 'changed');
    await assert.rejects(call, /文件版本/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
