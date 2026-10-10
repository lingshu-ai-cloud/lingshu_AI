#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

type Mask = { startMs: number; endMs: number; box: { x: number; y: number; width: number; height: number } };
const require = createRequire(import.meta.url);
const ffmpeg = String(require('ffmpeg-static') || '');
const args = process.argv.slice(2);
const value = (flag: string): string | undefined => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const manifestArg = value('--manifest'), outputArg = value('--out'), runtimeManifestArg = value('--runtime-manifest');
if (!manifestArg || !outputArg) {
  console.error('Usage: pnpm exec tsx scripts/prepare-burned-caption-clean-source.ts --manifest input.json --out clean.mp4 [--runtime-manifest runtime.json]');
  process.exit(2);
}
const manifestPath = path.resolve(manifestArg);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as any;
const source = String(manifest.timeline?.[0]?.url || '');
if (!source || !fs.existsSync(source)) throw new Error(`source video not found: ${source}`);
const masks = (Array.isArray(manifest.burnedCaptionMasks) ? manifest.burnedCaptionMasks : []) as Mask[];
if (!masks.length) throw new Error('manifest.burnedCaptionMasks is empty');
const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', source, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const dimensions = String(probe.stderr || '').match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
if (!dimensions) throw new Error('unable to determine source dimensions');
const width = Number(dimensions[1]), height = Number(dimensions[2]);
const clamp = (number: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, number));
const filters = masks.flatMap((mask, index) => {
  const box = mask?.box;
  if (!box || ![mask.startMs, mask.endMs, box.x, box.y, box.width, box.height].every(Number.isFinite)
    || mask.endMs <= mask.startMs || box.width <= 0 || box.height <= 0) return [];
  const x = clamp(Math.floor(box.x * width), 0, width - 2), y = clamp(Math.floor(box.y * height), 0, height - 2);
  const w = clamp(Math.ceil(box.width * width), 2, width - x), h = clamp(Math.ceil(box.height * height), 2, height - y);
  const start = Math.max(0, mask.startMs / 1_000), end = Math.max(start, mask.endMs / 1_000);
  return [`delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`];
});
if (!filters.length) throw new Error('no valid burned-caption masks');
const output = path.resolve(outputArg);
fs.mkdirSync(path.dirname(output), { recursive: true });
const duration = Number(manifest.spec?.duration || 0);
const run = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
  ...(duration > 0 ? ['-t', duration.toFixed(3)] : []), '-vf', filters.join(','),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output],
{ encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (run.status !== 0) throw new Error(String(run.stderr || 'ffmpeg caption cleanup failed'));
if (runtimeManifestArg) {
  const runtime = { ...manifest, jobId: `${manifest.jobId || 'studio'}-clean-source`,
    timeline: manifest.timeline.map((clip: any, index: number) => index === 0 ? { ...clip, url: output } : clip),
    acceptance: {
      ...(manifest.acceptance || {}),
      burnedCaptionsRemoved: true,
      burnedCaptionCleanupMethod: 'ffmpeg_delogo',
      burnedCaptionCleanupReviewRequired: true,
      burnedCaptionCleanupAccepted: false,
      cleanSource: output,
    } };
  const runtimePath = path.resolve(runtimeManifestArg);
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`);
}
console.log(JSON.stringify({ source, output, width, height, maskCount: filters.length, runtimeManifest: runtimeManifestArg ? path.resolve(runtimeManifestArg) : undefined }, null, 2));
