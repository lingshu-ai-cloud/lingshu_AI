import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { withLocalRenderAssets } from '../server/lib/localRenderAssets.js';
import { resolveSourceDurations, planVideoSourceSegments } from '../server/lib/videoSourcePlan.js';
import { inspectRenderedVisuals } from '../server/lib/renderVisualQuality.js';

// Local media-only verification. No tenant store, provider, TTS or publishing calls.
const manifest = JSON.parse(fs.readFileSync(path.resolve('docs/acceptance-materials-2026-09-04.json'), 'utf8'));
assert.equal(manifest.enterpriseOwnership, false);
assert.equal(manifest.productEvidence, false);
assert.equal(manifest.purpose, 'licensed-industry-illustration-only');
const mediaRoot = fs.realpathSync(path.resolve(manifest.mediaRoot));
const verified = [];
for (const asset of manifest.assets) {
  assert.ok(asset.creator && asset.sourceUrl && asset.license && asset.licenseUrl);
  const localPath = fs.realpathSync(path.join(mediaRoot, asset.file));
  assert.ok(localPath.startsWith(mediaRoot + path.sep), 'material must stay inside the package');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(localPath)) hash.update(chunk);
  assert.equal(hash.digest('hex'), asset.sha256, `source checksum: ${asset.id}`);
  const [timed] = await resolveSourceDurations([{ id: asset.id, type: 'video' as const, duration: 0, localPath }]);
  assert.ok(timed && Math.abs(timed.duration - asset.duration) < 0.15, `decoded duration: ${asset.id}`);
  // One source clip need not contain three scenes; final multi-scene output still does.
  const quality = await inspectRenderedVisuals({ outputPath: localPath, expectedDuration: timed.duration, expectedUniqueScenes: 1 });
  if (asset.status === 'selected') assert.equal(quality.passed, true, `${asset.id}: ${quality.failures.join('; ')}`);
  verified.push({ ...timed, status: asset.status, quality });
  console.log(`[materials] ${asset.id}: ${timed.duration.toFixed(3)}s ${asset.status}; basicQuality=${quality.passed}`);
}
const byId = new Map(verified.filter(asset => asset.status === 'selected').map(asset => [asset.id, asset]));
const scenes = manifest.coveragePlan.sceneAssetIds.map((id: string) => {
  const asset = byId.get(id);
  assert.ok(asset, `unselected scene source: ${id}`);
  return asset;
});
const coverage = planVideoSourceSegments(scenes, manifest.coveragePlan.sceneDurations);
assert.deepEqual(coverage.gaps, []);
const report = {
  checkedAt: new Date().toISOString(),
  acceptanceKind: 'local-material-preflight-only',
  fullE2EPassed: false,
  productEvidence: false,
  finalRenderChecked: false,
  assets: verified,
  coverage,
};
const reportPath = path.join(mediaRoot, 'verification.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`[materials] coverage passed for two proposed 25s illustrative videos; NOT business E2E: ${reportPath}`);

// Opt-in integration check using the actual desktop/server renderer. The
// disclosure is burned into every scene; no enterprise ownership is implied.
if (process.argv.includes('--render')) {
  const require = createRequire(import.meta.url);
  const { composite } = require('../desktop/render.cjs') as {
    composite: (input: unknown, progress: (percent: number) => void, directory: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  };
  const outputDir = fs.mkdtempSync(path.join(mediaRoot, 'render-check-'));
  const outputs: Array<Record<string, unknown>> = [];
  let passed = false;
  try {
    const split = manifest.coveragePlan.splitAfterScene;
    assert.equal(split, 5);
    assert.equal(coverage.segments.length, 10);
    for (const [index, ratio] of ['9:16', '16:9'].entries()) {
      const segments = coverage.segments.slice(index * split, (index + 1) * split);
      const duration = segments.reduce((sum, segment) => sum + segment.targetDuration, 0);
      let start = 0;
      const cues = segments.map(segment => {
        const cue = { start, end: start + segment.targetDuration, text: 'Licensed industry illustration. Not our factory or product.' };
        start = cue.end;
        return cue;
      });
      let lastProgress = -1;
      const rendered = await withLocalRenderAssets({
        jobId: `licensed-${index + 1}`, requireVisualAssets: true,
        spec: { ratio, duration, bgmVol: 0, voiceVol: 0 },
        timeline: segments.map(segment => ({ ...segment, type: 'video', name: segment.assetId, url: byId.get(segment.assetId)!.localPath })),
        subtitles: { mode: 'burn', cues }, bgm: { url: null }, voiceover: { url: null },
      }, authorized => composite(authorized, percent => {
        const bucket = Math.floor(percent / 20);
        if (bucket > lastProgress) console.log(`[render] ${ratio} ${Math.round(percent)}%`);
        lastProgress = Math.max(lastProgress, bucket);
      }, outputDir));
      const output: Record<string, unknown> = { ratio, duration, segments, ...rendered };
      outputs.push(output);
      assert.ok(rendered.ok && rendered.outputPath, rendered.error || 'render failed');
      const [decoded] = await resolveSourceDurations([{ id: `output-${index}`, type: 'video' as const, duration: 0, localPath: rendered.outputPath }]);
      output.decodedDuration = decoded!.duration;
      assert.ok(Math.abs(decoded!.duration - duration) < 0.15, 'rendered video duration must cover the complete timeline');
      const quality = await inspectRenderedVisuals({ outputPath: rendered.outputPath, expectedDuration: duration, expectedUniqueScenes: segments.length, minSharpFrameRatio: 0.5 });
      output.quality = quality;
      assert.equal(quality.passed, true, quality.failures.join('; '));
    }
    passed = true;
  } finally {
    fs.writeFileSync(path.join(outputDir, 'render-verification.json'), JSON.stringify({
      checkedAt: new Date().toISOString(), acceptanceKind: 'licensed-local-render-integration', passed,
      fullE2EPassed: false, productEvidence: false, voiceoverTested: false, publishingTested: false,
      sourceManifest: 'docs/acceptance-materials-2026-09-04.json', outputs,
    }, null, 2) + '\n');
    console.log(`[render] preserved results (including failures): ${outputDir}`);
  }
}
