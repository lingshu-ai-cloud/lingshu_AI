#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildStudioEmphasisPlan } from '../server/lib/studioEmphasisManifest.js';
import { normalizeEmphasisPlan } from '../shared/contracts/emphasisTimeline.js';

type Data = Record<string, any>;

function usage(): never {
  console.error('Usage: pnpm exec tsx scripts/verify-studio-emphasis-render.ts <draft-spec-or-manifest.json> [--out result.json] [--render output-dir]');
  process.exit(2);
}

const args = process.argv.slice(2);
const inputArg = args.find(arg => !arg.startsWith('--'));
if (!inputArg) usage();
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const inputPath = path.resolve(inputArg);
const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as Data;
const source = parsed.spec && typeof parsed.spec === 'object' && !Array.isArray(parsed.spec)
  && !parsed.jobId ? parsed.spec as Data : parsed;
const isManifest = Boolean(parsed.jobId && parsed.spec?.duration && Array.isArray(parsed.timeline));
const durationSeconds = Number(isManifest ? parsed.spec.duration : source.duration || source.totalDur || 0);
if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('草稿或 manifest 缺少有效 duration');

const existing = source.emphasisPlan;
const emphasisPlan = existing
  ? normalizeEmphasisPlan(existing, durationSeconds * 1_000, Array.isArray(existing.placementWindows) ? existing.placementWindows : [])
  : buildStudioEmphasisPlan({
      durationSeconds,
      script: source.script || source.activeSpokenScript || source.voiceoverScript,
      subtitles: source.subtitles || { cues: source.cues || source.subtitleCues || [] },
      timeline: source.timeline || source.renderTimeline || [],
    });
const result = {
  input: inputPath,
  inputKind: isManifest ? 'render-manifest' : 'studio-draft-spec',
  durationSeconds,
  profile: emphasisPlan.profile,
  captionCount: emphasisPlan.captions.length,
  eventCount: emphasisPlan.events.length,
  maxEvents: emphasisPlan.maxEvents,
  events: emphasisPlan.events,
};
console.log(JSON.stringify(result, null, 2));

const outArg = valueAfter('--out');
if (outArg) fs.writeFileSync(path.resolve(outArg), `${JSON.stringify({ ...result, emphasisPlan }, null, 2)}\n`);

const renderDir = valueAfter('--render');
if (renderDir) {
  if (!isManifest) throw new Error('--render 需要服务器已签发、含 timeline 媒体 URL 的完整 render manifest');
  const manifest = { ...parsed, emphasisPlan };
  const require = createRequire(import.meta.url);
  const { composite } = require('../desktop/render.cjs') as {
    composite: (manifest: Data, onProgress: (progress: number) => void, outputDir: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  };
  const outputDir = path.resolve(renderDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const rendered = await composite(manifest, progress => process.stderr.write(`\rRender ${Math.round(progress)}%`), outputDir);
  process.stderr.write('\n');
  if (!rendered.ok) throw new Error(rendered.error || '桌面渲染失败');
  console.log(`Rendered: ${rendered.outputPath}`);
}
