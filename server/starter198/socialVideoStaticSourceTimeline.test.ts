import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { createStaticSourceTimelineMeasurement, staticSourceTimelineForHandoff } from './socialVideoStaticSourceTimeline.js';

const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
test('measures actual final frames against frozen distinct image sources and refuses ambiguity or drift', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'static-cuts-'));
  try {
    const red = path.join(dir, 'red.png'), blue = path.join(dir, 'blue.png'), output = path.join(dir, 'out.mp4');
    for (const [color, file] of [['red', red], ['blue', blue]]) {
      const result = await runVisualFfmpeg(['-f', 'lavfi', '-i', `color=${color}:s=64x64`, '-frames:v', '1', '-threads', '1', file!]);
      assert.equal(result.ok, true, result.stderr);
    }
    const result = await runVisualFfmpeg(['-loop', '1', '-framerate', '30', '-i', red, '-loop', '1', '-framerate', '30', '-i', blue,
      '-filter_complex', '[0:v]trim=duration=1,setpts=PTS-STARTPTS[a];[1:v]trim=duration=1,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '2', output]);
    assert.equal(result.ok, true, result.stderr);
    const sources = [{ sceneId: 'a', path: red, sha256: digest(await readFile(red)) }, { sceneId: 'b', path: blue, sha256: digest(await readFile(blue)) }];
    const mediaSha256 = digest(await readFile(output));
    const expectedScenes = [{ sceneId: 'a', targetStart: 0, targetEnd: 1 }, { sceneId: 'b', targetStart: 1, targetEnd: 2 }];
    const measured = await createStaticSourceTimelineMeasurement(sources)({ outputPath: output, mediaSha256, expectedScenes });
    assert.deepEqual(measured.scenes, expectedScenes);
    assert.match(measured.evidenceRef, /^static-pixel-timeline-sha256:/);
    const handoff = [{ sceneId: 'a', source: { assetId: 'asset-a', type: 'image' } }, { sceneId: 'b', source: { assetId: 'asset-b', type: 'image' } }];
    const assets = sources.map((source, index) => ({ id: index ? 'asset-b' : 'asset-a', type: 'image', localPath: source.path, contentHash: source.sha256 }));
    const fromHandoff = staticSourceTimelineForHandoff({ scenes: handoff, assets });
    assert.ok(fromHandoff);
    assert.deepEqual((await fromHandoff({ outputPath: output, mediaSha256, expectedScenes })).scenes, expectedScenes);
    assert.equal(staticSourceTimelineForHandoff({ scenes: handoff, assets: assets.map(({ contentHash: _hash, ...asset }) => asset) }), undefined);
    assert.equal(staticSourceTimelineForHandoff({ scenes: handoff, assets: [...assets, assets[0]!] }), undefined);
    assert.equal(staticSourceTimelineForHandoff({ scenes: [{ ...handoff[0]!, source: { assetId: 'asset-a', type: 'video' } }], assets }), undefined);
    await assert.rejects(createStaticSourceTimelineMeasurement(sources)({ outputPath: output, mediaSha256: '0'.repeat(64), expectedScenes }));
    await assert.rejects(createStaticSourceTimelineMeasurement([sources[1]!, sources[0]!])({ outputPath: output, mediaSha256, expectedScenes }));
    const shifted = [{ ...expectedScenes[0]!, targetEnd: 1.27 }, { ...expectedScenes[1]!, targetStart: 1.27 }];
    await assert.rejects(createStaticSourceTimelineMeasurement(sources)({ outputPath: output, mediaSha256, expectedScenes: shifted }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
