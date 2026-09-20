import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const previous = {
  cwd: process.cwd(),
  NODE_ENV: process.env.NODE_ENV,
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  MINIMAX_API_TOKEN: process.env.MINIMAX_API_TOKEN,
};
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-social-auto-render-'));
process.chdir(temporaryRoot);
process.env.NODE_ENV = 'test';
delete process.env.DASHSCOPE_API_KEY;
delete process.env.MINIMAX_API_KEY;
delete process.env.MINIMAX_API_TOKEN;

try {
  const [
    { INTERNAL_SOCIAL_CONTENT_FORMULAS },
    { freezeSocialScriptBaseline },
    {
      adaptBaselineToMaterials,
      buildSocialAutoProductionTimeline,
      buildSocialSceneTimingCues,
    },
    { synthesizeStudioVoiceForAutomation },
    { inspectRenderedVisuals, runVisualFfmpeg },
  ] = await Promise.all([
    import('./socialContentThemes.js'),
    import('./socialContentScriptBaseline.js'),
    import('./socialContentAutoProduction.js'),
    import('../routes/studio.js'),
    import('../lib/renderVisualQuality.js'),
  ]);
  const require = createRequire(import.meta.url);
  const { composite } = require('../../desktop/render.cjs') as {
    composite: (manifest: unknown, onProgress?: (progress: number) => void, outputDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  };

  const formula = INTERNAL_SOCIAL_CONTENT_FORMULAS.find(item => item.themeId === 'product_value')!;
  const lockedAt = '2026-09-20T08:00:00.000Z';
  const baseline = freezeSocialScriptBaseline({
    brief: {
      title: '产品卖点实拍', objective: '用真实素材介绍产品', productRef: '测试护肤品', audience: '采购商',
      markets: ['中国'], languages: ['中文'], platforms: ['抖音'], formats: ['短视频'], aspectRatio: '9:16',
      cadence: null, requestedOutputCount: 1, dueAt: null, brandNotes: null, restrictions: ['不得虚构功效'],
      callToAction: '联系我们获取已确认资料。',
    },
    theme: { themeId: 'product_value', inputKind: 'preset', topic: '产品卖点', classificationStatus: 'confirmed' },
    formula,
    lockedAt,
  });
  assert.equal(baseline.lockedAt, lockedAt);
  assert.equal(baseline.source, 'formula');
  assert.ok(baseline.scenes.every(scene => scene.narration.length > 0));

  const sourcePath = path.join(temporaryRoot, 'single-upload.mp4');
  const generated = await runVisualFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=4',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', sourcePath,
  ]);
  assert.equal(generated.ok, true, generated.stderr || 'failed to create the single source video');
  assert.equal(fs.existsSync(sourcePath), true);

  const asset = { id: 'uploaded-video-1', name: '用户上传的唯一视频', type: 'video' as const, sourceId: 'source-1', url: sourcePath, localPath: sourcePath, duration: 4 };
  const adaptation = adaptBaselineToMaterials(baseline, [asset]);
  assert.equal(adaptation.narrationChanged, false);
  assert.equal(adaptation.limitedMaterialFallback, true);
  assert.equal(new Set(adaptation.sceneAssets.map(item => item.assetId)).size, 1,
    'one real upload is safely reused across the complete baseline');

  if (process.platform !== 'darwin') {
    console.log('Social auto-production render smoke skipped: local test TTS requires macOS /usr/bin/say');
  } else {
    const narration = baseline.scenes.map(scene => scene.narration).join('');
    const voice = await synthesizeStudioVoiceForAutomation({
      tenantId: 'social-auto-render-test', text: narration, language: 'zh', voice: 'v1',
      style: { preset: 'professional_b2b', speed: 1, pauseStyle: 'natural' },
    });
    assert.equal(voice.ok, true, voice.error);
    assert.equal(voice.source, 'local_say');
    assert.ok(voice.localPath && fs.existsSync(voice.localPath));
    assert.ok(voice.cues?.length);

    const duration = Math.max(1, Number(voice.duration || voice.cues!.at(-1)?.end || 1));
    const sceneCues = buildSocialSceneTimingCues(baseline, duration);
    const timeline = buildSocialAutoProductionTimeline({ baseline, adaptation, assets: [asset], cues: sceneCues, duration });
    assert.equal(timeline.length, baseline.scenes.length);
    assert.ok(timeline.some((scene: any) => Number(scene.trimStart) > 0),
      'the repeated upload is reused through distinct source time ranges');

    const outputDir = path.join(temporaryRoot, 'renders');
    const rendered = await composite({
      jobId: 'single-material-auto-production',
      requireVisualAssets: true,
      spec: { ratio: '9:16', resolution: '720p', duration, platform: 'douyin', language: 'zh', bgmVol: 0, voiceVol: 100 },
      timeline,
      voiceover: { url: voice.localPath },
      bgm: { id: null, url: null },
      subtitles: { mode: 'target', cues: voice.cues, style: { fontScale: 1, bottomRatio: 0.18 } },
    }, undefined, outputDir);
    assert.equal(rendered.ok, true, rendered.error);
    assert.ok(rendered.outputPath && fs.existsSync(rendered.outputPath));
    assert.ok(fs.statSync(rendered.outputPath!).size > 10_000, 'rendered MP4 must contain real media bytes');
    const quality = await inspectRenderedVisuals({ outputPath: rendered.outputPath!, expectedDuration: duration, expectedUniqueScenes: 1 });
    assert.equal(quality.passed, true, quality.failures.join('; '));
    const audio = await runVisualFfmpeg(['-i', rendered.outputPath!, '-map', '0:a:0', '-t', '1', '-f', 'null', '-']);
    assert.equal(audio.ok, true, audio.stderr || 'rendered MP4 audio could not be decoded');
    console.log(`Social auto-production single-material MP4 render passed (${path.basename(rendered.outputPath!)})`);
  }
} finally {
  process.chdir(previous.cwd);
  process.env.NODE_ENV = previous.NODE_ENV;
  if (previous.DASHSCOPE_API_KEY === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = previous.DASHSCOPE_API_KEY;
  if (previous.MINIMAX_API_KEY === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = previous.MINIMAX_API_KEY;
  if (previous.MINIMAX_API_TOKEN === undefined) delete process.env.MINIMAX_API_TOKEN;
  else process.env.MINIMAX_API_TOKEN = previous.MINIMAX_API_TOKEN;
}
